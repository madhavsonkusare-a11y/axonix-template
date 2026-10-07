/**
 * Overview, second version — the three questions the tracker is opened for.
 *
 * Where do I stand (net worth, and what it is made of), how is this month
 * going (in, out, kept, and the pace against last month), and is there
 * anything to do (budgets, what is due, what needs review).
 *
 * What changed from the first Overview, and why:
 * - The range control sits on the chart it drives, not across the page from it.
 * - The net-worth chart answers the pointer and names its high and low.
 * - A percentage is only shown when it means something: "▲ 301%" on a month
 *   that began near zero was noise, so the change is given in rupees first.
 * - Three stat tiles became one "this month" card with a pace line, because
 *   "am I spending faster than last month" is the question the tiles hinted at.
 * - The wallet stack left this page. The cards live in Accounts; here the same
 *   space says where the money is, account by account.
 * - Standing instructions join subscriptions under "Upcoming".
 *
 * Every figure still comes from the ledger. Totals stay behind `Secret`.
 */
import { useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useFinance } from '../../finance/FinanceContext';
import { useFinanceUi } from '../../finance/ui';
import * as L from '../../finance/ledger';
import { addDays, dayLabel, daysBetween, delta, money, moneyIn, rupees, shortDate } from '../../finance/format';
import { PER } from '../../finance/components/SubscriptionsPanel';
import { ForecastLine, Sparkline } from '../../finance/components/Charts';
import { BrandMark } from '../../finance/components/BrandMark';
import { LiquidSegment } from '../../finance/components/Liquid';
import { Secret, useTotalsRevealed } from '../../finance/components/Secret';
import { Empty, TxRow } from '../../finance/frames/Overview';
import { AreaChart, Meter, PaceChart, Ring, ShareBar, StackBar } from '../charts';
import { accountThing, budgetThing, categoryThing, liftAttrs, txnThing } from '../lift/things';
import { isExpected } from '../scrub/Lens';
import { shortDay, useAsOf, useDay } from '../scrub/Scrub';
import * as D from './derive';

const RANGE_WORDS: Record<L.TimeRange, string> = { '1W': 'over the week', '1M': 'over the month', '6M': 'over six months', '1Y': 'over the year', All: 'all time' };

function NetWorth({ range, onRange }: { range: L.TimeRange; onRange: (r: L.TimeRange) => void }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const revealed = useTotalsRevealed();
  const asOf = useAsOf();
  const today = asOf.day;
  const nw = L.netWorth(data);
  const series = useMemo(() => L.netWorthSeries(data, range, today), [data, range, today]);
  const dates = useMemo(() => D.seriesDates(data, range, today), [data, range, today]);
  const empty = data.accounts.every((a) => L.needsBalance(data, a));

  const change = series.end - series.start;
  // A percentage of a start near zero is a large number that says nothing.
  const pct = series.start > 0 ? (change / series.start) * 100 : null;
  const monthChange = nw.total - L.netWorth(data, addDays(`${today.slice(0, 7)}-01`, -1)).total;

  return (
    <section className="nxf-card nxf-worth">
      <div className="nxf-worth__top">
        <div className="nxf-worth__lead">
          {/* A figure that has not happened is blue, and says so. */}
          <p className="nxf-label">Net worth{asOf.future ? ` · expected by ${shortDay(asOf.day)}` : asOf.past ? ` · end of ${shortDay(asOf.day)}` : ''}</p>
          <div className="nxf-worth__figure">
            <Secret className={asOf.future ? 'nxf-worth__amount fin-num nxs-forecast' : 'nxf-worth__amount fin-num'} label="Net worth" value={money(nw.total)} />
            {!empty && pct !== null && Math.abs(pct) >= 0.05 && Math.abs(pct) <= 200 && <span className={`nxf-chip ${pct >= 0 ? 'nxf-chip--pos' : 'nxf-chip--neg'} fin-num`}>{delta(pct)}</span>}
          </div>
          {empty ? (
            <p className="nxf-worth__sub">
              Set a balance on each account and this becomes your real number.{' '}
              <button type="button" className="fin-link" onClick={() => ui.go('accounts')}>
                Go to accounts
              </button>
            </p>
          ) : (
            <p className="nxf-worth__sub">
              <b className={change >= 0 ? 'fin-num nxf-pos' : 'fin-num nxf-neg'}>{money(change, { signed: true })}</b> {RANGE_WORDS[range]}
              {range !== '1M' && (
                <>
                  {' · '}
                  <span className="fin-num">{money(monthChange, { signed: true })}</span> this month
                </>
              )}
            </p>
          )}
        </div>
        <LiquidSegment<L.TimeRange> label="Net worth range" value={range} onChange={onRange} options={L.TIME_RANGES.map((r) => ({ value: r, label: r === 'All' ? 'ALL' : r }))} />
      </div>

      <AreaChart values={series.values} labels={dates.map(D.tipDate)} format={(v) => money(v)} axis={D.compactInr} hidden={!revealed} drawKey={range} />

      <div className="nxf-worth__ticks fin-num" aria-hidden="true">
        {series.ticks.map((t, i) => (
          <span key={`${t}-${i}`}>{t}</span>
        ))}
      </div>

      <div className="nxf-worth__made">
        <StackBar
          parts={[
            { label: 'Cash', value: Math.max(0, nw.cash), tone: 'ink' },
            { label: 'Invested', value: Math.max(0, nw.invested), tone: 'soft' },
            { label: 'Debt', value: Math.abs(Math.min(0, nw.debt)), tone: 'danger' },
          ]}
        />
        <div className="nxf-worth__parts">
          <div className="nxf-part">
            <span className="nxf-part__key" data-tone="ink" />
            <span className="nxf-label">Cash</span>
            <Secret className="fin-num" label="Cash" value={money(nw.cash)} />
          </div>
          <div className="nxf-part">
            <span className="nxf-part__key" data-tone="soft" />
            <span className="nxf-label">Invested</span>
            <Secret className="fin-num" label="Invested" value={money(nw.invested)} />
          </div>
          {nw.debt !== 0 && (
            <div className="nxf-part">
              <span className="nxf-part__key" data-tone="danger" />
              <span className="nxf-label">Debt</span>
              <Secret className="fin-num fin-negative" label="Debt" value={money(nw.debt)} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ThisMonth() {
  const { data } = useFinance();
  const today = useDay();
  const month = L.monthPeriod(today);
  const flow = L.flowOf(data, month);
  const last = L.flowOf(data, L.previousPeriod('MONTH', today));
  const pace = useMemo(() => D.monthPace(data, today), [data, today]);
  const lastIncome = [...data.transactions].filter((t) => t.kind === 'income' && t.date >= month.start).sort((a, b) => b.date.localeCompare(a.date))[0];
  const vsLast = flow.out - last.out;
  const left = D.daysLeftInMonth(today);
  const rate = flow.in > 0 ? Math.round((flow.net / flow.in) * 100) : null;
  const budgeted = data.budgets.reduce((s, b) => s + b.limit, 0);
  const prevMonth = D.monthName(L.previousPeriod('MONTH', today).start);

  return (
    <section className="nxf-card nxf-month">
      <div className="nxf-card__head">
        <h3>{D.monthName(today)}</h3>
        <span className="nxf-card__aside fin-num">{left === 0 ? 'last day' : `${left} ${left === 1 ? 'day' : 'days'} left`}</span>
      </div>

      <div className="nxf-month__kept">
        <p className="nxf-label">Kept</p>
        <div className="nxf-month__figure">
          <span className={flow.net < 0 ? 'fin-num fin-negative' : 'fin-num'}>{money(flow.net)}</span>
          {rate !== null && <span className="nxf-month__rate fin-num">{rate}% of income</span>}
        </div>
      </div>

      <div className="nxf-month__flows">
        <div>
          <p className="nxf-label">In</p>
          <span className="fin-num nxf-pos">{money(flow.in)}</span>
          <small>{lastIncome ? `${lastIncome.merchant}, ${shortDate(lastIncome.date)}` : 'Nothing in yet'}</small>
        </div>
        <div>
          <p className="nxf-label">Out</p>
          <span className="fin-num">{money(flow.out)}</span>
          <small>{last.out === 0 && flow.out === 0 ? 'No spending recorded' : `${money(Math.abs(vsLast))} ${vsLast <= 0 ? 'less' : 'more'} than this point in ${prevMonth}`}</small>
        </div>
      </div>

      <div className="nxf-month__pace">
        <div className="nxf-legend">
          <span>
            <i data-tone="ink" /> Spent so far
          </span>
          <span>
            <i data-tone="faint" /> {prevMonth}
          </span>
          {budgeted > 0 && (
            <span>
              <i data-tone="line" /> Budget
            </span>
          )}
        </div>
        <PaceChart now={pace.now} before={pace.before} days={pace.days} limit={budgeted > 0 ? budgeted : undefined} format={(v) => money(Math.round(v))} nowLabel="Now" beforeLabel={prevMonth.slice(0, 3)} ahead={vsLast > 0 && last.out > 0} />
      </div>
    </section>
  );
}

function Categories() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const [active, setActive] = useState<number | null>(null);
  const month = L.monthPeriod(useDay());
  const totals = L.categoryTotals(data, month, 5);
  const spent = totals.reduce((s, c) => s + c.amount, 0);
  const shown = active !== null ? totals[active] : null;

  return (
    <section className="nxf-card">
      <div className="nxf-card__head">
        <h3>Where it went</h3>
        <button type="button" className="nxf-card__link" onClick={() => ui.go('spending')}>
          Spending <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {totals.length === 0 ? (
        <Empty text="No spending this month yet." action="Add one" onAction={() => ui.addTransaction()} />
      ) : (
        <div className="nxf-cats">
          <Ring slices={totals} active={active} onActive={setActive}>
            <span className="nxf-label">{shown ? shown.label : 'This month'}</span>
            <b className="fin-num">{money(Math.round(shown ? shown.amount : spent))}</b>
            {shown && <small className="fin-num">{Math.round((shown.amount / spent) * 100)}%</small>}
          </Ring>
          <div className="nxf-cats__list" onPointerLeave={() => setActive(null)}>
            {totals.map((c, i) => (
              <button type="button" className="nxf-cat" key={c.label} {...liftAttrs(categoryThing(c.label, money(Math.round(c.amount))), { hold: true })} data-active={active === i || undefined} onPointerEnter={() => setActive(i)} onClick={() => ui.go('transactions', { category: c.label })}>
                <span className="nxf-cat__dot" style={{ background: c.color }} aria-hidden="true" />
                <span className="nxf-cat__name">{c.label}</span>
                <span className="nxf-cat__share fin-num">{Math.round((c.amount / spent) * 100)}%</span>
                <span className="nxf-cat__amount fin-num">{money(Math.round(c.amount))}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Budgets() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const today = useDay();
  const month = L.monthPeriod(today);
  const over = L.overLimit(data, month);
  const elapsed = D.monthElapsed(today);
  const left = D.daysLeftInMonth(today);
  const budgeted = data.budgets.reduce((s, b) => s + b.limit, 0);
  const budgetSpent = data.budgets.reduce((s, b) => s + L.spentIn(data, b.category, month), 0);
  const free = budgeted - budgetSpent;

  return (
    <section className="nxf-card">
      <div className="nxf-card__head">
        <h3>Budgets</h3>
        {data.budgets.length > 0 && (
          <button type="button" className={over ? 'nxf-card__link nxf-neg' : 'nxf-card__link'} onClick={() => ui.openSettings('budgets')}>
            {over ? `${over} over limit` : 'Edit'}
          </button>
        )}
      </div>
      {data.budgets.length === 0 ? (
        <Empty text="No monthly limits set." action="Set budgets" onAction={() => ui.openSettings('budgets')} />
      ) : (
        <>
          <div className="nxf-free">
            <p className="nxf-label">Free to spend</p>
            <div className="nxf-free__row">
              <span className={free < 0 ? 'fin-num fin-negative' : 'fin-num'}>{money(Math.round(free))}</span>
              <small className="fin-num">{left > 0 && free > 0 ? `${money(Math.round(free / left))} a day for ${left} ${left === 1 ? 'day' : 'days'}` : left === 0 ? 'last day' : `${left} days left`}</small>
            </div>
          </div>
          <div className="nxf-budgets">
            {data.budgets.slice(0, 5).map((b) => {
              const s = L.spentIn(data, b.category, month);
              return (
                <button type="button" className="nxf-budget" key={b.category} {...liftAttrs(budgetThing(b, money(Math.round(L.spentIn(data, b.category, month)))), { hold: true })} onClick={() => ui.go('transactions', { category: b.category })}>
                  <span className="nxf-budget__head">
                    <span>{b.category}</span>
                    <span className={s > b.limit ? 'fin-num fin-negative' : 'fin-num'}>
                      {money(Math.round(s), { bare: true })} / {money(b.limit, { bare: true })}
                    </span>
                  </span>
                  <Meter value={s} limit={b.limit} pace={elapsed} />
                </button>
              );
            })}
          </div>
          <p className="nxf-note">The tick is today. A bar past it is going faster than the month.</p>
        </>
      )}
    </section>
  );
}

function Upcoming() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const today = useDay();
  const due = D.upcoming(data, today);

  return (
    <section className="nxf-card">
      <div className="nxf-card__head">
        <h3>Upcoming</h3>
        {data.subscriptions.length > 0 && (
          <button type="button" className="nxf-card__link fin-num" onClick={() => ui.openSettings('subscriptions')}>
            {money(Math.round(L.subscriptionsMonthly(data)))}/mo
          </button>
        )}
      </div>
      {due.length === 0 ? (
        <Empty text="Track Netflix, iCloud and the rest." action="Add" onAction={() => ui.openSettings('subscriptions')} />
      ) : (
        <div className="nxf-rows">
          {due.slice(0, 6).map((d) => {
            const days = daysBetween(today, d.date);
            return (
              <button
                type="button"
                className="nxf-row"
                key={d.key}
                {...liftAttrs(
                  { kind: d.kind === 'instruction' ? 'account' : 'subscription', id: d.kind === 'instruction' ? (d.accountId ?? d.key) : d.key.replace('sub-', ''), title: d.name, sub: `Due ${shortDate(d.date)}`, amount: money(d.amount), day: d.date },
                  { hold: true },
                )}
                onClick={() => (d.kind === 'instruction' && d.accountId ? ui.openDetails({ type: 'account', id: d.accountId }) : ui.openSettings('subscriptions'))}
              >
                <BrandMark brand={d.brand} fallback={d.name} size={28} />
                <span className="nxf-row__text">
                  <span>{d.name}</span>
                  <span>
                    {dayLabel(d.date, today)}
                    {d.via && ` · ${d.kind === 'instruction' ? 'from ' : ''}${d.via}`}
                  </span>
                </span>
                <span className="nxf-row__end">
                  <span className="fin-num">
                    {rupees(d.amount)}
                    {d.frequency !== 'monthly' && <small>{PER[d.frequency]}</small>}
                  </span>
                  <span className={days <= 3 ? 'nxf-when nxf-when--soon' : 'nxf-when'}>{D.inDays(d.date, today)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Activity() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const review = L.needsReview(data).length;
  const recent = useMemo(
    () =>
      data.transactions
        // What is only expected is not activity: it has its place in Transactions.
        .filter((t) => t.kind !== 'adjustment' && !isExpected(t))
        .sort(L.newestFirst(data))
        .slice(0, 8),
    [data],
  );

  return (
    <section className="nxf-card nxf-activity">
      <div className="nxf-card__head">
        <h3>Recent activity</h3>
        {review > 0 && (
          <button type="button" className="nxf-chip nxf-chip--att" onClick={() => ui.go('transactions', { review: true })}>
            {review} to review
          </button>
        )}
        <button type="button" className="nxf-card__link" onClick={() => ui.go('transactions')}>
          See all <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      {recent.map((t) => (
        <div key={t.id} className="nx-liftwrap" {...liftAttrs(txnThing(t, data), { wrap: true })}>
          <TxRow t={t} compact />
        </div>
      ))}
      {recent.length === 0 && <p className="fin-empty__text">Nothing recorded yet. The fastest way in is one line below.</p>}

      <button type="button" className="fin-quickadd" onClick={() => ui.addTransaction()}>
        <span className="fin-quickadd__plus" aria-hidden="true">
          +
        </span>
        Quick add — “250 swiggy gpay”
        <span className="fin-key">Ctrl N</span>
      </button>
    </section>
  );
}

function Holdings() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const revealed = useTotalsRevealed();
  const today = useDay();
  const rows = D.holdings(data);

  return (
    <section className="nxf-card">
      <div className="nxf-card__head">
        <h3>Where it is</h3>
        <button type="button" className="nxf-card__link" onClick={() => ui.go('accounts')}>
          Accounts <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {rows.length === 0 ? (
        <Empty text="Add the accounts your money sits in." action="Add account" onAction={() => ui.editAccount({ type: 'account' })} />
      ) : (
        <div className="nxf-rows">
          {rows.map(({ account: a, share }) => {
            const unset = L.needsBalance(data, a);
            return (
              <button type="button" className="nxf-row nxf-hold" key={a.id} {...liftAttrs(accountThing(a, data), { hold: true })} onClick={() => (unset ? ui.editAccount({ type: 'account', id: a.id }) : ui.openDetails({ type: 'account', id: a.id }))}>
                <BrandMark brand={a.brand} fallback={a.name} size={28} />
                <span className="nxf-row__text">
                  <span>{a.name}</span>
                  <span>{L.KIND_LABEL[a.kind]}</span>
                </span>
                {!unset && <Sparkline values={L.balanceTrend(data, a.id, 30, 8, today)} stroke="var(--nx-ink-3)" width={52} height={20} strokeWidth={1.5} className="nxf-hold__trend" />}
                <span className="nxf-row__end">
                  {unset ? <span className="fin-link">Set balance</span> : <span className="fin-num">{revealed ? moneyIn(L.balanceOf(data, a.id), a.currency) : '••••'}</span>}
                  {!unset && <ShareBar share={share} className="nxf-hold__share" />}
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
  const asOf = useAsOf();
  const today = asOf.day;
  const f = L.forecast(data, today);
  // Looking ahead, the whole page is the forecast.
  if (!f || asOf.future) return null;
  const end = shortDate(addDays(today, D.daysLeftInMonth(today)));

  return (
    <section className="nxf-card nxf-forecast fin-forecast">
      <div className="nxf-card__head">
        <h3>Month end</h3>
        <span className="nxf-chip nxf-chip--live">Forecast</span>
      </div>
      <Secret className="nxf-forecast__amount fin-num" label="Projected balance" value={money(f.amount)} />
      <p className="nxf-note">
        {f.change >= 0 ? 'Up' : 'Down'} {money(Math.abs(f.change))} by {end}, at your {f.basisDays}-day average.
      </p>
      <ForecastLine points={f.points} projectedFrom={f.projectedFrom} />
    </section>
  );
}

export default function Overview({ range, onRange }: { range: L.TimeRange; onRange: (r: L.TimeRange) => void }) {
  return (
    <div className="nxf-page">
      <div className="nxf-grid">
        <div className="nxf-span-8">
          <NetWorth range={range} onRange={onRange} />
        </div>
        <div className="nxf-span-4">
          <ThisMonth />
        </div>
        <div className="nxf-span-5">
          <Categories />
        </div>
        <div className="nxf-span-4">
          <Budgets />
        </div>
        <div className="nxf-span-3">
          <Upcoming />
        </div>
        <div className="nxf-span-8">
          <Activity />
        </div>
        <div className="nxf-span-4 nxf-stack">
          <Holdings />
          <Forecast />
        </div>
      </div>
    </div>
  );
}
