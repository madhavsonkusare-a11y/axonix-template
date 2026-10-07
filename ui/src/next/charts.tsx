/**
 * The new shell's chart kit.
 *
 * Still hand-rolled SVG, but drawn at the size they are shown (a
 * ResizeObserver feeds the width), so type stays crisp and dots stay round,
 * and every chart answers the pointer: the figure under it is read out in a
 * small glass chip. Ink by default; hue only where it carries a reason
 * (green = money in, amber = ahead of pace, category colours = the owner's).
 *
 * The charts stay `aria-hidden`: each sits beside the same figures as text.
 */
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { smoothPath } from '../finance/components/Charts';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The live width of an element. Zero until it is laid out. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const watch = new ResizeObserver(() => setWidth(el.clientWidth));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The read-out that follows the pointer. `x` is clamped so it never leaves the chart. */
function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const half = 84;
  const left = width > half * 2 ? clamp(x, half, width - half) : width / 2;
  return (
    <div className="nx-tip" style={{ transform: `translate3d(${r1(left)}px, ${r1(y)}px, 0)` }}>
      <div className="nx-tip__box">{children}</div>
    </div>
  );
}

/** A top-rounded bar. */
function bar(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.min(r, w / 2, Math.max(0, h));
  return `M${r1(x)},${r1(y + h)} V${r1(y + k)} Q${r1(x)},${r1(y)} ${r1(x + k)},${r1(y)} H${r1(x + w - k)} Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + k)} V${r1(y + h)} Z`;
}

/* ---------------- area: a value over time ---------------- */

export function AreaChart({
  values,
  labels,
  format,
  axis,
  height = 220,
  hidden = false,
  drawKey,
  color = 'var(--nx-ink)',
  label,
}: {
  values: number[];
  /** What each point is called in the read-out, e.g. its date. */
  labels: string[];
  format: (v: number) => string;
  /** Short form for the high and low guides. */
  axis: (v: number) => string;
  height?: number;
  /** Totals not revealed: draw the shape, keep the figures back. */
  hidden?: boolean;
  /** Changes when the series is a different one, so the line draws in again. */
  drawKey: string;
  /** Ink, unless the thing charted has a colour of its own (gold). */
  color?: string;
  /** Names the chart and makes it reachable: arrow keys then walk the points. */
  label?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const n = values.length;
  const top = 30;
  const bottom = 12;
  const right = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const px = (i: number) => (n <= 1 ? w - right : (i / (n - 1)) * (w - right));
  const py = (v: number) => (flat ? height * 0.68 : top + (1 - (v - min) / (max - min)) * (height - top - bottom));
  const pts: [number, number][] = n <= 1 ? [[0, py(values[0] ?? 0)], [w - right, py(values[0] ?? 0)]] : values.map((v, i) => [px(i), py(v)]);
  const line = smoothPath(pts);
  const end = pts[pts.length - 1];
  const at = hover !== null && n > 1 ? hover : null;

  return (
    <div
      ref={ref}
      className="nx-chart nx-area"
      style={{ height }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      tabIndex={label ? 0 : undefined}
      onPointerMove={(e) => {
        if (n <= 1 || w <= right) return;
        const box = e.currentTarget.getBoundingClientRect();
        setHover(clamp(Math.round(((e.clientX - box.left) / (w - right)) * (n - 1)), 0, n - 1));
      }}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setHover(clamp((hover ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1), 0, n - 1));
      }}
    >
      {w > 0 && (
        <svg width={w} height={height}>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".2" />
              <stop offset=".7" stopColor={color} stopOpacity=".03" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={color} stopOpacity=".45" />
              <stop offset=".6" stopColor={color} />
            </linearGradient>
          </defs>
          {!flat &&
            [max, min].map((v) => (
              <line key={v} className="nx-chart__guide" x1="0" x2={w} y1={py(v)} y2={py(v)} />
            ))}
          <g key={drawKey} className="nx-chart__draw">
            <path d={`${line} L${end[0]},${height} L0,${height} Z`} fill={`url(#${id}-fill)`} />
            <path d={line} fill="none" stroke={`url(#${id}-line)`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
          {!flat && !hidden && (
            <>
              <text className="nx-chart__axis" x="26" y={py(max) - 7}>
                {axis(max)}
              </text>
              <text className="nx-chart__axis" x="26" y={py(min) - 7}>
                {axis(min)}
              </text>
            </>
          )}
          {at === null ? (
            <>
              <circle cx={end[0]} cy={end[1]} r="9" fill={color} opacity=".14" />
              <circle cx={end[0]} cy={end[1]} r="3.5" fill={color} />
            </>
          ) : (
            <>
              <line className="nx-chart__cursor" x1={pts[at][0]} x2={pts[at][0]} y1={top - 12} y2={height} />
              <circle cx={pts[at][0]} cy={pts[at][1]} r="4.5" fill="var(--nx-paper)" stroke={color} strokeWidth="2" />
            </>
          )}
        </svg>
      )}
      {at !== null && (
        <Tip x={pts[at][0]} y={pts[at][1] - 14} width={w}>
          <span>{labels[at]}</span>
          {!hidden && <b className="fin-num">{format(values[at])}</b>}
        </Tip>
      )}
    </div>
  );
}

/* ---------------- pace: this month against last, day for day ---------------- */

export function PaceChart({
  now,
  before,
  days,
  limit,
  format,
  nowLabel,
  beforeLabel,
  ahead,
  height = 132,
}: {
  now: number[];
  before: number[];
  days: number;
  /** The month's total budget, drawn as a ceiling when there is one. */
  limit?: number;
  format: (v: number) => string;
  nowLabel: string;
  beforeLabel: string;
  /** Spending faster than last month: the marker turns amber. */
  ahead: boolean;
  height?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const top = 12;
  const bottom = 6;
  const right = 10;
  const peak = Math.max(1, now[now.length - 1] ?? 0, before[before.length - 1] ?? 0, limit ?? 0);
  const px = (i: number) => (days <= 1 ? 0 : (i / (days - 1)) * (w - right));
  const py = (v: number) => top + (1 - Math.max(0, v) / peak) * (height - top - bottom);
  const steps = (series: number[]) => series.map((v, i) => `${i ? 'L' : 'M'}${r1(px(i))},${r1(py(v))}`).join(' ');
  const last = now.length - 1;

  return (
    <div
      ref={ref}
      className="nx-chart nx-pace"
      style={{ height }}
      aria-hidden="true"
      onPointerMove={(e) => {
        if (w <= right) return;
        const box = e.currentTarget.getBoundingClientRect();
        setHover(clamp(Math.round(((e.clientX - box.left) / (w - right)) * (days - 1)), 0, days - 1));
      }}
      onPointerLeave={() => setHover(null)}
    >
      {w > 0 && (
        <svg width={w} height={height}>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--nx-ink)" stopOpacity=".16" />
              <stop offset="1" stopColor="var(--nx-ink)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="nx-chart__guide" x1="0" x2={w} y1={height - bottom} y2={height - bottom} />
          {limit ? <line className="nx-chart__guide nx-chart__guide--strong" x1="0" x2={w} y1={py(limit)} y2={py(limit)} /> : null}
          {before.length > 1 && <path d={steps(before)} fill="none" stroke="var(--nx-ink-4)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
          {now.length > 0 && (
            <>
              <path d={`${steps(now)} L${r1(px(last))},${height - bottom} L0,${height - bottom} Z`} fill={`url(#${id}-fill)`} />
              <path d={steps(now)} fill="none" stroke="var(--nx-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={px(last)} cy={py(now[last])} r="8" fill={ahead ? 'var(--nx-att)' : 'var(--nx-ink)'} opacity=".16" />
              <circle cx={px(last)} cy={py(now[last])} r="3.5" fill={ahead ? 'var(--nx-att)' : 'var(--nx-ink)'} />
            </>
          )}
          {hover !== null && <line className="nx-chart__cursor" x1={px(hover)} x2={px(hover)} y1="0" y2={height - bottom} />}
        </svg>
      )}
      {hover !== null && (
        <Tip x={px(hover)} y={top + 4} width={w}>
          <span>Day {hover + 1}</span>
          {hover < now.length && (
            <b className="fin-num">
              {nowLabel} {format(now[hover])}
            </b>
          )}
          {hover < before.length && (
            <span className="fin-num">
              {beforeLabel} {format(before[hover])}
            </span>
          )}
        </Tip>
      )}
    </div>
  );
}

/* ---------------- flow: money in and out, month by month ---------------- */

export function FlowChart({ data, format, axis, height = 236 }: { data: { month: string; in: number; out: number }[]; format: (v: number) => string; axis: (v: number) => string; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const top = 14;
  const base = height - 28;
  const left = 44;
  const peak = Math.max(1, ...data.flatMap((d) => [d.in, d.out]));
  const slot = (w - left) / Math.max(1, data.length);
  const bw = clamp(slot * 0.24, 6, 26);
  const gap = Math.max(3, bw * 0.22);
  const py = (v: number) => base - (Math.max(0, v) / peak) * (base - top);
  const cx = (i: number) => left + slot * (i + 0.5);

  return (
    <div
      ref={ref}
      className="nx-chart nx-flow"
      style={{ height }}
      aria-hidden="true"
      onPointerMove={(e) => {
        if (slot <= 0) return;
        const box = e.currentTarget.getBoundingClientRect();
        const i = Math.floor((e.clientX - box.left - left) / slot);
        setHover(i >= 0 && i < data.length ? i : null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {w > 0 && (
        <svg width={w} height={height}>
          {[1, 0.5, 0].map((f) => (
            <g key={f}>
              <line className={f === 0 ? 'nx-chart__guide nx-chart__guide--strong' : 'nx-chart__guide'} x1={left} x2={w} y1={py(peak * f)} y2={py(peak * f)} />
              {f > 0 && (
                <text className="nx-chart__axis" x={left - 10} y={py(peak * f) + 3.5} textAnchor="end">
                  {axis(peak * f)}
                </text>
              )}
            </g>
          ))}
          {hover !== null && <rect className="nx-chart__band" x={cx(hover) - slot / 2 + 4} y={top - 8} width={Math.max(0, slot - 8)} height={base - top + 8} rx="10" />}
          {data.map((d, i) => {
            const quiet = hover !== null && hover !== i;
            return (
              <g key={`${d.month}-${i}`} opacity={quiet ? 0.4 : 1} className="nx-chart__fade">
                {d.in > 0 && <path d={bar(cx(i) - bw - gap / 2, py(d.in), bw, base - py(d.in), 6)} fill="var(--nx-pos)" />}
                {d.out > 0 && <path d={bar(cx(i) + gap / 2, py(d.out), bw, base - py(d.out), 6)} fill="var(--nx-ink)" opacity=".82" />}
                <text className={i === data.length - 1 ? 'nx-chart__axis nx-chart__axis--on' : 'nx-chart__axis'} x={cx(i)} y={height - 8} textAnchor="middle">
                  {d.month}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <Tip x={cx(hover)} y={Math.min(py(data[hover].in), py(data[hover].out)) - 10} width={w}>
          <span>{data[hover].month}</span>
          <b className="fin-num nx-tip__pos">In {format(data[hover].in)}</b>
          <b className="fin-num">Out {format(data[hover].out)}</b>
          <span className="fin-num">Kept {format(data[hover].in - data[hover].out)}</span>
        </Tip>
      )}
    </div>
  );
}

/* ---------------- columns: one amount per step ---------------- */

export interface Column {
  /** Under the column. Empty to leave the slot unlabelled. */
  label: string;
  /** In the read-out. */
  name: string;
  amount: number;
}

export function ColumnChart({ data, format, average, height = 168, mark }: { data: Column[]; format: (v: number) => string; average?: number; height?: number; /** The column that stays lit at rest. The tallest, unless one is named (today). */ mark?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const top = 16;
  const base = height - 24;
  const peak = Math.max(1, ...data.map((d) => d.amount));
  const slot = w / Math.max(1, data.length);
  const bw = clamp(slot * 0.62, 3, 30);
  const py = (v: number) => base - (Math.max(0, v) / peak) * (base - top);
  const cx = (i: number) => slot * (i + 0.5);
  const tallest = mark ?? data.reduce((best, d, i) => (d.amount > data[best].amount ? i : best), 0);

  return (
    <div
      ref={ref}
      className="nx-chart nx-columns"
      style={{ height }}
      aria-hidden="true"
      onPointerMove={(e) => {
        if (slot <= 0) return;
        const box = e.currentTarget.getBoundingClientRect();
        setHover(clamp(Math.floor((e.clientX - box.left) / slot), 0, data.length - 1));
      }}
      onPointerLeave={() => setHover(null)}
    >
      {w > 0 && (
        <svg width={w} height={height}>
          <line className="nx-chart__guide nx-chart__guide--strong" x1="0" x2={w} y1={base} y2={base} />
          {data.map((d, i) => {
            const on = hover === i || (hover === null && i === tallest && d.amount > 0);
            const h = d.amount > 0 ? Math.max(2, base - py(d.amount)) : 0;
            return (
              <g key={i}>
                {h > 0 ? <path className="nx-chart__fade" d={bar(cx(i) - bw / 2, base - h, bw, h, Math.min(6, bw / 2))} fill="var(--nx-ink)" opacity={on ? 1 : 0.3} /> : <circle cx={cx(i)} cy={base - 3} r="1.2" fill="var(--nx-ink-4)" />}
                {d.label && (
                  <text className={on ? 'nx-chart__axis nx-chart__axis--on' : 'nx-chart__axis'} x={cx(i)} y={height - 6} textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
          {average !== undefined && average > 0 && average < peak && <line className="nx-chart__cursor" x1="0" x2={w} y1={py(average)} y2={py(average)} />}
        </svg>
      )}
      {hover !== null && (
        <Tip x={cx(hover)} y={py(data[hover].amount) - 10} width={w}>
          <span>{data[hover].name}</span>
          <b className="fin-num">{format(data[hover].amount)}</b>
        </Tip>
      )}
    </div>
  );
}

/* ---------------- ring: shares of a whole ---------------- */

export interface Slice {
  label: string;
  amount: number;
  color: string;
}

/** A donut whose centre speaks: the total at rest, the slice under the pointer. */
export function Ring({
  slices,
  size = 164,
  thickness = 15,
  active,
  onActive,
  children,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  active: number | null;
  onActive: (i: number | null) => void;
  /** The centre. */
  children: ReactNode;
}) {
  const total = slices.reduce((sum, s) => sum + s.amount, 0);
  const r = (size - thickness) / 2 - 2;
  const round = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 5 : 0;
  const usable = round - gap * slices.length;

  let start = 0;
  const arcs = slices.map((s) => {
    const len = total > 0 ? (s.amount / total) * usable : 0;
    const arc = { ...s, len, offset: -start };
    start += len + gap;
    return arc;
  });

  return (
    <div className="nx-ring" style={{ width: size, height: size }} onPointerLeave={() => onActive(null)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--nx-rule)" strokeWidth={thickness} />
          {arcs.map((a, i) => (
            <circle
              key={a.label}
              className="nx-ring__arc"
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={active === i ? thickness + 4 : thickness}
              strokeLinecap={slices.length > 1 ? 'round' : 'butt'}
              /* Round caps add half the stroke at each end; the arc is drawn that much shorter. */
              strokeDasharray={`${Math.max(0.01, a.len - (slices.length > 1 ? thickness : 0))} ${round}`}
              strokeDashoffset={a.offset - (slices.length > 1 ? thickness / 2 : 0)}
              opacity={active !== null && active !== i ? 0.28 : 1}
              onPointerEnter={() => onActive(i)}
            />
          ))}
        </g>
      </svg>
      <div className="nx-ring__centre">{children}</div>
    </div>
  );
}

/* ---------------- meter: progress against a limit ---------------- */

/**
 * A bar with a tick where today is in the month. Fill past the tick means the
 * money is going faster than the days are: amber. Past the limit: red.
 */
export function Meter({ value, limit, pace }: { value: number; limit: number; pace?: number }) {
  const share = limit > 0 ? value / limit : 0;
  const tone = share > 1 ? 'over' : pace !== undefined && share > pace + 0.04 && share > 0.08 ? 'ahead' : 'fine';
  const hidden = 100 - clamp(share * 100, 0, 100);
  return (
    <div className="nx-meter" data-tone={tone}>
      <div className="nx-meter__fill" style={{ clipPath: `inset(0 ${hidden}% 0 0 round 999px)` }} />
      {pace !== undefined && <span className="nx-meter__tick" style={{ left: `${clamp(pace * 100, 0, 100)}%` }} />}
    </div>
  );
}

/* ---------------- share: one thin bar ---------------- */

export function ShareBar({ share, color, className }: { share: number; color?: string; className?: string }) {
  const style: CSSProperties = { clipPath: `inset(0 ${100 - clamp(share * 100, 0, 100)}% 0 0 round 999px)`, background: color };
  return (
    <div className={['nx-share', className].filter(Boolean).join(' ')}>
      <div className="nx-share__fill" style={style} />
    </div>
  );
}

/* ---------------- stack: how a whole splits ---------------- */

export function StackBar({ parts }: { parts: { label: string; value: number; tone: 'ink' | 'soft' | 'faint' | 'danger' }[] }) {
  const shown = parts.filter((p) => p.value > 0);
  if (shown.length === 0) return <div className="nx-stack nx-stack--empty" />;
  return (
    <div className="nx-stack" aria-hidden="true">
      {shown.map((p) => (
        <span key={p.label} data-tone={p.tone} style={{ flexGrow: p.value }} title={p.label} />
      ))}
    </div>
  );
}
