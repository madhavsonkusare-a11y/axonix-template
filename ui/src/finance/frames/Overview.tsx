/**
 * Overview — the daily "how am I doing" view.
 *
 * LEFT: net-worth hero, three stat tiles, spending + budgets, recent activity.
 * RIGHT: wallet stack, upcoming charges, month-end projection.
 *
 * Every figure is derived from the ledger. The first build mixed live totals
 * with the mock's hardcoded deltas, captions and wallet — so an empty tracker
 * read "₹0 ▲ 4.2% · Up ₹1,96,200 this month". Where there is nothing to show
 * now, a card says so and offers the next step instead.
 */
import { useMemo, useRef, useState } from 'react';
import { Check, Copy, CopyPlus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFinance } from '../FinanceContext';
import { useFinanceUi } from '../ui';
import type { Transaction } from '../types';
import * as L from '../ledger';
import { addDays, dayLabel, delta, money, moneyIn, percent, rupees, shortDate, todayIso } from '../format';
import { PER } from '../components/SubscriptionsPanel';
import { Donut, ForecastLine, NetWorthChart, Sparkline, barFill } from '../components/Charts';
import { WalletStack } from '../components/AccountCard';
import { BrandMark } from '../components/BrandMark';
import { Menu, type MenuEntry } from '../components/Menu';
import { Secret } from '../components/Secret';
import { confirmAlert } from '../components/Alert';

const RANGE_WORDS: Record<L.TimeRange, string> = { '1W': 'over the week', '1M': 'this month', '6M': 'over six months', '1Y': 'over the year', All: 'all time' };

function Hero({ range }: { range: L.TimeRange }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const today = todayIso();
  const nw = L.netWorth(data);
  const series = useMemo(() => L.netWorthSeries(data, range, today), [data, range, today]);
  const empty = data.accounts.every((a) => L.needsBalance(data, a));

  const monthStart = addDays(`${today.slice(0, 7)}-01`, -1);
  const monthChange = nw.total - L.netWorth(data, monthStart).total;
  const rangeChange = series.end - series.start;
  const pct = series.start !== 0 ? (rangeChange / Math.abs(series.start)) * 100 : 0;
  const word = (v: number) => (v >= 0 ? 'Up' : 'Down');

  return (
    <section className="fin-card fin-card--hi">
      <span className="fin-grain" style={{ opacity: 0.2 }} aria-hidden="true" />

      <div className="fin-hero__top">
        <div className="fin-hero__lead">
          <p className="fin-label fin-label--wide">Net worth</p>
          <div className="fin-hero__figure">
            <Secret className="fin-hero__amount fin-num fin-num--lg" label="Net worth" value={money(nw.total)} />
            {!empty && Math.abs(pct) >= 0.05 && (
              <span className={`fin-chip ${pct >= 0 ? 'fin-chip--up' : 'fin-chip--down'} fin-hero__delta fin-num`}>{delta(pct)}</span>
            )}
          </div>
          {empty ? (
            <p className="fin-hero__sub">
              Set a balance on each account and this becomes your real number.{' '}
              <button type="button" className="fin-link" onClick={() => ui.go('accounts')}>
                Go to accounts
              </button>
            </p>
          ) : (
            <p className="fin-hero__sub">
              {word(monthChange)} {money(Math.abs(monthChange))} this month
              {range !== '1M' && ` · ${money(Math.abs(rangeChange))} ${rangeChange < 0 ? 'down ' : ''}${RANGE_WORDS[range]}`}
            </p>
          )}
        </div>

        <div className="fin-hero__stats">
          <div className="fin-hero__stat">
            <span className="fin-label fin-label--sm">Invested</span>
            <Secret className="fin-num" label="Invested" value={money(nw.invested)} />
          </div>
          <div className="fin-hero__rule" aria-hidden="true" />
          <div className="fin-hero__stat">
            <span className="fin-label fin-label--sm">Cash</span>
            <Secret className="fin-num" label="Cash" value={money(nw.cash)} />
          </div>
          {nw.debt !== 0 && (
            <>
              <div className="fin-hero__rule" aria-hidden="true" />
              <div className="fin-hero__stat">
                <span className="fin-label fin-label--sm">Debt</span>
                <Secret className="fin-num fin-negative" label="Debt" value={money(nw.debt)} />
              </div>
            </>
          )}
        </div>
      </div>

      <NetWorthChart points={L.chartPoints(series.values)} />

      <div className="fin-hero__ticks" aria-hidden="true">
        {series.ticks.map((t, i) => (
          <span key={`${t}-${i}`}>{t}</span>
        ))}
      </div>
    </section>
  );
}

function StatRow() {
  const { data } = useFinance();
  const today = todayIso();
  const month = L.monthPeriod(today);
  const flow = L.flowOf(data, month);
  const last = L.flowOf(data, L.previousPeriod('MONTH', today));
  const series = L.monthlySeries(data, 7, today);
  const hasHistory = series.some((m) => m.in || m.out);

  const lastIncome = [...data.transactions].filter((t) => t.kind === 'income' && t.date >= month.start).sort((a, b) => b.date.localeCompare(a.date))[0];
  const vsLast = flow.out - last.out;

  const [y, m] = today.split('-').map(Number);
  const daysLeft = new Date(y, m, 0).getDate() - Number(today.slice(8));
  const daysLeftLabel = daysLeft === 0 ? 'last day' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
  const budgeted = data.budgets.reduce((s, b) => s + b.limit, 0);
  const budgetSpent = data.budgets.reduce((s, b) => s + L.spentIn(data, b.category, month), 0);

  return (
    <div className="fin-stats">
      <div className="fin-card fin-card--tile">
        <p className="fin-label">Income</p>
        <div className="fin-stat__row">
          <span className="fin-stat__value fin-num">{money(flow.in)}</span>
          {hasHistory && <Sparkline values={L.normalise(series.map((s) => s.in))} stroke="var(--fin-positive)" />}
        </div>
        <p className="fin-stat__note">{lastIncome ? `${lastIncome.merchant}, ${shortDate(lastIncome.date)}` : 'Nothing in yet this month'}</p>
      </div>

      <div className="fin-card fin-card--tile">
        <p className="fin-label">Spent</p>
        <div className="fin-stat__row">
          <span className="fin-stat__value fin-num">{money(flow.out)}</span>
          {hasHistory && <Sparkline values={L.normalise(series.map((s) => s.out))} stroke="#ff8f8f" />}
        </div>
        <p className="fin-stat__note">
          {last.out === 0 && flow.out === 0 ? 'No spending recorded' : `${money(Math.abs(vsLast))} ${vsLast <= 0 ? 'less' : 'more'} than this point last month`}
        </p>
      </div>

      <div className="fin-card fin-card--tile">
        {budgeted > 0 ? (
          <>
            <p className="fin-label">Free to spend</p>
            <div className="fin-stat__row">
              <span className={budgetSpent > budgeted ? 'fin-stat__value fin-num fin-negative' : 'fin-stat__value fin-num'}>{money(budgeted - budgetSpent)}</span>
              <span className="fin-stat__aside fin-num">{daysLeftLabel}</span>
            </div>
            <div className="fin-bar fin-bar--thin" style={{ marginTop: 13 }}>
              <div className={budgetSpent > budgeted ? 'fin-bar__fill fin-bar__fill--over' : 'fin-bar__fill'} style={barFill(percent(budgetSpent, budgeted))} />
            </div>
          </>
        ) : (
          <>
            <p className="fin-label">Kept this month</p>
            <div className="fin-stat__row">
              <span className={flow.net < 0 ? 'fin-stat__value fin-num fin-negative' : 'fin-stat__value fin-num'}>{money(flow.net)}</span>
              <span className="fin-stat__aside fin-num">{flow.in > 0 ? `${Math.round((flow.net / flow.in) * 100)}%` : daysLeftLabel}</span>
            </div>
            <div className="fin-bar fin-bar--thin" style={{ marginTop: 13 }}>
              <div className="fin-bar__fill" style={barFill(flow.in > 0 ? percent(Math.max(0, flow.net), flow.in) : 0)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SpendingAndBudgets() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const month = L.monthPeriod();
  const totals = L.categoryTotals(data, month);
  const spent = totals.reduce((s, c) => s + c.amount, 0);
  const over = L.overLimit(data, month);

  return (
    <div className="fin-split">
      <section className="fin-card">
        <div className="fin-card__head">
          <h3 className="fin-card__title">Spending</h3>
          <span className="fin-card__aside fin-num">{money(spent)}</span>
        </div>
        {totals.length === 0 ? (
          <Empty text="No spending this month yet." action="Add one" onAction={() => ui.addTransaction()} />
        ) : (
          <div className="fin-donut">
            <Donut segments={totals} />
            <div className="fin-donut__legend">
              {totals.map((c) => (
                <button type="button" className="fin-donut__row" key={c.label} onClick={() => ui.go('transactions', { category: c.label })}>
                  <span className="fin-swatch" style={{ background: c.color }} aria-hidden="true" />
                  <span>{c.label}</span>
                  <span className="fin-num">{money(c.amount)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="fin-card">
        <div className="fin-card__head">
          <h3 className="fin-card__title">Budgets</h3>
          {data.budgets.length > 0 ? (
            <button type="button" className={over ? 'fin-card__aside fin-link fin-negative' : 'fin-card__aside fin-link'} onClick={() => ui.openSettings('budgets')}>
              {over ? `${over} over limit` : 'Edit'}
            </button>
          ) : (
            <span />
          )}
        </div>
        {data.budgets.length === 0 ? (
          <Empty text="No monthly limits set." action="Set budgets" onAction={() => ui.openSettings('budgets')} />
        ) : (
          <div className="fin-budgets">
            {data.budgets.slice(0, 5).map((b) => {
              const s = L.spentIn(data, b.category, month);
              const isOver = s > b.limit;
              return (
                <div className="fin-budget" key={b.category}>
                  <div className="fin-budget__head">
                    <span>{b.category}</span>
                    <span className={isOver ? 'fin-num fin-negative' : 'fin-num'}>
                      {money(s, { bare: true })} / {money(b.limit, { bare: true })}
                    </span>
                  </div>
                  <div className="fin-bar">
                    <div className={isOver ? 'fin-bar__fill fin-bar__fill--over' : 'fin-bar__fill'} style={barFill(percent(s, b.limit))} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function TxRow({ t, compact = false }: { t: Transaction; compact?: boolean }) {
  const { data, dispatch, undo } = useFinance();
  const ui = useFinanceUi();
  const row = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const account = L.accountById(data, t.accountId);
  const method = L.methodById(data, t.methodId);
  const to = L.accountById(data, t.toAccountId);
  const via = t.kind === 'transfer' ? `${account?.name ?? '?'} → ${to?.name ?? '?'}` : method?.name ?? account?.name;
  const hue = data.categories.find((c) => c.name === t.category)?.color;
  const amountClass = t.kind === 'income' ? 'fin-row__amount fin-num fin-positive' : t.kind === 'transfer' ? 'fin-row__amount fin-num fin-muted' : 'fin-row__amount fin-num';

  return (
    <button
      ref={row}
      type="button"
      className={compact ? 'fin-row fin-row--tx' : 'fin-row fin-row--tx fin-row--wide'}
      data-menu-open={menuAt !== null || undefined}
      data-fresh={Date.now() - Date.parse(t.createdAt) < 2500 || undefined}
      onClick={() => ui.openDetails({ type: 'transaction', id: t.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuAt({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setMenuAt({ x: r.left + 48, y: r.bottom - 4 });
        }
      }}
    >
      <span className="fin-row__date fin-num">{shortDate(t.date)}</span>
      <span className="fin-row__merchant">
        <BrandMark brand={method?.brand ?? account?.brand} fallback={t.merchant} size={24} />
        <span className="fin-row__text">
          <span>{t.merchant}</span>
          <span>{via}</span>
        </span>
      </span>
      <span className="fin-row__cat">
        {!compact && <span className="fin-cat-dot" style={{ background: hue ?? 'rgba(226, 234, 252, 0.3)' }} aria-hidden="true" />}
        <span className="fin-row__cat-name">{t.category}</span>
        {t.autoCategorized && <span className="fin-auto">auto</span>}
      </span>
      <span className={amountClass}>{t.kind === 'transfer' ? moneyIn(Math.abs(t.amount), account?.currency ?? 'INR') : moneyIn(t.amount, account?.currency ?? 'INR', { signed: true })}</span>
      {menuAt && <TxMenu t={t} at={menuAt} trigger={row.current} onClose={() => setMenuAt(null)} dispatch={dispatch} undo={undo} />}
    </button>
  );
}

/**
 * Right-click (or the menu key) on a transaction: the things people reach for
 * without opening it. After the context menus in Apple's HIG — short verbs,
 * the destructive item last and set apart, a confirmation only for Delete.
 */
export function TxMenu({
  t,
  at,
  trigger,
  onClose,
  dispatch,
  undo,
}: {
  t: Transaction;
  at: { x: number; y: number };
  trigger: HTMLElement | null;
  onClose: () => void;
  dispatch: ReturnType<typeof useFinance>['dispatch'];
  undo: ReturnType<typeof useFinance>['undo'];
}) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const currency = L.accountById(data, t.accountId)?.currency ?? 'INR';
  const shown = moneyIn(Math.abs(t.amount), currency);
  const entries: MenuEntry[] = [
    { id: 'edit', label: 'Edit…', icon: <Pencil size={14} strokeWidth={1.8} />, onSelect: () => ui.editTransaction(t.id) },
    {
      id: 'duplicate',
      label: 'Duplicate…',
      icon: <CopyPlus size={14} strokeWidth={1.8} />,
      onSelect: () =>
        ui.addTransaction({
          kind: t.kind === 'adjustment' ? 'expense' : t.kind,
          accountId: t.accountId,
          methodId: t.methodId,
          toAccountId: t.toAccountId,
          amount: Math.abs(t.amount),
          merchant: t.merchant,
          category: t.kind === 'transfer' ? undefined : t.category,
          date: todayIso(),
        }),
    },
    ...(t.autoCategorized
      ? [
          {
            id: 'review',
            label: `Confirm ${t.category}`,
            icon: <Check size={14} strokeWidth={2} />,
            onSelect: () => {
              const change = dispatch({ type: 'CONFIRM_TRANSACTIONS', ids: [t.id] });
              toast(`Confirmed ${t.merchant} as ${t.category}`, { action: { label: 'Undo', onClick: () => undo(change) } });
            },
          },
        ]
      : []),
    {
      id: 'copy',
      label: 'Copy amount',
      icon: <Copy size={14} strokeWidth={1.8} />,
      onSelect: () => {
        navigator.clipboard
          .writeText(Math.abs(t.amount).toFixed(2))
          .then(() => toast(`Copied ${shown}`))
          .catch(() => toast.error('The clipboard is not available here.'));
      },
    },
    { separator: true, id: 'sep' },
    {
      id: 'delete',
      label: 'Delete…',
      icon: <Trash2 size={14} strokeWidth={1.8} />,
      destructive: true,
      onSelect: () => {
        void confirmAlert({
          title: 'Delete this transaction?',
          message: `${t.merchant}, ${shown} on ${shortDate(t.date).replace(/[A-Z]{3}$/, (m) => m[0] + m.slice(1).toLowerCase())}. You can undo it straight after.`,
          confirmLabel: 'Delete',
          destructive: true,
        }).then((ok) => {
          if (!ok) return;
          const change = dispatch({ type: 'DELETE_TRANSACTION', id: t.id });
          toast(`Deleted ${t.merchant}`, { action: { label: 'Undo', onClick: () => undo(change) } });
        });
      },
    },
  ];
  return <Menu label={`${t.merchant} actions`} placement={{ at }} trigger={trigger} onClose={onClose} entries={entries} />;
}

function RecentActivity() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const review = L.needsReview(data).length;
  const recent = useMemo(
    () =>
      data.transactions
        .filter((t) => t.kind !== 'adjustment')
        .sort(L.newestFirst(data))
        .slice(0, 6),
    [data.transactions],
  );

  return (
    <section className="fin-card fin-activity">
      <div className="fin-activity__head">
        <h3 className="fin-card__title">Recent activity</h3>
        {review > 0 && (
          <button type="button" className="fin-chip fin-chip--accent" onClick={() => ui.go('transactions', { review: true })}>
            {review} to review
          </button>
        )}
        <button type="button" className="fin-activity__see" onClick={() => ui.go('transactions')}>
          See all
        </button>
      </div>

      {recent.length > 0 && (
        <div className="fin-row fin-row--head">
          <span>Date</span>
          <span>Merchant</span>
          <span>Category</span>
          <span style={{ textAlign: 'right' }}>Amount</span>
        </div>
      )}
      {recent.map((t) => (
        <TxRow key={t.id} t={t} compact />
      ))}
      {recent.length === 0 && <p className="fin-empty__text" style={{ padding: '10px 0 14px' }}>Nothing recorded yet. The fastest way in is one line below.</p>}

      <button type="button" className="fin-quickadd" onClick={() => ui.addTransaction()}>
        <span className="fin-quickadd__plus" aria-hidden="true">+</span>
        Quick add — “250 swiggy gpay”
        <span className="fin-key">Ctrl N</span>
      </button>
    </section>
  );
}

function Upcoming() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const today = todayIso();
  // The next charge is derived from each schedule, so a date that has passed rolls forward on its own.
  const subs = data.subscriptions
    .map((s) => ({ s, next: L.nextCharge(s, today) }))
    .sort((a, b) => a.next.localeCompare(b.next));

  return (
    <section className="fin-card">
      <div className="fin-card__head" style={{ marginBottom: 15 }}>
        <h3 className="fin-card__title">Subscriptions</h3>
        {subs.length > 0 ? (
          <button type="button" className="fin-card__aside fin-link fin-num" onClick={() => ui.openSettings('subscriptions')}>
            {money(Math.round(L.subscriptionsMonthly(data)))}/mo
          </button>
        ) : (
          <span />
        )}
      </div>
      {subs.length === 0 ? (
        <Empty text="Track Netflix, iCloud and the rest." action="Add" onAction={() => ui.openSettings('subscriptions')} />
      ) : (
        <div className="fin-list">
          {subs.slice(0, 5).map(({ s, next }) => {
            const method = L.methodById(data, s.methodId);
            const frequency = L.subFrequency(s);
            return (
              <button type="button" className="fin-list__row fin-list__row--button" key={s.id} onClick={() => ui.openSettings('subscriptions')}>
                <BrandMark brand={method?.brand} fallback={s.name} size={26} />
                <div className="fin-list__text">
                  <span>{s.name}</span>
                  <span>
                    {dayLabel(next, today)}
                    {method && ` · ${method.name}`}
                  </span>
                </div>
                <span className="fin-list__amount fin-num">
                  {rupees(s.amount)}
                  {frequency !== 'monthly' && <small className="fin-list__per">{PER[frequency]}</small>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Forecast() {
  const { data } = useFinance();
  const f = L.forecast(data);
  if (!f) return null;
  const [y, m] = todayIso().split('-').map(Number);
  const end = `${String(new Date(y, m, 0).getDate()).padStart(2, '0')} ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1]}`;

  return (
    <section className="fin-forecast">
      <span className="fin-grain fin-forecast__grain" aria-hidden="true" />
      <div className="fin-forecast__inner">
        <p className="fin-label fin-label--wide" style={{ marginBottom: 8 }}>
          Projected {end}
        </p>
        <Secret className="fin-forecast__amount fin-num fin-num--lg" label="Projected balance" value={money(f.amount)} />
        <p className="fin-forecast__note">
          {f.change >= 0 ? 'Up' : 'Down'} {money(Math.abs(f.change))} by month end, at your {f.basisDays}-day average.
        </p>
        <ForecastLine points={f.points} projectedFrom={f.projectedFrom} />
      </div>
    </section>
  );
}

export function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="fin-empty">
      <p className="fin-empty__text">{text}</p>
      {action && (
        <button type="button" className="fin-pill fin-pill--sm" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

export default function Overview({ range }: { range: L.TimeRange }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const cards = data.accounts.filter((a) => a.card && !a.archived);
  const [active, setActive] = useState(cards[0]?.id ?? '');
  const cardsArea = useRef<HTMLDivElement>(null);

  return (
    <div className="fin-body">
      <div className="fin-body__left">
        <Hero range={range} />
        <StatRow />
        <SpendingAndBudgets />
        <RecentActivity />
      </div>

      <div className="fin-body__right">
        {/* The cards area: the page never scrolls under the pointer here, the wheel flips cards. */}
        <div className="fin-wallet__zone" ref={cardsArea}>
          <div className="fin-wallet__head">
            <h3 className="fin-card__title">My cards</h3>
            <span className="fin-wallet__count">{cards.length}</span>
            <button type="button" className="fin-pill fin-pill--light" onClick={() => ui.editAccount({ type: 'account' })}>
              Add +
            </button>
          </div>

          {cards.length > 0 ? (
            <WalletStack accounts={cards} activeId={active} onSelect={setActive} onOpen={(id) => ui.openDetails({ type: 'account', id })} wheelZone={cardsArea} />
          ) : (
            <Empty text="Give an account a colour and it joins the wallet." action="Accounts" onAction={() => ui.go('accounts')} />
          )}
        </div>

        <Upcoming />
        <Forecast />
      </div>
    </div>
  );
}
