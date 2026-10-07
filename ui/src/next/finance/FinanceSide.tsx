/**
 * Finance's sidebar.
 *
 * First the views — that is what a sidebar is for. Then, quieter and folded
 * away until wanted, the things the tracker is made of: accounts, ways to pay,
 * subscriptions. Opening one of those reads before it edits: it opens the
 * details panel, never the editor.
 *
 * With the sidebar put away the views are tabs and this second half becomes
 * the menu on the module's name (`financeMenu`).
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, FileUp, ListChecks, Plus, Repeat, Settings2 } from 'lucide-react';
import { useFinance } from '../../finance/FinanceContext';
import { useFinanceUi, type FinanceUi, type Frame } from '../../finance/ui';
import type { FinanceData } from '../../finance/types';
import * as L from '../../finance/ledger';
import { money, moneyIn } from '../../finance/format';
import { accountThing, liftAttrs, methodThing, subscriptionThing } from '../lift/things';
import { frameIcon } from '../../finance/components/Glyphs';
import { BrandMark } from '../../finance/components/BrandMark';
import { LiquidLens, useLiquidIndicator } from '../../finance/components/Liquid';
import { useTotalsRevealed } from '../../finance/components/Secret';
import { PER } from '../../finance/components/SubscriptionsPanel';
import type { MenuEntry } from '../../finance/components/Menu';
import { VIEWS, type View } from './views';

const METHOD_WORD = { upi: 'UPI app', card: 'Card', wallet: 'Wallet' } as const;

/* Which groups are folded is a window preference, kept beside the dock's edge. */
const FOLDS = 'axonix.next.finance.folds';
type Folds = Record<string, boolean>;
const OPEN_AT_FIRST: Folds = { accounts: true, methods: false, subscriptions: false };

function readFolds(): Folds {
  try {
    return { ...OPEN_AT_FIRST, ...(JSON.parse(localStorage.getItem(FOLDS) ?? '{}') as Folds) };
  } catch {
    return OPEN_AT_FIRST;
  }
}

function Group({ id, title, count, open, onToggle, onAdd, addLabel, children }: { id: string; title: string; count: number; open: boolean; onToggle: (id: string) => void; onAdd: () => void; addLabel: string; children: ReactNode }) {
  return (
    <section className="nx-group" data-open={open}>
      <div className="nx-group__head">
        <button type="button" className="nx-group__toggle" aria-expanded={open} onClick={() => onToggle(id)}>
          <ChevronRight className="nx-group__chev" size={12} strokeWidth={2} aria-hidden="true" />
          <span>{title}</span>
          <span className="fin-num">{count}</span>
        </button>
        <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={onAdd} aria-label={addLabel} title={addLabel}>
          <Plus size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {open && <div className="nx-group__rows">{children}</div>}
    </section>
  );
}

function Row({ icon, label, hint, onClick, lift }: { icon: ReactNode; label: string; hint?: ReactNode; onClick: () => void; /** `liftAttrs` for the thing this row stands for. */ lift?: Record<string, string | undefined> }) {
  return (
    <button type="button" className="nx-row" onClick={onClick} {...lift}>
      <span className="nx-row__icon">{icon}</span>
      <span className="nx-row__label">{label}</span>
      {hint !== undefined && <span className="nx-row__hint fin-num">{hint}</span>}
    </button>
  );
}

// The first version is opened from Ctrl K ("First versions"): one door, as in Tasks.
export default function FinanceSide({ frame }: { frame: Frame }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  // Balances follow the totals: hidden until the owner reveals them.
  const revealed = useTotalsRevealed();
  const host = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, frame, 'y');

  const [folds, setFolds] = useState(readFolds);
  const toggle = useCallback((id: string) => {
    setFolds((now) => {
      const next = { ...now, [id]: !now[id] };
      try {
        localStorage.setItem(FOLDS, JSON.stringify(next));
      } catch {
        /* storage refused: the fold lasts for this session only */
      }
      return next;
    });
  }, []);

  const accounts = data.accounts.filter((a) => !a.archived);
  const review = L.needsReview(data).length;
  const glyph = { size: 14, strokeWidth: 1.6, 'aria-hidden': true } as const;

  const item = (v: View) => {
    const Icon = frameIcon[v.id];
    const on = v.id === frame;
    return (
      <button key={v.id} type="button" data-liquid-key={v.id} className="nx-nav__item" aria-current={on ? 'page' : undefined} onClick={() => ui.go(v.id)}>
        <span className="nx-nav__glyph">{Icon && <Icon size={16} strokeWidth={1.6} aria-hidden="true" />}</span>
        <span>{v.label}</span>
        {v.id === 'transactions' && review > 0 && (
          <span className="nx-nav__badge fin-num" title={`${review} to review`}>
            {review}
          </span>
        )}
        {v.soon && <span className="nx-nav__soon">Soon</span>}
      </button>
    );
  };

  return (
    <>
      <nav className="nx-nav" ref={host} aria-label="Finance views">
        <LiquidLens lensRef={lens} radius={10} />
        {VIEWS.filter((v) => v.section === 'money').map(item)}
        <span className="nx-nav__gap" aria-hidden="true" />
        {VIEWS.filter((v) => v.section === 'papers').map(item)}
      </nav>

      <div className="nx-side__more">
        <Group id="accounts" title="Accounts" count={accounts.length} open={folds.accounts} onToggle={toggle} onAdd={() => ui.editAccount({ type: 'account' })} addLabel="Add an account">
          {accounts.map((a) => (
            <Row
              key={a.id}
              icon={<BrandMark brand={a.brand} fallback={a.name} size={18} />}
              label={a.name}
              hint={L.needsBalance(data, a) ? 'Set' : revealed ? moneyIn(L.balanceOf(data, a.id), a.currency) : undefined}
              onClick={() => ui.openDetails({ type: 'account', id: a.id })}
              lift={liftAttrs(accountThing(a, data), { hold: true })}
            />
          ))}
        </Group>

        <Group id="methods" title="Ways to pay" count={data.methods.length} open={folds.methods} onToggle={toggle} onAdd={() => ui.editAccount({ type: 'method' })} addLabel="Add a way to pay">
          {data.methods.map((m) => (
            <Row key={m.id} icon={<BrandMark brand={m.brand} fallback={m.name} size={18} />} label={m.name} hint={METHOD_WORD[m.kind]} onClick={() => ui.openDetails({ type: 'method', id: m.id })} lift={liftAttrs(methodThing(m, data), { hold: true })} />
          ))}
        </Group>

        <Group id="subscriptions" title="Subscriptions" count={data.subscriptions.length} open={folds.subscriptions} onToggle={toggle} onAdd={() => ui.openSettings('subscriptions')} addLabel="Add a subscription">
          {data.subscriptions.map((s) => (
            <Row key={s.id} icon={<Repeat {...glyph} />} label={s.name} hint={`${money(s.amount)}${PER[L.subFrequency(s)]}`} onClick={() => ui.openSettings('subscriptions')} lift={liftAttrs(subscriptionThing(s, L.nextCharge(s)), { hold: true })} />
          ))}
        </Group>
      </div>

      <div className="nx-side__foot">
        <Row icon={<FileUp {...glyph} />} label="Import a statement" onClick={() => ui.importStatement()} />
        <Row icon={<Settings2 {...glyph} />} label="Settings" onClick={() => ui.openSettings()} />
      </div>
    </>
  );
}

/** The sidebar's second half, flat, for the menu on the module's name. */
export function financeMenu(data: FinanceData, ui: FinanceUi): MenuEntry[] {
  const review = L.needsReview(data).length;
  const glyph = { size: 14, strokeWidth: 1.6 } as const;
  return [
    ...(review > 0
      ? [{ id: 'review', label: 'To review', hint: String(review), icon: <ListChecks {...glyph} />, onSelect: () => ui.go('transactions', { review: true }) }, { separator: true as const, id: 'sep-review' }]
      : []),
    ...data.accounts
      .filter((a) => !a.archived)
      .map((a) => ({
        id: `account-${a.id}`,
        label: a.name,
        hint: L.KIND_LABEL[a.kind],
        icon: <BrandMark brand={a.brand} fallback={a.name} size={16} />,
        onSelect: () => ui.openDetails({ type: 'account', id: a.id }),
      })),
    { separator: true, id: 'sep-accounts' },
    ...data.methods.map((m) => ({
      id: `method-${m.id}`,
      label: m.name,
      hint: METHOD_WORD[m.kind],
      icon: <BrandMark brand={m.brand} fallback={m.name} size={16} />,
      onSelect: () => ui.openDetails({ type: 'method', id: m.id }),
    })),
    { separator: true, id: 'sep-methods' },
    { id: 'subscriptions', label: 'Subscriptions', hint: String(data.subscriptions.length), icon: <Repeat {...glyph} />, onSelect: () => ui.openSettings('subscriptions') },
    { id: 'import', label: 'Import a statement', icon: <FileUp {...glyph} />, onSelect: () => ui.importStatement() },
    { id: 'settings', label: 'Settings', icon: <Settings2 {...glyph} />, onSelect: () => ui.openSettings() },
  ];
}
