/**
 * A total you keep to yourself.
 *
 * Hidden, the figure is not on screen at all — only a slow field of particles
 * where it would be, after Telegram's spoilers. The field is button-shaped and
 * its particles fade out as they near that edge, so it has no visible border.
 * The pointer opens a soft circle as it travels: the figure is solid at the
 * cursor and fades out to nothing by the circle's edge, while the particles
 * thin inside it. A single click reveals every total at once and throws the
 * particles outward as it goes.
 *
 * Showing is a session thing, kept in `sessionStorage`: closing Axonix hides
 * the numbers again, but moving between frames does not.
 *
 * The numbers below are the owner's, picked on the tuning bench (2026-09-20).
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/** Owner-approved field settings. */
const FIELD = {
  size: 2, // particle radius in px
  drift: 0.1, // px per frame while hidden
  density: 1.7, // particles per 100 px²
  force: 2.7, // outward push when the totals are revealed
  fade: 1.2, // seconds for that flight to die out
  reach: 88, // px the pointer clears around itself
  pad: 9, // px the field spills past the figure
  feather: 14, // px of fade inside the field's edge
};

/**
 * Signed distance from a point to a pill — the field's own shape, so it sits on
 * the page like a button rather than a rectangle. Negative inside, positive out.
 */
function toEdge(x: number, y: number, w: number, h: number): number {
  const r = Math.min(w, h) / 2;
  const dx = Math.abs(x - w / 2) - (w / 2 - r);
  const dy = Math.abs(y - h / 2) - (h / 2 - r);
  const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
  return out + Math.min(Math.max(dx, dy), 0);
}

const KEY = 'axonix.totals.revealed';

const listeners = new Set<() => void>();
let revealed = read();

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function setRevealed(on: boolean) {
  revealed = on;
  try {
    sessionStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode, or storage refused: the session simply forgets */
  }
  for (const fire of listeners) fire();
}

function subscribe(fire: () => void) {
  listeners.add(fire);
  return () => listeners.delete(fire);
}

/** Whether totals are showing. All of them flip together. */
export function useTotalsRevealed(): boolean {
  return useSyncExternalStore(subscribe, () => revealed, () => false);
}

/* ------------------------------------------------------------------ */
/* the particle field                                                  */
/*                                                                     */
/* Every field shares one animation frame, so a screen of totals costs */
/* one loop rather than seven.                                         */
/* ------------------------------------------------------------------ */

interface Ticker {
  tick: () => void;
}

const running = new Set<Ticker>();
let frame = 0;

function pump() {
  for (const t of running) t.tick();
  frame = running.size > 0 ? requestAnimationFrame(pump) : 0;
}

function join(t: Ticker): () => void {
  running.add(t);
  if (!frame) frame = requestAnimationFrame(pump);
  return () => {
    running.delete(t);
  };
}

interface Dot {
  x: number;
  y: number;
  angle: number;
  pace: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  r: number;
  glow: number;
}

interface Pointer {
  x: number;
  y: number;
  reach: number;
}

export function Secret({ value, label, className }: { value: string; label: string; className?: string }) {
  const open = useTotalsRevealed();
  const host = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<Pointer>({ x: -999, y: -999, reach: 0 });
  const shown = useRef(open);
  shown.current = open;

  // The hole follows the pointer through CSS variables, so a move costs a
  // style recalculation and no React render.
  const track = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    const el = host.current;
    if (!el || e.pointerType === 'touch') return;
    const box = el.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    el.style.setProperty('--fin-mx', `${x}px`);
    el.style.setProperty('--fin-my', `${y}px`);
    el.style.setProperty('--fin-hole', `${FIELD.reach}px`);
    pointer.current = { x: x + FIELD.pad, y: y + FIELD.pad, reach: FIELD.reach };
  }, []);

  const clear = useCallback(() => {
    host.current?.style.setProperty('--fin-hole', '0px');
    pointer.current = { x: -999, y: -999, reach: 0 };
  }, []);

  useEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    let wasOpen = shown.current;
    let ink = '#e6edfd';
    let scale = 1;

    const place = () => {
      // A few darts is plenty: the pill covers most of its own box.
      for (let i = 0; i < 6; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        if (toEdge(x, y, w, h) < 0) return { x, y };
      }
      return { x: w / 2, y: h / 2 };
    };

    const spawn = (): Dot => ({
      ...place(),
      angle: Math.random() * Math.PI * 2,
      pace: 0.4 + Math.random() * 1.2,
      vx: 0,
      vy: 0,
      life: 0.45 + Math.random() * 0.55,
      decay: 0.0016 + Math.random() * 0.0034,
      r: 0.55 + Math.random() * 0.75,
      glow: Math.random() * 6,
    });

    const seed = () => {
      const want = Math.max(10, Math.round(((w * h) / 100) * FIELD.density));
      dots = Array.from({ length: want }, spawn);
    };

    /** Reveal: every particle takes off from the middle and burns out. */
    const scatter = () => {
      for (const d of dots) {
        // Flattened angle: the figure is wide, so the field opens sideways.
        const a = Math.atan2(d.y - h / 2, (d.x - w / 2) * 0.55) + (Math.random() - 0.5) * 0.9;
        const push = FIELD.force * (0.55 + Math.random() * 0.9);
        d.vx = Math.cos(a) * push;
        d.vy = Math.sin(a) * push - 0.25;
        d.life = 0.6 + Math.random() * 0.4;
      }
    };

    const measure = () => {
      const box = el.getBoundingClientRect();
      const nw = Math.round(box.width) + FIELD.pad * 2;
      const nh = Math.round(box.height) + FIELD.pad * 2;
      if (nw === w && nh === h) return false;
      w = nw;
      h = nh;
      // Round the buffer UP: at a fractional device ratio a rounded-down
      // buffer leaves a half-pixel strip the clear below can never reach.
      scale = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(1, Math.ceil(w * scale));
      cv.height = Math.max(1, Math.ceil(h * scale));
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      cv.style.left = `${-FIELD.pad}px`;
      cv.style.top = `${-FIELD.pad}px`;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      // Particles are the figure's own colour, so they read on a bright card
      // as well as on the dark hero.
      ink = getComputedStyle(el).color || ink;
      return true;
    };

    const size = new ResizeObserver(() => {
      if (measure()) seed();
    });
    size.observe(el);
    measure();
    seed();

    const fadeStep = 1 / (FIELD.fade * 60);

    const stop = join({
      tick() {
        if (!w || !h) return;
        const on = shown.current;
        if (on !== wasOpen) {
          wasOpen = on;
          if (on) scatter();
          else seed();
        }

        let alive = false;
        // Clear the whole buffer in device pixels, not the CSS box: clearing in
        // the scaled space left a bright seam along the bottom and right edges
        // that built up frame after frame.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        const { x: px, y: py, reach } = pointer.current;

        for (const d of dots) {
          if (on) {
            d.x += d.vx;
            d.y += d.vy;
            d.vx *= 0.985;
            d.vy *= 0.985;
            d.life -= fadeStep;
          } else {
            const step = FIELD.drift * d.pace;
            d.x += Math.cos(d.angle) * step;
            d.y += Math.sin(d.angle) * step;
            d.angle += (Math.random() - 0.5) * 0.14;
            d.glow += 0.01;
            d.life -= d.decay;
            if (d.life <= 0 || toEdge(d.x, d.y, w, h) > 0) {
              Object.assign(d, spawn(), { life: 0.05 });
            } else if (d.life < 1) {
              d.life = Math.min(1, d.life + 0.004);
            }
          }
          if (d.life <= 0) continue;
          alive = true;

          let alpha = Math.min(1, d.life) * (0.46 + Math.sin(d.glow * 2) * 0.2);
          // Fade out towards the pill's edge: the field has no border, it just
          // stops being there. Particles thrown by a reveal are free of it —
          // they are supposed to leave.
          if (!on) {
            const edge = -toEdge(d.x, d.y, w, h);
            if (edge < FIELD.feather) alpha *= Math.max(0, edge / FIELD.feather);
          }
          // Thinner inside the circle the pointer has opened, so the figure
          // showing there is not read through a swarm.
          if (!on && reach) {
            const away = Math.hypot(d.x - px, d.y - py);
            if (away < reach) alpha *= Math.max(0, away / reach - 0.15);
          }
          if (alpha <= 0.012) continue;

          ctx.globalAlpha = alpha;
          ctx.fillStyle = ink;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r * FIELD.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        // Revealed and the last particle gone: nothing left to draw until the
        // totals are hidden again.
        if (on && !alive) dots = [];
      },
    });

    return () => {
      stop();
      size.disconnect();
    };
  }, [value]);

  return (
    <span
      ref={host}
      className={className ? `fin-secret ${className}` : 'fin-secret'}
      data-open={open || undefined}
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${value}. ${open ? 'Click to hide totals.' : 'Click to show totals.'}`}
      title={open ? 'Click to hide' : 'Click to show'}
      onPointerMove={track}
      onPointerEnter={track}
      onPointerLeave={clear}
      // The figure is its own control: a click on it never reaches the card
      // underneath, which would open the account instead.
      onClick={(e) => {
        e.stopPropagation();
        setRevealed(!revealed);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        setRevealed(!revealed);
      }}
    >
      {/* Under the cursor, and nowhere else. */}
      <span className="fin-secret__near" aria-hidden="true">
        {value}
      </span>
      <canvas className="fin-secret__field" ref={canvas} aria-hidden="true" />
    </span>
  );
}
