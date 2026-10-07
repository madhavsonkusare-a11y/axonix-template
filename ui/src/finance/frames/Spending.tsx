/**
 * Spending — where the money went, and whether the period held.
 *
 * WEEK / MONTH / YEAR drives every card on the page (in the first build it
 * changed nothing). Comparisons are period-to-date against the same point of
 * the previous period, so the 13th of September is compared with the 13th of
 * August, not with all of August.
 */
import { Check } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import { useFinanceUi } from '../ui';
import * as L from '../ledger';
import { money, moneyIn, percent, shortDate } from '../format';
import { AuroraLayers, auroraClass } from '../components/Aurora';
import { DayBars, FlowBars, barFill } from '../components/Charts';
import { BrandMark } from '../components/BrandMark';
import { LiquidSegment } from '../components/Liquid';
import { Empty } from './Overview';

const WORD: Record<L.SpendRange, { now: string; before: string }> = {
  WEEK: { now: 'this week', before: 'last week' },
  MONTH: { now: 'this month', before: 'this point last month' },
  YEAR: { now: 'this year', before: 'this time last year' },
};

function Kept({ range }: { range: L.SpendRange }) {
  const { data } = useFinance();
  const p = L.periodOf(range);
  const flow = L.flowOf(data, p);
  const prev = L.flowOf(data, L.previousPeriod(range));
  const rate = flow.in > 0 ? Math.round((flow.net / flow.in) * 100) : null;
  const prevRate = prev.in > 0 ? Math.round((prev.net / prev.in) * 100) : null;
  const top = L.categoryTotals(data, p, 1)[0];

  return (
    <div className={auroraClass('green', 'fin-saved')}>
      <AuroraLayers />
      <div className="fin-aurora__body">
        <div className="fin-saved__top">
          <div className="fin-saved__id">
            <span className="fin-saved__label">Kept {WORD[range].now}</span>
            <span className="fin-saved__amount fin-num fin-num--xl">{money(flow.net)}</span>
          </div>
          {rate !== null && <span className="fin-saved__rate">{rate}%</span>}
        </div>

        <p className="fin-saved__note">
          {rate === null
            ? 'Nothing has come in yet, so there is no rate to show.'
            : prevRate === null
              ? `You kept ${rate}% of what came in.`
              : rate >= prevRate
                ? `${rate}% of income kept — up from ${prevRate}% ${WORD[range].before}.`
                : `${rate}% of income kept — down from ${prevRate}% ${WORD[range].before}.`}
        </p>

        {top && flow.out > 0 && (
          <div className="fin-saved__fund fin-ink">
            <div>
              <span style={{ fontSize: 10.5, lineHeight: 1 }}>Biggest category · {top.label}</span>
              <div className="fin-bar fin-bar--thick">
                <div className="fin-bar__fill" style={barFill(percent(top.amount, flow.out))} />
              </div>
            </div>
            <span className="fin-num">{percent(top.amount, flow.out)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Spending({ range, onRangeChange }: { range: L.SpendRange; onRangeChange: (r: L.SpendRange) => void }) {
  const { data, dispatch } = useFinance();
  const ui = useFinanceUi();
  const p = L.periodOf(range);
  const flow = L.flowOf(data, p);
  const prev = L.flowOf(data, L.previousPeriod(range));
  const diff = flow.out - prev.out;
  const series = L.monthlySeries(data, range === 'YEAR' ? 12 : 6);
  const merchants = L.topMerchants(data, p);
  const byDay = L.byWeekday(data, p);
  // Per calendar day of the period so far. Dividing by the seven weekday
  // buckets was only right for WEEK; for a month it roughly doubled the figure.
  const daysSoFar = L.daysInPeriod(p);
  const byDayAvg = Math.round(byDay.reduce((s, d) => s + d.amount, 0) / daysSoFar);
  const methods = data.methods
    .map((m) => ({ m, amount: L.spentVia(data, m.id, p) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const methodPeak = methods[0]?.amount ?? 0;
  const review = L.needsReview(data).sort((a, b) => b.date.localeCompare(a.date));
  const hasFlows = series.some((s) => s.in || s.out);

  return (
    <div className="fin-page fin-page--tight">
      <header className="fin-page__head">
        <div className="fin-page__lead">
          <h2>Spending</h2>
          <p>
            {money(flow.out)} {WORD[range].now}
            {(prev.out > 0 || flow.out > 0) && ` · ${money(Math.abs(diff))} ${diff <= 0 ? 'less' : 'more'} than ${WORD[range].before}`}
          </p>
        </div>
        <div className="fin-page__actions">
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
        </div>
      </header>

      <div className="fin-spend__split">
        <section className="fin-card">
          <div className="fin-card__head" style={{ marginBottom: 20 }}>
            <h3 className="fin-card__title">Income vs spending</h3>
            <div className="fin-spend__legend">
              <span>
                <span className="fin-swatch" style={{ background: 'var(--fin-accent)' }} />
                In
              </span>
              <span>
                <span className="fin-swatch" style={{ background: 'rgba(255,255,255,.28)' }} />
                Out
              </span>
            </div>
          </div>
          {hasFlows ? <FlowBars data={series} /> : <Empty text="Bars appear once a month has income or spending in it." />}
        </section>

        <Kept range={range} />
      </div>

      <div className="fin-spend__quad">
        <section className="fin-card">
          <div className="fin-card__head" style={{ marginBottom: 16 }}>
            <h3 className="fin-card__title">Top merchants</h3>
          </div>
          {merchants.length === 0 ? (
            <Empty text={`No spending ${WORD[range].now}.`} />
          ) : (
            <div className="fin-list">
              {merchants.map((m) => (
                <div className="fin-list__row" key={m.name}>
                  <div className="fin-list__text">
                    <span>{m.name}</span>
                    <span>{m.count} {m.count === 1 ? 'payment' : 'payments'}</span>
                  </div>
                  <span className="fin-list__amount fin-num">{money(m.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="fin-card">
          <div className="fin-card__head" style={{ marginBottom: 16 }}>
            <h3 className="fin-card__title">Paid with</h3>
          </div>
          {methods.length === 0 ? (
            <Empty text="Payments made through GPay, cards and wallets show up here." />
          ) : (
            <div className="fin-list">
              {methods.slice(0, 5).map(({ m, amount }) => (
                <div className="fin-method" key={m.id}>
                  <BrandMark brand={m.brand} fallback={m.name} size={24} />
                  <div className="fin-method__body">
                    <div className="fin-method__head">
                      <span>{m.name}</span>
                      <span className="fin-num">{money(amount)}</span>
                    </div>
                    <div className="fin-bar fin-bar--thin">
                      <div className="fin-bar__fill" style={{ width: `${percent(amount, methodPeak)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="fin-card">
          <div className="fin-card__head" style={{ marginBottom: 16 }}>
            <h3 className="fin-card__title">By day</h3>
            <span className="fin-card__aside fin-num" style={{ fontSize: 11.5 }}>
              {money(byDayAvg)} a day
            </span>
          </div>
          {byDay.some((d) => d.amount > 0) ? <DayBars data={byDay} /> : <Empty text="Nothing to chart yet." />}
        </section>

        <section className="fin-card">
          <div className="fin-card__head" style={{ marginBottom: 16 }}>
            <h3 className="fin-card__title">Needs review</h3>
            <span className="fin-card__aside fin-num" style={{ fontSize: 11.5, color: 'var(--fin-accent-text)' }}>
              {review.length || ''}
            </span>
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
                    <button type="button" className="fin-icon-btn fin-icon-btn--ok" onClick={() => dispatch({ type: 'CONFIRM_TRANSACTIONS', ids: [t.id] })} aria-label={`Confirm ${t.category} for ${t.merchant}`} title="Category is right">
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
  );
}
