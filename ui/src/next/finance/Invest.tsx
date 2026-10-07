/**
 * Invest, second version — what is put away, and the gold rate.
 *
 * The first Invest showed only IBJA's gold rate: a page called Invest that
 * said nothing about the owner's investments. Now it opens with them — what is
 * invested, how that has moved, where it sits and what went in this month and
 * this year — and keeps the gold rate below, with digital gold read out in
 * grams at today's rate.
 *
 * The gold figures are still IBJA's published rate (see `finance/gold.ts`),
 * never invented: offline it shows the last copy fetched, with its age.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RotateCw } from 'lucide-react';
import { useFinance } from '../../finance/FinanceContext';
import { useFinanceUi } from '../../finance/ui';
import * as L from '../../finance/ledger';
import { cachedGold, fetchGold, GOLD_FRESH_MS, type GoldPoint, type GoldRates, type Purity } from '../../finance/gold';
import { addDays, clockOf, dayLabel, delta, isoOf, money, moneyIn, shortDate } from '../../finance/format';
import { useDay } from '../scrub/Scrub';
import { openExternal } from '../../finance/external';
import { BrandMark } from '../../finance/components/BrandMark';
import { LiquidSegment } from '../../finance/components/Liquid';
import { Secret, useTotalsRevealed } from '../../finance/components/Secret';
import { AreaChart, ShareBar } from '../charts';
import * as D from './derive';

type Karat = '24K' | '22K';
type GoldRange = '1M' | '3M' | 'ALL';

const RANGE_DAYS: Record<GoldRange, number | null> = { '1M': 30, '3M': 91, ALL: null };
const RANGE_WORDS: Record<GoldRange, string> = { '1M': 'over the last month', '3M': 'over three months', ALL: 'since %' };
const KARAT_KEY: Record<Karat, keyof Omit<GoldPoint, 'date'>> = { '24K': 'p999', '22K': 'p916' };
const WORTH_WORDS: Record<L.TimeRange, string> = { '1W': 'over the week', '1M': 'over the month', '6M': 'over six months', '1Y': 'over the year', All: 'all time' };
/** Gold is drawn in its material's colour: the one chart that is not ink. */
const GOLD = '#f2c14e';

const PURITIES: { purity: Purity; karat: string }[] = [
  { purity: '999', karat: '24K' },
  { purity: '995', karat: '24K' },
  { purity: '916', karat: '22K' },
  { purity: '750', karat: '18K' },
  { purity: '585', karat: '14K' },
];

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };

/** "today", "yesterday", or "on Fri 11 SEP" — only the relative words go lower case. */
function when(iso: string, today: string): string {
  const label = dayLabel(iso, today);
  return iso >= addDays(today, -1) ? label.toLowerCase() : `on ${label}`;
}

function useGoldRates() {
  const [rates, setRates] = useState<GoldRates | null>(() => cachedGold());
  const [load, setLoad] = useState<Load>(() => (rates ? { state: 'ready' } : { state: 'loading' }));

  const refresh = useCallback(() => {
    setLoad({ state: 'loading' });
    fetchGold()
      .then((r) => {
        setRates(r);
        setLoad({ state: 'ready' });
      })
      .catch((e: unknown) => setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) }));
  }, []);

  useEffect(() => {
    const cached = cachedGold();
    if (!cached || Date.now() - Date.parse(cached.fetchedAt) > GOLD_FRESH_MS) refresh();
  }, [refresh]);

  return { rates, load, refresh };
}

/** What is invested, over time. */
function Invested({ range, onRange }: { range: L.TimeRange; onRange: (r: L.TimeRange) => void }) {
  const { data } = useFinance();
  const revealed = useTotalsRevealed();
  const today = useDay();
  const dates = useMemo(() => D.seriesDates(data, range, today), [data, range, today]);
  const values = useMemo(() => dates.map((at) => L.netWorth(data, at).invested), [data, dates]);
  const now = L.netWorth(data).invested;
  const start = values[0] ?? 0;
  const change = now - start;
  const pct = start > 0 ? (change / start) * 100 : null;

  return (
    <section className="nxf-card nxf-worth">
      <div className="nxf-worth__top">
        <div className="nxf-worth__lead">
          <p className="nxf-label">Invested</p>
          <div className="nxf-worth__figure">
            <Secret className="nxf-worth__amount fin-num" label="Invested" value={money(Math.round(now))} />
            {pct !== null && Math.abs(pct) >= 0.05 && Math.abs(pct) <= 200 && <span className={`nxf-chip ${pct >= 0 ? 'nxf-chip--pos' : 'nxf-chip--neg'} fin-num`}>{delta(pct)}</span>}
          </div>
          <p className="nxf-worth__sub">
            <b className={change >= 0 ? 'fin-num nxf-pos' : 'fin-num nxf-neg'}>{money(Math.round(change), { signed: true })}</b> {WORTH_WORDS[range]}
          </p>
        </div>
        <LiquidSegment<L.TimeRange> label="Invested range" value={range} onChange={onRange} options={L.TIME_RANGES.map((r) => ({ value: r, label: r === 'All' ? 'ALL' : r }))} />
      </div>
      <AreaChart values={values} labels={dates.map(D.tipDate)} format={(v) => money(Math.round(v))} axis={D.compactInr} hidden={!revealed} drawKey={range} height={200} />
      <div className="nxf-worth__ticks fin-num" aria-hidden="true">
        <span>{shortDate(dates[0])}</span>
        <span>{shortDate(dates[Math.floor((dates.length - 1) / 2)])}</span>
        <span>{shortDate(dates[dates.length - 1])}</span>
      </div>
      <p className="nxf-note nxf-worth__note">This follows what you put in and the balances you set. It is not a market return.</p>
    </section>
  );
}

/** Where it sits, and what went in. */
function Holdings({ gram }: { gram?: number }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const revealed = useTotalsRevealed();
  const today = useDay();
  const month = L.monthPeriod(today);
  const year = L.periodOf('YEAR', today);
  const rows = data.accounts
    .filter((a) => !a.archived && L.isInvested(a))
    .map((a) => ({ a, value: L.balanceInr(data, a), month: L.accountFlow(data, a.id, month).in, year: L.accountFlow(data, a.id, year).in }))
    .sort((x, y) => y.value - x.value);
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.value), 0);
  const putMonth = rows.reduce((sum, r) => sum + L.inr(r.a, r.month), 0);
  const putYear = rows.reduce((sum, r) => sum + L.inr(r.a, r.year), 0);

  return (
    <section className="nxf-card">
      <div className="nxf-card__head">
        <h3>Where it sits</h3>
        <button type="button" className="nxf-card__link" onClick={() => ui.go('accounts')}>
          Accounts <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="fin-empty">
          <p className="fin-empty__text">No PPF, EPF, demat, gold or deposit account yet.</p>
          <button type="button" className="fin-pill fin-pill--sm" onClick={() => ui.editAccount({ type: 'account' })}>
            Add one
          </button>
        </div>
      ) : (
        <>
          <div className="nxf-put">
            <div>
              <p className="nxf-label">Put in this month</p>
              <span className="fin-num">{money(Math.round(putMonth))}</span>
            </div>
            <div>
              <p className="nxf-label">This year</p>
              <span className="fin-num">{money(Math.round(putYear))}</span>
            </div>
          </div>
          <div className="nxf-rows">
            {rows.map(({ a, value, year: put }) => {
              const unset = L.needsBalance(data, a);
              const grams = a.kind === 'gold' && gram && value > 0 ? value / gram : null;
              return (
                <button type="button" className="nxf-row nxf-holding" key={a.id} onClick={() => (unset ? ui.editAccount({ type: 'account', id: a.id }) : ui.openDetails({ type: 'account', id: a.id }))}>
                  <BrandMark brand={a.brand} fallback={a.name} size={28} />
                  <span className="nxf-row__text">
                    <span>{a.name}</span>
                    <span>
                      {L.KIND_LABEL[a.kind]}
                      {grams !== null && revealed && ` · about ${grams.toFixed(2)} g at today’s rate`}
                      {grams === null && put > 0 && ` · ${moneyIn(Math.round(put), a.currency)} put in this year`}
                    </span>
                    {!unset && <ShareBar share={total > 0 ? Math.max(0, value) / total : 0} />}
                  </span>
                  <span className="nxf-row__end">
                    {unset ? <span className="fin-link">Set balance</span> : <span className="fin-num">{revealed ? moneyIn(L.balanceOf(data, a.id), a.currency) : '••••'}</span>}
                    {!unset && total > 0 && <span className="nxf-when fin-num">{Math.round((Math.max(0, value) / total) * 100)}%</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function Gold({ rates, load, onRefresh }: { rates: GoldRates; load: Load; onRefresh: () => void }) {
  const [karat, setKarat] = useState<Karat>('24K');
  const [range, setRange] = useState<GoldRange>('3M');
  const key = KARAT_KEY[karat];
  const last = rates.series[rates.series.length - 1];
  const points = useMemo(() => {
    const days = RANGE_DAYS[range];
    const from = days === null ? '' : addDays(last.date, -days);
    return rates.series.filter((p) => p.date >= from).map((p) => ({ date: p.date, value: p[key] }));
  }, [rates, range, key, last.date]);

  const latest = rates.latest[karat === '24K' ? '999' : '916'] ?? Math.round(last[key]);
  const first = points[0];
  const change = last[key] - first.value;
  const pct = first.value ? (change / first.value) * 100 : 0;
  const since = RANGE_WORDS[range].replace('%', shortDate(first.date));
  const today = useDay();

  return (
    <section className="nxf-card nxf-worth nxf-gold">
      <div className="nxf-worth__top">
        <div className="nxf-worth__lead">
          <p className="nxf-label">Gold · {karat} · per gram</p>
          <div className="nxf-worth__figure">
            <span className="nxf-worth__amount fin-num">{money(latest)}</span>
            {Math.abs(pct) >= 0.05 && <span className={`nxf-chip ${pct >= 0 ? 'nxf-chip--pos' : 'nxf-chip--neg'} fin-num`}>{delta(pct)}</span>}
          </div>
          <p className="nxf-worth__sub">
            <b className={change >= 0 ? 'fin-num nxf-pos' : 'fin-num nxf-neg'}>{money(Math.round(change), { signed: true })}</b> {since} · <span className="fin-num">{money(latest * 10)}</span> per 10 g
          </p>
        </div>
        <div className="nxf-gold__controls">
          <LiquidSegment<Karat> label="Purity" value={karat} onChange={setKarat} options={[{ value: '24K', label: '24K' }, { value: '22K', label: '22K' }]} />
          <LiquidSegment<GoldRange> label="Range" value={range} onChange={setRange} options={[{ value: '1M', label: '1M' }, { value: '3M', label: '3M' }, { value: 'ALL', label: 'ALL' }]} />
        </div>
      </div>

      <AreaChart
        values={points.map((p) => p.value)}
        labels={points.map((p) => `IBJA close · ${D.tipDate(p.date)}`)}
        format={(v) => `${money(Math.round(v))} · ${money(Math.round(v * 10))} per 10 g`}
        axis={(v) => money(Math.round(v))}
        drawKey={`${karat}-${range}`}
        color={GOLD}
        label={`${karat} gold per gram, ${since}`}
      />
      <div className="nxf-worth__ticks fin-num" aria-hidden="true">
        <span>{shortDate(first.date)}</span>
        <span>{shortDate(points[Math.floor((points.length - 1) / 2)].date)}</span>
        <span>{shortDate(last.date)}</span>
      </div>

      <div className="nxf-gold__status">
        <span>
          {load.state === 'loading'
            ? 'Checking IBJA for new rates…'
            : load.state === 'error'
              ? `Could not reach IBJA — showing rates fetched ${when(isoOf(new Date(rates.fetchedAt)), today)} at ${clockOf(rates.fetchedAt)}.`
              : `Latest published ${when(last.date, today)} · before GST and making charges`}
        </span>
        <button type="button" className="nx-iconbtn" onClick={onRefresh} disabled={load.state === 'loading'} aria-label="Refresh rates" title="Refresh rates">
          <RotateCw size={14} strokeWidth={1.8} className={load.state === 'loading' ? 'fin-spin' : undefined} />
        </button>
      </div>
    </section>
  );
}

function Purities({ rates }: { rates: GoldRates }) {
  const top = Math.max(1, ...PURITIES.map((p) => rates.latest[p.purity] ?? 0));
  return (
    <section className="nxf-card">
      <div className="nxf-card__head">
        <h3>Today by purity</h3>
        <span className="nxf-card__aside">₹ per gram</span>
      </div>
      <div className="nxf-purities">
        {PURITIES.map(({ purity, karat }) => {
          const rate = rates.latest[purity];
          return (
            <div className="nxf-purity" key={purity}>
              <span className="nxf-purity__name">
                {karat} <i className="fin-num">{purity}</i>
              </span>
              <span className="fin-num">{rate ? money(rate) : '—'}</span>
              <ShareBar share={(rate ?? 0) / top} color={GOLD} />
            </div>
          );
        })}
      </div>
      <button type="button" className="nxf-source" onClick={() => void openExternal('https://ibjarates.com/').catch(() => undefined)}>
        <span>
          <span>India Bullion and Jewellers Association</span>
          <span>ibjarates.com · published on weekdays, except central-government holidays</span>
        </span>
        <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </section>
  );
}

export default function Invest() {
  const { data } = useFinance();
  const { rates, load, refresh } = useGoldRates();
  const [range, setRange] = useState<L.TimeRange>('6M');
  const invested = data.accounts.filter((a) => !a.archived && L.isInvested(a));
  const total = L.netWorth(data).invested;

  return (
    <div className="nxf-page">
      <header className="nxf-head">
        <div>
          <h2>Invest</h2>
          <p>
            {invested.length === 0
              ? 'What you have put away shows here once an investment account exists.'
              : `${invested.length} ${invested.length === 1 ? 'account' : 'accounts'} holding what you have put away${total > 0 ? '' : ' · set their balances to see the total'}`}
          </p>
        </div>
      </header>

      <div className="nxf-grid">
        <div className="nxf-span-8">
          <Invested range={range} onRange={setRange} />
        </div>
        <div className="nxf-span-4">
          <Holdings gram={rates?.latest['999']} />
        </div>

        {rates ? (
          <>
            <div className="nxf-span-8">
              <Gold rates={rates} load={load} onRefresh={refresh} />
            </div>
            <div className="nxf-span-4">
              <Purities rates={rates} />
            </div>
          </>
        ) : (
          <div className="nxf-span-12">
            <section className="nxf-card">
              <div className="nxf-card__head">
                <h3>Gold rate</h3>
              </div>
              {load.state === 'error' ? (
                <div className="fin-empty">
                  <p className="fin-empty__text">Could not load gold rates: {load.message}</p>
                  <button type="button" className="fin-pill fin-pill--sm" onClick={refresh}>
                    Try again
                  </button>
                </div>
              ) : (
                <p className="fin-empty__text">Fetching today’s rates from IBJA…</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
