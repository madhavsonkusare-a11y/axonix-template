/**
 * Spending, second version — where the money went, and whether the period held.
 *
 * WEEK / MONTH / YEAR still drives every card, and comparisons are still
 * period-to-date against the same point of the previous period.
 *
 * What changed from the first Spending:
 * - Every chart reads out the figure under the pointer.
 * - Categories are here in full, with each one's change against the previous
 *   period; the first version only named the biggest.
 * - "By day" became two charts: each day of the period, and the weekday shape.
 * - The kept card dropped its green wash for a ring whose green arc is the
 *   share of income kept.
 */
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useFinance } from '../../finance/FinanceContext';
import { useFinanceUi } from '../../finance/ui';
import * as L from '../../finance/ledger';
import { dateOf, money, moneyIn, shortDate } from '../../finance/format';
import { useAsOf, useDay } from '../scrub/Scrub';
import { BrandMark } from '../../finance/components/BrandMark';
import { LiquidSegment } from '../../finance/components/Liquid';
import { Empty } from '../../finance/frames/Overview';
import { ColumnChart, FlowChart, Ring, ShareBar, type Column } from '../charts';
import * as D from './derive';

const WORD: Record<L.SpendRange, { now: string; before: string }> = {
  WEEK: { now: 'this week', before: 'last week' },
  MONTH: { now: 'this month', before: 'this point last month' },
  YEAR: { now: 'this year', before: 'this time last year' },
};

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Kept({ range }: { range: L.SpendRange }) {
  const { data } = useFinance();
  const today = useDay();
  const p = L.periodOf(range, today);
  const flow = L.flowOf(data, p);
  const prev = L.flowOf(data, L.previousPeriod(range, today));
  const rate = flow.in > 0 ? Math.round((flow.net / flow.in) * 100) : null;
  const prevRate = prev.in > 0 ? Math.round((prev.net / prev.in) * 100) : null;
  const kept = Math.max(0, flow.net);
  const slices = flow.in > 0 ? [{ label: 'Kept', amount: kept, color: 'var(--nx-pos)' }, { label: 'Spent', amount: Math.max(0, flow.in - kept), color: 'rgba(242, 242, 240, 0.22)' }].filter((s) => s.amount > 0) : [];

  return (
    <section className="nxf-card nxf-kept">
      <div className="nxf-card__head">
        <h3>Kept {WORD[range].now}</h3>
      </div>
      <div className="nxf-kept__body">
        <Ring slices={slices} size={124} thickness={12} active={null} onActive={() => {}}>
          <b className="fin-num">{rate === null ? '—' : `${rate}%`}</b>
          <span className="nxf-label">of income</span>
        </Ring>
        <div className="nxf-kept__text">
          <span className={flow.net < 0 ? 'nxf-kept__amount fin-num fin-negative' : 'nxf-kept__amount fin-num'}>{money(Math.round(flow.net))}</span>
          <p className="nxf-note">
            {rate === null
              ? 'Nothing has come in yet, so there is no rate to show.'
              : prevRate === null
                ? `You kept ${rate}% of what came in.`
                : rate >= prevRate
                  ? `Up from ${prevRate}% ${WORD[range].before}.`
                  : `Down from ${prevRate}% ${WORD[range].before}.`}
          </p>
        </div>
      </div>
      <div className="nxf-kept__flows">
        <div>
          <p className="nxf-label">In</p>
          <span className="fin-num nxf-pos">{money(Math.round(flow.in))}</span>
        </div>
        <div>
          <p className="nxf-label">Out</p>
          <span className="fin-num">{money(Math.round(flow.out))}</span>
        </div>
      </div>
    </section>
  );
}

function Categories({ range }: { range: L.SpendRange }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const [active, setActive] = useState<number | null>(null);
  const today = useDay();
  const p = L.periodOf(range, today);
  const before = L.previousPeriod(range, today);
  const totals = L.categoryTotals(data, p, 8);
  const spent = totals.reduce((s, c) => s + c.amount, 0);
  const shown = active !== null ? totals[active] : null;
  const largest = Math.max(1, ...totals.map((c) => c.amount));

  return (
    <section className="nxf-card">
      <div className="nxf-card__head">
        <h3>By category</h3>
        <span className="nxf-card__aside">against {WORD[range].before}</span>
      </div>
      {totals.length === 0 ? (
        <Empty text={`No spending ${WORD[range].now}.`} action="Add one" onAction={() => ui.addTransaction()} />
      ) : (
        <div className="nxf-cats nxf-cats--wide">
          <Ring slices={totals} active={active} onActive={setActive}>
            <span className="nxf-label">{shown ? shown.label : 'Spent'}</span>
            <b className="fin-num">{money(Math.round(shown ? shown.amount : spent))}</b>
            {shown && <small className="fin-num">{Math.round((shown.amount / spent) * 100)}%</small>}
          </Ring>
          <div className="nxf-cats__list" onPointerLeave={() => setActive(null)}>
            {totals.map((c, i) => {
              const was = c.label === 'Everything else' ? null : L.spentIn(data, c.label, before);
              const diff = was === null ? 0 : c.amount - was;
              return (
                <button type="button" className="nxf-cat nxf-cat--bar" key={c.label} data-active={active === i || undefined} onPointerEnter={() => setActive(i)} onClick={() => ui.go('transactions', { category: c.label })}>
                  <span className="nxf-cat__dot" style={{ background: c.color }} aria-hidden="true" />
                  <span className="nxf-cat__name">{c.label}</span>
                  {was !== null && Math.abs(diff) >= 1 && <span className={diff > 0 ? 'nxf-cat__diff nxf-cat__diff--up fin-num' : 'nxf-cat__diff fin-num'}>{money(Math.round(diff), { signed: true })}</span>}
                  <span className="nxf-cat__amount fin-num">{money(Math.round(c.amount))}</span>
                  <ShareBar share={c.amount / largest} color={c.color} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/** One column per day (or per month, over a year). */
function useSteps(range: L.SpendRange): { columns: Column[]; average: number; unit: string } {
  const { data } = useFinance();
  const today = useDay();
  return useMemo(() => {
    const p = L.periodOf(range, today);
    if (range === 'YEAR') {
      const year = today.slice(0, 4);
      const months = Number(today.slice(5, 7));
      const columns = Array.from({ length: months }, (_, m) => {
        const last = new Date(Number(year), m + 1, 0).getDate();
        const mm = String(m + 1).padStart(2, '0');
        const amount = Math.max(0, L.flowOf(data, { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` }).out);
        return { label: MONTHS[m].toUpperCase(), name: `${MONTHS[m]} ${year}`, amount };
      });
      return { columns, average: columns.reduce((s, c) => s + c.amount, 0) / columns.length, unit: 'a month' };
    }
    const days = D.dailySpend(data, p);
    const columns = days.map((d, i) => {
      const date = dateOf(d.date);
      const label = range === 'WEEK' ? WEEKDAYS[(date.getDay() + 6) % 7].slice(0, 3).toUpperCase() : days.length <= 10 || i === 0 || date.getDate() % 5 === 0 ? String(date.getDate()) : '';
      return { label, name: D.tipDate(d.date), amount: Math.max(0, d.amount) };
    });
    return { columns, average: columns.reduce((s, c) => s + c.amount, 0) / columns.length, unit: 'a day' };
  }, [data, range, today]);
}

export default function Spending({ range, onRangeChange }: { range: L.SpendRange; onRangeChange: (r: L.SpendRange) => void }) {
  const { data, dispatch } = useFinance();
  const ui = useFinanceUi();
  const { day: today, live } = useAsOf();
  const p = L.periodOf(range, today);
  const flow = L.flowOf(data, p);
  const prev = L.flowOf(data, L.previousPeriod(range, today));
  const diff = flow.out - prev.out;
  const series = L.monthlySeries(data, range === 'YEAR' ? 12 : 6, today);
  const merchants = L.topMerchants(data, p);
  const byDay = L.byWeekday(data, p);
  const steps = useSteps(range);
  const methods = data.methods
    .map((m) => ({ m, amount: L.spentVia(data, m.id, p) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const review = L.needsReview(data).sort((a, b) => b.date.localeCompare(a.date));
  const hasFlows = series.some((s) => s.in || s.out);
  const busiest = byDay.reduce((best, d, i) => (d.amount > byDay[best].amount ? i : best), 0);

  return (
    <div className="nxf-page">
      <header className="nxf-head">
        <div>
          <h2>Spending</h2>
          <p>
            <b className="fin-num">{money(Math.round(flow.out))}</b> {WORD[range].now}
            {(prev.out > 0 || flow.out > 0) && (
              <>
                {' · '}
                <span className={diff > 0 ? 'fin-num nxf-att' : 'fin-num'}>{money(Math.round(Math.abs(diff)))}</span> {diff <= 0 ? 'less' : 'more'} than {WORD[range].before}
              </>
            )}
          </p>
        </div>
        <LiquidSegment<L.SpendRange>
          label="Period"
          size="lg"
          value={range}
          onChange={onRangeChange}
          options={[
            { value: 'WEEK', label: 'WEEK' },
            { value: 'MONTH', label: 'MONTH' },
            { value: 'YEAR', label: 'YEAR' },
          ]}
        />
      </header>

      <div className="nxf-grid">
        <div className="nxf-span-8">
          <section className="nxf-card">
            <div className="nxf-card__head">
              <h3>Money in and out</h3>
              <div className="nxf-legend">
                <span>
                  <i data-tone="pos" /> In
                </span>
                <span>
                  <i data-tone="ink" /> Out
                </span>
              </div>
            </div>
            {hasFlows ? <FlowChart data={series} format={(v) => money(Math.round(v))} axis={D.compactInr} /> : <Empty text="Bars appear once a month has income or spending in it." />}
          </section>
        </div>
        <div className="nxf-span-4">
          <Kept range={range} />
        </div>

        <div className="nxf-span-6">
          <Categories range={range} />
        </div>
        <div className="nxf-span-6">
          <section className="nxf-card">
            <div className="nxf-card__head">
              <h3>{range === 'YEAR' ? 'Month by month' : 'Day by day'}</h3>
              <span className="nxf-card__aside fin-num">
                {money(Math.round(steps.average))} {steps.unit}
              </span>
            </div>
            {steps.columns.some((c) => c.amount > 0) ? <ColumnChart data={steps.columns} format={(v) => money(Math.round(v))} average={steps.average} height={212} /> : <Empty text="Nothing to chart yet." />}
            <p className="nxf-note">The line across is the average.</p>
          </section>
        </div>

        <div className="nxf-span-3">
          <section className="nxf-card">
            <div className="nxf-card__head">
              <h3>Top merchants</h3>
            </div>
            {merchants.length === 0 ? (
              <Empty text={`No spending ${WORD[range].now}.`} />
            ) : (
              <div className="nxf-ranks">
                {merchants.map((m) => (
                  <button type="button" className="nxf-rank" key={m.name} onClick={() => ui.go('transactions', { query: m.name })}>
                    <span className="nxf-rank__head">
                      <span>{m.name}</span>
                      <span className="fin-num">{money(Math.round(m.amount))}</span>
                    </span>
                    <ShareBar share={m.amount / merchants[0].amount} />
                    <small className="fin-num">
                      {m.count} {m.count === 1 ? 'payment' : 'payments'}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="nxf-span-3">
          <section className="nxf-card">
            <div className="nxf-card__head">
              <h3>Paid with</h3>
            </div>
            {methods.length === 0 ? (
              <Empty text="Payments made through GPay, cards and wallets show up here." />
            ) : (
              <div className="nxf-ranks">
                {methods.slice(0, 5).map(({ m, amount }) => (
                  <button type="button" className="nxf-rank nxf-rank--brand" key={m.id} onClick={() => ui.openDetails({ type: 'method', id: m.id })}>
                    <BrandMark brand={m.brand} fallback={m.name} size={26} />
                    <span className="nxf-rank__body">
                      <span className="nxf-rank__head">
                        <span>{m.name}</span>
                        <span className="fin-num">{money(Math.round(amount))}</span>
                      </span>
                      <ShareBar share={amount / methods[0].amount} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="nxf-span-3">
          <section className="nxf-card">
            <div className="nxf-card__head">
              <h3>By weekday</h3>
              {byDay[busiest].amount > 0 && <span className="nxf-card__aside">{WEEKDAYS[busiest]}s most</span>}
            </div>
            {byDay.some((d) => d.amount > 0) ? (
              <ColumnChart data={byDay.map((d, i) => ({ label: d.day, name: WEEKDAYS[i], amount: d.amount }))} format={(v) => money(Math.round(v))} height={150} />
            ) : (
              <Empty text="Nothing to chart yet." />
            )}
          </section>
        </div>

        <div className="nxf-span-3">
          <section className="nxf-card">
            <div className="nxf-card__head">
              <h3>Needs review</h3>
              {review.length > 0 && <span className="nxf-chip nxf-chip--att fin-num">{review.length}</span>}
            </div>
            {review.length === 0 ? (
              <Empty text="Every category has been confirmed by you." />
            ) : (
              <div className="fin-list">
                {review.slice(0, 3).map((t) => {
                  const account = L.accountById(data, t.accountId);
                  return (
                    <div className="fin-list__row fin-review" key={t.id}>
                      <button type="button" className="fin-list__text fin-review__open" onClick={() => ui.editTransaction(t.id)}>
                        <span>{t.merchant}</span>
                        <span>
                          {shortDate(t.date)} · {t.category}
                        </span>
                      </button>
                      <span className="fin-list__amount fin-num">{moneyIn(t.amount, account?.currency ?? 'INR')}</span>
                      <button type="button" className="fin-icon-btn fin-icon-btn--ok" hidden={!live} onClick={() => dispatch({ type: 'CONFIRM_TRANSACTIONS', ids: [t.id] })} aria-label={`Confirm ${t.category} for ${t.merchant}`} title="Category is right">
                        <Check size={14} strokeWidth={2} />
                      </button>
                    </div>
                  );
                })}
                <button type="button" className="fin-pill fin-pill--outline fin-pill--sm" onClick={() => ui.go('transactions', { review: true })}>
                  Review all {review.length}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
