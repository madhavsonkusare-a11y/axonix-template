// Refined AXONIX wordmark: geometric capitals on a 100-unit cap height.
// Λ carries the mark's axon tip (pointed, with overshoot); X, N and I keep flat
// terminals. W is the stem; rounds run 1 unit heavier, N's diagonal 8% lighter,
// the usual optical corrections. X's crossing sits above centre (top 4 units narrower).
const W = Number(process.argv[2] ?? 15);
const f = (n) => +n.toFixed(2);
const poly = (pts, dx) => 'M' + pts.map(([x, y]) => `${f(x + dx)} ${f(y)}`).join('L') + 'Z';
const ring = (cx, r, ccw) => { const s = ccw ? 0 : 1; return `M${f(cx - r)} 50A${f(r)} ${f(r)} 0 1 ${s} ${f(cx + r)} 50A${f(r)} ${f(r)} 0 1 ${s} ${f(cx - r)} 50Z`; };
// horizontal thickness of a diagonal whose perpendicular weight is `p`, spanning `span` across 100 up
const diag = (p, span) => { let t = p; for (let i = 0; i < 30; i++) t = p / Math.sin(Math.atan(100 / (span - t))); return t; };
const glyphs = {
  A: { w: 94, d: (x) => {
    const ov = 4, t = W / Math.sin(Math.atan((100 + ov) / 47));
    const iy = 100 - (47 - t) * ((100 + ov) / 47);
    return poly([[0, 100], [47, -ov], [94, 100], [94 - t, 100], [47, iy], [t, 100]], x);
  } },
  X: { w: 88, d: (x) => { const t = diag(W, 88); return poly([[2, 0], [2 + t, 0], [88, 100], [88 - t, 100]], x) + poly([[86 - t, 0], [86, 0], [t, 100], [0, 100]], x); } },
  O: { w: 103.2, d: (x) => ring(51.6 + x, 51.6, false) + ring(51.6 + x, 51.6 - (W + 1), true) },
  N: { w: 82, d: (x) => { const t = diag(W * 0.92, 82); return poly([[0, 0], [W, 0], [W, 100], [0, 100]], x) + poly([[82 - W, 0], [82, 0], [82, 100], [82 - W, 100]], x) + poly([[0, 0], [t, 0], [82, 100], [82 - t, 100]], x); } },
  I: { w: W, d: (x) => poly([[0, 0], [W, 0], [W, 100], [0, 100]], x) },
};
const word = [['A', 0], ['X', 9], ['O', 15], ['N', 22], ['I', 30], ['X', 19]];
let x = 0; const out = [];
for (const [ch, gap] of word) { x += gap; out.push({ ch, x: f(x), w: glyphs[ch].w, d: glyphs[ch].d(x) }); x += glyphs[ch].w; }
console.log(JSON.stringify({ stem: W, width: f(x), letters: out }));
