/**
 * Charts.
 *
 * Hand-rolled SVG rather than a charting library: every chart here is a single
 * shape with a fixed viewBox, and a library would cost more bytes than the six
 * of them put together. All of them are `aria-hidden` — the figures they
 * illustrate are already on screen as text, so a second reading adds noise.
 */

/** One gradient pair, defined once and referenced by id across every chart. */
/**
 * A progress fill revealed with clip-path rather than width: the change
 * animates without laying out the bar on every frame, and the rounded end
 * stays round (a scaleX would squash it).
 */
export function barFill(percent: number): React.CSSProperties {
  const hidden = 100 - Math.min(100, Math.max(0, percent));
  return { clipPath: `inset(0 ${hidden}% 0 0 round 999px)` };
}

export function ChartDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="finFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b8cff" stopOpacity=".4" />
          <stop offset="1" stopColor="#5b8cff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="finLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7aa4ff" />
          <stop offset="1" stopColor="#7cc4ff" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Smooth segments through the points: a monotone cubic (Fritsch–Carlson)
 * drawn as Béziers, one `C` per gap. Straight segments met at sharp corners;
 * a plain spline would round them but overshoot, inventing peaks and dips the
 * data doesn't have. This one passes through every point and never leaves
 * the range between neighbours, so a flat stretch stays flat.
 */
function curveSegments(pts: [number, number][]): string[] {
  const n = pts.length;
  if (n < 2) return [];
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    slope[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  tangent[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangent[i] = t * a * slope[i];
      tangent[i + 1] = t * b * slope[i];
    }
  }
  return pts.slice(1).map(([x, y], i) => {
    const [x0, y0] = pts[i];
    const third = dx[i] / 3;
    return `C${r2(x0 + third)},${r2(y0 + tangent[i] * third)} ${r2(x - third)},${r2(y - tangent[i + 1] * third)} ${r2(x)},${r2(y)}`;
  });
}

/** Smooth path through all points, or from point `from` onward (same curve). */
const path = (pts: [number, number][], from = 0) =>
  pts.length ? `M${r2(pts[from][0])},${r2(pts[from][1])} ${curveSegments(pts).slice(from).join(' ')}` : '';

/** The same curve for charts drawn elsewhere (the new shell's chart kit). */
export const smoothPath = path;

/* ---------------- sparkline ---------------- */

export interface SparklineProps {
  /** Values in 0-1. */
  values: number[];
  stroke: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}

export function Sparkline({
  values,
  stroke,
  width = 62,
  height = 26,
  strokeWidth = 1.8,
  className = 'fin-spark',
}: SparklineProps) {
  if (values.length < 2) return null;
  // Inset by the stroke so round joins are not clipped at the extremes.
  const pad = strokeWidth;
  const pts = values.map((v, i): [number, number] => [
    (i / (values.length - 1)) * width,
    height - pad - v * (height - pad * 2),
  ]);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
    >
      <path
        d={path(pts)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------- net-worth hero ---------------- */

/** Fixed 980x196 viewBox, stretched to the card width. */
export function NetWorthChart({ points: raw }: { points: [number, number][] }) {
  // Pulled in from the right edge so today's dot and its glow are not cut in
  // half by the card.
  const points = raw.map(([x, y]): [number, number] => [x * (966 / 980), y]);
  const line = path(points);
  const last = points[points.length - 1];
  return (
    <svg
      viewBox="0 0 980 196"
      className="fin-hero__chart"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={`${line} L${last[0]},196 L0,196 Z`} fill="url(#finFill)" />
      <path
        d={line}
        fill="none"
        stroke="url(#finLine)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="10" fill="#7aa4ff" opacity=".22" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="#fbfcfe" />
    </svg>
  );
}

/* ---------------- forecast ---------------- */

export function ForecastLine({
  points,
  projectedFrom,
}: {
  points: [number, number][];
  projectedFrom: number;
}) {
  return (
    <svg viewBox="0 0 300 50" preserveAspectRatio="none" aria-hidden="true">
      <path
        d={path(points)}
        fill="none"
        stroke="#9db9ff"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Redrawn dashed over the tail: everything past today is a guess.
          Cut from the same curve, so the dashes sit exactly on the line. */}
      <path
        d={path(points, projectedFrom)}
        fill="none"
        stroke="#9db9ff"
        strokeWidth="2"
        strokeDasharray="4 5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ---------------- donut ---------------- */

const R = 54;
const CIRC = 2 * Math.PI * R;
/** Arc length surrendered to the gap between each pair of segments. */
const GAP = 4;

export interface DonutSegment {
  label: string;
  amount: number;
  color: string;
}

/**
 * Five concentric circles, offset around the ring.
 *
 * Lengths are computed from the amounts against `CIRC` minus the gaps, so the
 * segments always close exactly once round however the category split moves —
 * the mock's hardcoded dash arrays summed past the circumference and wrapped.
 */
export function Donut({ segments, size = 132 }: { segments: DonutSegment[]; size?: number }) {
  const total = segments.reduce((sum, s) => sum + s.amount, 0);
  if (total <= 0) return null;
  const usable = CIRC - GAP * segments.length;

  let start = 0;
  const arcs = segments.map((s) => {
    const len = (s.amount / total) * usable;
    const arc = { ...s, len, offset: -start };
    start += len + GAP;
    return arc;
  });

  return (
    <svg viewBox="0 0 140 140" width={size} height={size} aria-hidden="true">
      <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="14" />
      {arcs.map((a) => (
        <circle
          key={a.label}
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke={a.color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${a.len} ${CIRC - a.len}`}
          strokeDashoffset={a.offset}
        />
      ))}
    </svg>
  );
}

/* ---------------- income vs expenses ---------------- */

const FLOW_BASE = 180;
const FLOW_TOP = 46;

/** Grouped bars, one pair per month, in a fixed 880x220 viewBox. Corners are generous fillets (rx 11 on a 30-wide bar). */
export function FlowBars({ data }: { data: { month: string; in: number; out: number }[] }) {
  const peak = Math.max(...data.flatMap((d) => [d.in, d.out]));
  const scale = (v: number) => ((v / peak) * (FLOW_BASE - FLOW_TOP));
  const step = 880 / data.length;

  return (
    <svg viewBox="0 0 880 220" className="fin-spend__chart" aria-hidden="true">
      <line x1="0" y1="180" x2="880" y2="180" stroke="rgba(255,255,255,.09)" />
      <line x1="0" y1="120" x2="880" y2="120" stroke="rgba(255,255,255,.045)" />
      <line x1="0" y1="60" x2="880" y2="60" stroke="rgba(255,255,255,.045)" />
      {data.map((d, i) => {
        const x = i * step + 26;
        const hIn = scale(d.in);
        const hOut = scale(d.out);
        // The current month's "in" bar takes the gradient — it is the one
        // figure the rest of the screen is about.
        const current = i === data.length - 1;
        return (
          <g key={d.month}>
            <rect
              x={x}
              y={FLOW_BASE - hIn}
              width="30"
              height={hIn}
              rx="11"
              fill={current ? 'url(#finLine)' : '#5b8cff'}
            />
            <rect
              x={x + 34}
              y={FLOW_BASE - hOut}
              width="30"
              height={hOut}
              rx="11"
              fill={`rgba(255,255,255,${current ? '.36' : '.26'})`}
            />
            <text
              x={x + 32}
              y="202"
              fill="rgba(226,234,252,.34)"
              fontFamily="Azeret Mono, ui-monospace"
              fontSize="10.5"
              textAnchor="middle"
            >
              {d.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------- by day ---------------- */

/** Seven bars, opacity ramped by share of the week's peak. */
export function DayBars({ data }: { data: { day: string; amount: number }[] }) {
  const peak = Math.max(...data.map((d) => d.amount));
  const step = 300 / data.length;
  return (
    <svg viewBox="0 0 300 150" className="fin-spend__day" aria-hidden="true">
      {data.map((d, i) => {
        const h = (d.amount / peak) * 114;
        const share = d.amount / peak;
        return (
          <g key={`${d.day}-${i}`}>
            <rect
              x={i * step + 4}
              y={140 - h}
              width="30"
              height={h}
              rx="10"
              fill={share === 1 ? '#5b8cff' : `rgba(91,140,255,${(0.3 + share * 0.55).toFixed(2)})`}
            />
            <text
              x={i * step + 19}
              y="150"
              fill="rgba(226,234,252,.34)"
              fontFamily="Azeret Mono, ui-monospace"
              fontSize="10"
              textAnchor="middle"
            >
              {d.day}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
