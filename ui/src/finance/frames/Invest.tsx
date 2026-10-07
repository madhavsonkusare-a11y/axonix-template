/**
 * Invest — Indian gold rates.
 *
 * The chart is IBJA's published rate (see `gold.ts`), not COMEX spot converted
 * at USD/INR: that conversion misses import duty and the domestic premium, so
 * it never matched what an Indian buyer pays. Built like the net-worth hero —
 * same card, same gradient line — with a hover readout for any day.
 *
 * Nothing here is invented. Offline, it shows the last copy fetched, labelled
 * with its age; with no copy at all, it says so.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, RotateCw } from 'lucide-react';
import { LiquidSegment } from '../components/Liquid';
import { cachedGold, fetchGold, GOLD_FRESH_MS, type GoldPoint, type GoldRates, type Purity } from '../gold';
import { addDays, clockOf, dayLabel, delta, isoOf, money, shortDate, todayIso } from '../format';
import { openExternal } from '../external';

type Karat = '24K' | '22K';
type GoldRange = '1M' | '3M' | 'ALL';

const RANGE_DAYS: Record<GoldRange, number | null> = { '1M': 30, '3M': 91, ALL: null };
const RANGE_WORDS: Record<GoldRange, string> = { '1M': 'over the last month', '3M': 'over three months', ALL: 'since %' };
const KARAT_KEY: Record<Karat, keyof Omit<GoldPoint, 'date'>> = { '24K': 'p999', '22K': 'p916' };

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

export default function Invest() {
  const { rates, load, refresh } = useGoldRates();
  const [karat, setKarat] = useState<Karat>('24K');
  const [range, setRange] = useState<GoldRange>('3M');

  return (
    <div className="fin-page">
      <header className="fin-page__head">
        <div className="fin-page__lead">
          <h2>Invest</h2>
          <p>Indian gold rates from IBJA, the benchmark RBI prices Sovereign Gold Bonds on.</p>
        </div>
      </header>

      {rates ? (
        <>
          <GoldHero rates={rates} karat={karat} range={range} onKarat={setKarat} onRange={setRange} load={load} onRefresh={refresh} />
          <PurityRow rates={rates} />
        </>
      ) : (
        <section className="fin-card fin-gold__empty">
          {load.state === 'error' ? (
            <>
              <p className="fin-empty__text">Could not load gold rates: {load.message}</p>
              <button type="button" className="fin-pill fin-pill--sm" onClick={refresh}>
                Try again
              </button>
            </>
          ) : (
            <p className="fin-empty__text">Fetching today’s rates from IBJA…</p>
          )}
        </section>
      )}
    </div>
  );
}

function GoldHero({
  rates,
  karat,
  range,
  onKarat,
  onRange,
  load,
  onRefresh,
}: {
  rates: GoldRates;
  karat: Karat;
  range: GoldRange;
  onKarat: (k: Karat) => void;
  onRange: (r: GoldRange) => void;
  load: Load;
  onRefresh: () => void;
}) {
  const key = KARAT_KEY[karat];
  const last = rates.series[rates.series.length - 1];
  const points = useMemo(() => {
    const days = RANGE_DAYS[range];
    const from = days === null ? '' : addDays(last.date, -days);
    return rates.series.filter((p) => p.date >= from).map((p) => ({ date: p.date, value: p[key] }));
  }, [rates, range, key, last.date]);

  const [hover, setHover] = useState<number | null>(null);
  const shown = hover !== null ? points[hover] : null;

  const latest = rates.latest[karat === '24K' ? '999' : '916'] ?? Math.round(last[key]);
  const first = points[0];
  const change = last[key] - first.value;
  const pct = first.value ? (change / first.value) * 100 : 0;
  const since = RANGE_WORDS[range].replace('%', shortDate(first.date));
  const today = todayIso();

  return (
    <section className="fin-card fin-card--hi fin-gold">
      <span className="fin-grain" style={{ opacity: 0.2 }} aria-hidden="true" />

      <div className="fin-hero__top">
        <div className="fin-hero__lead">
          <p className="fin-label fin-label--wide">Gold · {karat} · per gram</p>
          <div className="fin-hero__figure">
            <span className="fin-hero__amount fin-num fin-num--lg">{money(shown ? shown.value : latest)}</span>
            {!shown && Math.abs(pct) >= 0.05 && (
              <span className={`fin-chip ${pct >= 0 ? 'fin-chip--up' : 'fin-chip--down'} fin-hero__delta fin-num`}>{delta(pct)}</span>
            )}
          </div>
          <p className="fin-hero__sub">
            {shown ? (
              <>IBJA closing rate on {dayLabel(shown.date, today)} · {money(shown.value * 10)} per 10 g</>
            ) : (
              <>
                {change >= 0 ? 'Up' : 'Down'} {money(Math.abs(change))} {since} · {money(latest * 10)} per 10 g
              </>
            )}
          </p>
        </div>

        <div className="fin-gold__controls">
          <LiquidSegment<Karat> label="Purity" value={karat} onChange={onKarat} options={[{ value: '24K', label: '24K' }, { value: '22K', label: '22K' }]} />
          <LiquidSegment<GoldRange> label="Range" value={range} onChange={onRange} options={[{ value: '1M', label: '1M' }, { value: '3M', label: '3M' }, { value: 'ALL', label: 'ALL' }]} />
        </div>
      </div>

      <GoldChart points={points} hover={hover} onHover={setHover} label={`${karat} gold per gram, ${since}`} />

      <div className="fin-hero__ticks" aria-hidden="true">
        <span>{shortDate(first.date)}</span>
        <span>{shortDate(points[Math.floor((points.length - 1) / 2)].date)}</span>
        <span>{shortDate(last.date)}</span>
      </div>

      <div className="fin-gold__status">
        <span>
          {load.state === 'loading'
            ? 'Checking IBJA for new rates…'
            : load.state === 'error'
              ? `Could not reach IBJA — showing rates fetched ${when(isoOf(new Date(rates.fetchedAt)), today)} at ${clockOf(rates.fetchedAt)}.`
              : `Latest published ${when(last.date, today)} · before GST and making charges`}
        </span>
        <button type="button" className="fin-icon-btn" onClick={onRefresh} disabled={load.state === 'loading'} aria-label="Refresh rates" title="Refresh rates">
          <RotateCw size={13} strokeWidth={1.8} className={load.state === 'loading' ? 'fin-spin' : undefined} />
        </button>
      </div>
    </section>
  );
}

const W = 1000;
const H = 220;
const PAD_TOP = 18;
const PAD_BOTTOM = 14;

function GoldChart({
  points,
  hover,
  onHover,
  label,
}: {
  points: { date: string; value: number }[];
  hover: number | null;
  onHover: (i: number | null) => void;
  label: string;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // A little air above and below, so the line never kisses the card edge.
  const span = hi - lo || hi * 0.01;
  const min = lo - span * 0.08;
  const max = hi + span * 0.08;

  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (H - PAD_TOP - PAD_BOTTOM);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  const pick = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onHover(Math.round(ratio * (points.length - 1)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const start = hover ?? points.length - 1;
    onHover(Math.min(points.length - 1, Math.max(0, start + (e.key === 'ArrowRight' ? 1 : -1))));
  };

  const at = hover ?? points.length - 1;
  // Percent translate on a plot-sized track = percent of the plot: GPU-only, no layout per move.
  const track = { transform: `translate(${(x(at) / W) * 100}%, ${(y(points[at].value) / H) * 100}%)` };

  return (
    <div
      ref={plot}
      className="fin-gold__plot"
      role="img"
      aria-label={label}
      tabIndex={0}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => onHover(null)}
      onBlur={() => onHover(null)}
      onKeyDown={onKey}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {/* Gold is the one chart drawn in its material's colour, not the accent blue. */}
        <defs>
          <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f2c14e" stopOpacity=".34" />
            <stop offset="1" stopColor="#f2c14e" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#e0a53a" />
            <stop offset=".55" stopColor="#f6cf63" />
            <stop offset="1" stopColor="#ffe29a" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,.045)" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#goldFill)" />
        <path d={line} fill="none" stroke="url(#goldLine)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="rgba(255,255,255,.28)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="fin-gold__scale fin-gold__scale--hi fin-num">{money(hi)}</span>
      <span className="fin-gold__scale fin-gold__scale--lo fin-num">{money(lo)}</span>
      {/* HTML, not SVG: the plot stretches, and a stretched circle is an ellipse. */}
      <span className="fin-gold__track" style={track} aria-hidden="true">
        <span className={hover === null ? 'fin-gold__dot' : 'fin-gold__dot fin-gold__dot--hover'} />
      </span>
    </div>
  );
}

function PurityRow({ rates }: { rates: GoldRates }) {
  return (
    <section className="fin-accounts__section">
      <div className="fin-section__head">
        <h3>Today by purity</h3>
        <p>₹ per gram, IBJA’s latest published rate.</p>
      </div>
      <div className="fin-gold__purities">
        {PURITIES.map(({ purity, karat }) => {
          const rate = rates.latest[purity];
          return (
            <div key={purity} className="fin-fact">
              <span className="fin-fact__label">
                {karat} · {purity}
              </span>
              <span className="fin-fact__value fin-num">{rate ? money(rate) : '—'}</span>
            </div>
          );
        })}
      </div>
      <button type="button" className="fin-weblink fin-gold__source" onClick={() => void openExternal('https://ibjarates.com/').catch(() => undefined)}>
        <span className="fin-weblink__text">
          <span>India Bullion and Jewellers Association</span>
          <span>ibjarates.com · published on weekdays, except central-government holidays</span>
        </span>
        <ArrowUpRight size={15} strokeWidth={1.8} />
      </button>
    </section>
  );
}
