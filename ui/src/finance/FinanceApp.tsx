/**
 * Finance tracker — rail, top bar, the current frame, and every sheet.
 *
 * Sheets are owned here and opened through `FinanceUiContext`, so a card deep
 * in a frame can say "edit this account" without knowing where the sheet lives.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import { useFinance } from './FinanceContext';
import { FinanceUiContext, type FinanceUi, type Frame, type LedgerFilter } from './ui';
import type { IdType } from './types';
import * as L from './ledger';
import { Mark, frameIcon } from './components/Glyphs';
import { ChartDefs } from './components/Charts';
import { LiquidLens, LiquidSegment, useLiquidIndicator } from './components/Liquid';
import TransactionSheet, { type TransactionPreset } from './components/TransactionSheet';
import AccountSheet, { type AccountTarget } from './components/AccountSheet';
import ImportSheet from './components/ImportSheet';
import SettingsSheet from './components/SettingsSheet';
import IdSheet from './components/IdSheet';
import DetailSheet, { type DetailTarget } from './components/DetailSheet';
import Overview from './frames/Overview';
import Spending from './frames/Spending';
import Transactions from './frames/Transactions';
import Accounts from './frames/Accounts';
import Invest from './frames/Invest';
import DigitalIds from './frames/DigitalIds';
import Stub from './frames/Stub';

export type { Frame } from './ui';

interface NavItem {
  id: Frame;
  label: string;
  section: 'finance' | 'personal';
}

export const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', section: 'finance' },
  { id: 'spending', label: 'Spending', section: 'finance' },
  { id: 'transactions', label: 'Transactions', section: 'finance' },
  { id: 'accounts', label: 'Accounts & cards', section: 'finance' },
  { id: 'invest', label: 'Invest', section: 'finance' },
  { id: 'plan', label: 'Plan', section: 'finance' },
  { id: 'ids', label: 'Digital IDs', section: 'personal' },
  { id: 'wallet', label: 'Wallet', section: 'personal' },
];

const STUBS: Partial<Record<Frame, { title: string; note: string }>> = {
  plan: { title: 'Plan', note: 'Goals, debts and the runway view. Not designed yet.' },
  wallet: { title: 'Wallet', note: 'Cash in hand and what you carry. Coming next, once the design is settled.' },
};

/** Something another surface (the command palette) asked the tracker to do. */
export type FinanceIntent =
  /** `preset`: what a line typed in the command bar was read as ("paid 450 chai"). */
  | { type: 'add'; preset?: TransactionPreset }
  /** `file`: a statement dragged onto Finance, to read at once. */
  | { type: 'import'; file?: File }
  | { type: 'account' }
  | { type: 'id' }
  | { type: 'settings' }
  | { type: 'details'; target: DetailTarget }
  | { type: 'search'; query: string };

/**
 * The foot of the rail speaks only when saving fails: the last change not
 * saved (with Try again), or nothing being saved this session. A working save
 * is silent — the owner found "Saved 11:42" noise.
 */
function SaveState() {
  const { save, loadError, loading, retrySave } = useFinance();
  if (loading) return null;
  if (loadError) {
    return (
      <div className="fin-rail__foot">
        <span className="fin-rail__sync" data-state="error" title={loadError}>
          <span className="fin-dot" /> Not saving this session
        </span>
      </div>
    );
  }
  if (save.state === 'error') {
    return (
      <div className="fin-rail__foot">
        <span className="fin-rail__sync" data-state="error" title={save.message}>
          <span className="fin-dot" /> Last change not saved
        </span>
        <button type="button" className="fin-link fin-rail__retry" onClick={retrySave}>
          Try again
        </button>
      </div>
    );
  }
  // Saving that works says nothing (owner, 2026-09-19): only a failure takes space.
  return null;
}

function NavRail({ frame, onFrame, onHome, footer }: { frame: Frame; onFrame: (f: Frame) => void; onHome: () => void; footer?: React.ReactNode }) {
  const { data } = useFinance();
  const host = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, frame, 'y');

  const review = L.needsReview(data).length;
  const counts: Partial<Record<Frame, number>> = {
    accounts: data.accounts.filter((a) => !a.archived).length,
    ids: data.ids.length,
  };

  const item = (n: NavItem) => {
    const Icon = frameIcon[n.id];
    const on = n.id === frame;
    return (
      <button key={n.id} type="button" data-liquid-key={n.id} className={on ? 'fin-nav fin-nav--on' : 'fin-nav'} aria-current={on ? 'page' : undefined} onClick={() => onFrame(n.id)}>
        <span className="fin-nav__glyph">{Icon && <Icon size={15} strokeWidth={1.5} color={on ? '#9db9ff' : 'rgba(226,234,252,.42)'} aria-hidden="true" />}</span>
        <span>{n.label}</span>
        {n.id === 'transactions' && review > 0 && (
          <span className="fin-nav__badge" title={`${review} to review`}>
            {review}
          </span>
        )}
        {counts[n.id] ? <span className="fin-nav__count">{counts[n.id]}</span> : null}
        {STUBS[n.id] && <span className="fin-nav__soon">Soon</span>}
      </button>
    );
  };

  return (
    <aside className="fin-rail">
      <div className="fin-grain fin-rail__grain" aria-hidden="true" />
      <button type="button" className="fin-rail__brand" onClick={onHome} title="Back to Axonix Home">
        <Mark />
        <span>AXONIX</span>
      </button>
      <nav className="fin-rail__nav" ref={host}>
        <LiquidLens lensRef={lens} radius={10} />
        <span className="fin-rail__section">Finance</span>
        {NAV.filter((n) => n.section === 'finance').map(item)}
        <span className="fin-rail__section fin-rail__section--gap">Personal</span>
        {NAV.filter((n) => n.section === 'personal').map(item)}
      </nav>
      {footer}
    </aside>
  );
}

export interface FinanceAppProps {
  frame: Frame;
  onFrame: (f: Frame) => void;
  onHome: () => void;
  onSearch: () => void;
  intent: FinanceIntent | null;
  onIntentHandled: () => void;
}

export default function FinanceApp({ frame, onFrame, onHome, onSearch, intent, onIntentHandled }: FinanceAppProps) {
  // The week is what the owner opens the tracker for (2026-09-20); longer
  // ranges are a click away on the top bar.
  const [range, setRange] = useState<L.TimeRange>('1W');
  const [spendRange, setSpendRange] = useState<L.SpendRange>('MONTH');
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>({});

  const [tx, setTx] = useState<{ editId?: string; preset?: TransactionPreset } | null>(null);
  const [account, setAccount] = useState<AccountTarget | null>(null);
  const [details, setDetails] = useState<DetailTarget | null>(null);
  const [importFor, setImportFor] = useState<{ accountId?: string } | null>(null);
  const [settings, setSettings] = useState<{ tab?: 'categories' | 'budgets' | 'subscriptions' | 'data' } | null>(null);
  const [idTarget, setIdTarget] = useState<{ id?: string; type?: IdType } | null>(null);

  const go = useCallback(
    (f: Frame, filter?: LedgerFilter) => {
      if (f === 'transactions') setLedgerFilter(filter ?? {});
      onFrame(f);
    },
    [onFrame],
  );

  const ui = useMemo<FinanceUi>(
    () => ({
      go,
      addTransaction: (preset) => setTx({ preset }),
      editTransaction: (editId) => setTx({ editId }),
      openDetails: setDetails,
      editAccount: setAccount,
      importStatement: (accountId) => setImportFor({ accountId }),
      openSettings: (tab) => setSettings({ tab }),
      editId: setIdTarget,
    }),
    [go],
  );

  useEffect(() => {
    if (!intent) return;
    if (intent.type === 'add') setTx({ preset: intent.preset });
    if (intent.type === 'import') setImportFor({});
    if (intent.type === 'account') setAccount({ type: 'account' });
    if (intent.type === 'id') setIdTarget({});
    if (intent.type === 'settings') setSettings({});
    if (intent.type === 'details') setDetails(intent.target);
    if (intent.type === 'search') go('transactions', { query: intent.query });
    onIntentHandled();
  }, [intent, onIntentHandled, go]);

  // Ctrl/⌘+N — the quick add the Overview advertises. Ignored while a sheet is
  // open, so it never stacks one sheet on another.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      setTx({});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const stub = STUBS[frame];

  return (
    <FinanceUiContext.Provider value={ui}>
      <div className="fin">
        <ChartDefs />
        <NavRail frame={frame} onFrame={go} onHome={onHome} footer={<SaveState />} />
        <div className="fin-main">
          <div className="fin-grain fin-main__grain" aria-hidden="true" />
          <div className="fin-topbar">
            <button type="button" className="fin-search" onClick={onSearch}>
              Search, jump, or add
              <span className="fin-search__key fin-key">Ctrl K</span>
            </button>
            <div className="fin-topbar__right">
              {frame === 'overview' && (
                <LiquidSegment<L.TimeRange>
                  label="Net worth range"
                  value={range}
                  onChange={setRange}
                  options={L.TIME_RANGES.map((r) => ({ value: r, label: r === 'All' ? 'ALL' : r }))}
                />
              )}
              <button type="button" className="fin-icon-btn fin-icon-btn--lg" onClick={() => setSettings({})} aria-label="Settings" title="Settings">
                <Settings2 size={16} strokeWidth={1.6} />
              </button>
              <button type="button" className="fin-pill fin-pill--action" onClick={() => setTx({})} title="Ctrl+N">
                + Add transaction
              </button>
            </div>
          </div>
          {/* Keyed by frame: each frame starts at the top instead of inheriting the last one's scroll. */}
          <div className="fin-main__scroll" key={frame}>
            <ErrorBoundary label={`finance ${frame}`}>
              {frame === 'overview' && <Overview range={range} />}
              {frame === 'spending' && <Spending range={spendRange} onRangeChange={setSpendRange} />}
              {frame === 'transactions' && <Transactions filter={ledgerFilter} onFilter={setLedgerFilter} />}
              {frame === 'accounts' && <Accounts />}
              {frame === 'invest' && <Invest />}
              {frame === 'ids' && <DigitalIds />}
              {stub && <Stub title={stub.title} note={stub.note} />}
            </ErrorBoundary>
          </div>
        </div>

        <TransactionSheet open={tx !== null} onClose={() => setTx(null)} editId={tx?.editId} preset={tx?.preset} />
        <DetailSheet target={details} onClose={() => setDetails(null)} />
        <AccountSheet target={account} onClose={() => setAccount(null)} />
        <ImportSheet open={importFor !== null} onClose={() => setImportFor(null)} accountId={importFor?.accountId} />
        <SettingsSheet open={settings !== null} onClose={() => setSettings(null)} tab={settings?.tab} />
        <IdSheet target={idTarget} onClose={() => setIdTarget(null)} />
      </div>
    </FinanceUiContext.Provider>
  );
}
