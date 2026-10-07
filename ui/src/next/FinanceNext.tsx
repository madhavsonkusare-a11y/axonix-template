/**
 * Finance in the new shell.
 *
 * It owns the sheets and answers `FinanceUiContext` exactly as `FinanceApp`
 * does, so a card deep in a frame behaves the same in both, on the same data.
 * The old tracker (`finance/FinanceApp.tsx`) is untouched and still opens as
 * "Legacy Finance".
 *
 * Every view is the second version, built for this shell (`next/finance/`).
 * The six sheets are still the first tracker's, re-inked by `styles/next.css`;
 * under this shell they open as panels on the right edge instead of in the
 * middle of the screen.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import { useFinance } from '../finance/FinanceContext';
import { FinanceUiContext, type FinanceUi, type Frame, type LedgerFilter } from '../finance/ui';
import type { FinanceIntent } from '../finance/FinanceApp';
import type { IdType } from '../finance/types';
import * as L from '../finance/ledger';
import { LiquidSegment } from '../finance/components/Liquid';
import TransactionSheet, { type TransactionPreset } from '../finance/components/TransactionSheet';
import AccountSheet, { type AccountTarget } from '../finance/components/AccountSheet';
import ImportSheet from '../finance/components/ImportSheet';
import SettingsSheet from '../finance/components/SettingsSheet';
import IdSheet from '../finance/components/IdSheet';
import DetailSheet, { type DetailTarget } from '../finance/components/DetailSheet';
import Overview from './finance/Overview';
import Spending from './finance/Spending';
import Transactions from './finance/Transactions';
import Accounts from './finance/Accounts';
import Invest from './finance/Invest';
import DigitalIds from './finance/DigitalIds';
import Stub from '../finance/frames/Stub';
import Shell from './Shell';
import { useDockApps } from './apps';
import Linked from './lift/Links';
import { isExpected } from './scrub/Lens';
import { refuseChange, useAsOf } from './scrub/Scrub';
import FinanceSide, { financeMenu } from './finance/FinanceSide';
import { STUBS, VIEWS } from './finance/views';

/** Frames that bring their own filled button; the top bar's Add steps back there. */
const OWN_ACTION: Frame[] = ['transactions', 'accounts', 'ids'];

/** Chart gradients in ink. Same ids the charts already point at. */
function ChartInk() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="finFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f2f0" stopOpacity=".16" />
          <stop offset="1" stopColor="#f2f2f0" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="finLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f2f2f0" stopOpacity=".7" />
          <stop offset="1" stopColor="#f2f2f0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Speaks only when saving fails, as the rail's foot did. A working save is silent. */
function SaveNotice() {
  const { save, loadError, loading, retrySave } = useFinance();
  if (loading) return null;
  if (loadError) {
    return (
      <span className="nx-save" title={loadError}>
        <span className="fin-dot" /> Not saving this session
      </span>
    );
  }
  if (save.state === 'error') {
    return (
      <span className="nx-save" title={save.message}>
        <span className="fin-dot" /> Last change not saved
        <button type="button" className="fin-link" onClick={retrySave}>
          Try again
        </button>
      </span>
    );
  }
  return null;
}

export interface FinanceNextProps {
  frame: Frame;
  onFrame: (f: Frame) => void;
  onSearch: () => void;
  intent: FinanceIntent | null;
  onIntentHandled: () => void;
  onOpenApp: (id: string) => void;
}

export default function FinanceNext({ frame, onFrame, onSearch, intent, onIntentHandled, onOpenApp }: FinanceNextProps) {
  const { data } = useFinance();
  const apps = useDockApps();
  const { live, day } = useAsOf();
  // The week is what the owner opens the tracker for (2026-09-20).
  const [range, setRange] = useState<L.TimeRange>('1W');
  const [spendRange, setSpendRange] = useState<L.SpendRange>('MONTH');
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>({});

  const [tx, setTx] = useState<{ editId?: string; preset?: TransactionPreset } | null>(null);
  const [account, setAccount] = useState<AccountTarget | null>(null);
  const [details, setDetails] = useState<DetailTarget | null>(null);
  const [importFor, setImportFor] = useState<{ accountId?: string; file?: File } | null>(null);
  const [settings, setSettings] = useState<{ tab?: 'categories' | 'budgets' | 'subscriptions' | 'data' } | null>(null);
  const [idTarget, setIdTarget] = useState<{ id?: string; type?: IdType } | null>(null);

  const go = useCallback(
    (f: Frame, filter?: LedgerFilter) => {
      if (f === 'transactions') setLedgerFilter(filter ?? {});
      onFrame(f);
    },
    [onFrame],
  );

  const ui = useMemo<FinanceUi>(() => {
    // While another day is showing, the workspace is for looking: nothing that edits opens.
    const edits =
      <A extends unknown[]>(open: (...args: A) => void) =>
      (...args: A) =>
        live ? open(...args) : refuseChange(day);
    return {
      go,
      addTransaction: edits((preset?: TransactionPreset) => setTx({ preset })),
      editTransaction: edits((editId: string) => setTx({ editId })),
      // An expected entry is not in the ledger: there is nothing behind it to open.
      openDetails: (target) => {
        if (!(target.type === 'transaction' && isExpected(target))) setDetails(target);
      },
      editAccount: edits((target: AccountTarget) => setAccount(target)),
      importStatement: edits((accountId?: string) => setImportFor({ accountId })),
      openSettings: edits((tab?: 'categories' | 'budgets' | 'subscriptions' | 'data') => setSettings({ tab })),
      editId: edits((target: { id?: string; type?: IdType }) => setIdTarget(target)),
    };
  }, [go, live, day]);

  useEffect(() => {
    if (!intent) return;
    if (intent.type === 'add') ui.addTransaction(intent.preset);
    if (intent.type === 'import') {
      if (!intent.file) ui.importStatement();
      else if (live) setImportFor({ file: intent.file });
      else refuseChange(day);
    }
    if (intent.type === 'account') ui.editAccount({ type: 'account' });
    if (intent.type === 'id') ui.editId({});
    if (intent.type === 'settings') ui.openSettings();
    if (intent.type === 'details') ui.openDetails(intent.target);
    if (intent.type === 'search') go('transactions', { query: intent.query });
    onIntentHandled();
  }, [intent, onIntentHandled, go, ui, live, day]);

  // Ctrl/⌘+N — quick add. Ignored while a sheet is open, so it never stacks one sheet on another.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      ui.addTransaction();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui]);

  // In a narrow window the tabs scroll; the one showing is kept in sight.
  useEffect(() => {
    document.querySelector('.nx-tabs [aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [frame]);

  const review = L.needsReview(data).length;
  const stub = STUBS[frame];

  const tabs = (
    <LiquidSegment<Frame>
      label="Finance views"
      className="nx-tabs"
      mono={false}
      value={frame}
      onChange={(f) => go(f)}
      options={VIEWS.map((v) => ({
        value: v.id,
        label: (
          <>
            {v.label}
            {v.id === 'transactions' && review > 0 && (
              <span className="nx-tabs__badge fin-num" title={`${review} to review`}>
                {review}
              </span>
            )}
            {v.soon && <span className="nx-tabs__soon">Soon</span>}
          </>
        ),
      }))}
    />
  );

  const actions = (
    <>
      <SaveNotice />
      <button type="button" className={OWN_ACTION.includes(frame) ? 'fin-pill' : 'fin-pill fin-pill--action'} onClick={() => ui.addTransaction()} title="Ctrl+N">
        + Add transaction
      </button>
    </>
  );

  return (
    <FinanceUiContext.Provider value={ui}>
      <ChartInk />
      <Shell
        module="finance"
        title="Finance"
        icon={Wallet}
        apps={apps}
        onOpenApp={onOpenApp}
        onAsk={onSearch}
        tabs={tabs}
        actions={actions}
        side={<FinanceSide frame={frame} />}
        menu={() => financeMenu(data, ui)}
        scrollKey={frame}
      >
        <ErrorBoundary label={`finance ${frame}`}>
          {frame === 'overview' && <Overview range={range} onRange={setRange} />}
          {frame === 'spending' && <Spending range={spendRange} onRangeChange={setSpendRange} />}
          {frame === 'transactions' && <Transactions filter={ledgerFilter} onFilter={setLedgerFilter} />}
          {frame === 'accounts' && <Accounts />}
          {frame === 'invest' && <Invest />}
          {frame === 'ids' && <DigitalIds />}
          {stub && <Stub title={stub.title} note={stub.note} />}
        </ErrorBoundary>
      </Shell>

      <TransactionSheet open={tx !== null} onClose={() => setTx(null)} editId={tx?.editId} preset={tx?.preset} />
      <DetailSheet target={details} onClose={() => setDetails(null)} extra={details?.type === 'transaction' ? <Linked thing={{ kind: 'txn', id: details.id }} before={() => setDetails(null)} /> : undefined} />
      <AccountSheet target={account} onClose={() => setAccount(null)} />
      <ImportSheet open={importFor !== null} onClose={() => setImportFor(null)} accountId={importFor?.accountId} file={importFor?.file} />
      <SettingsSheet open={settings !== null} onClose={() => setSettings(null)} tab={settings?.tab} />
      <IdSheet target={idTarget} onClose={() => setIdTarget(null)} />
    </FinanceUiContext.Provider>
  );
}
