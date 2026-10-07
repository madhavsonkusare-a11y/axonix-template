/**
 * The launch panel — an app opening out of its icon.
 *
 * A panel in the app's own colour grows out of the icon (in the dock, or where
 * it was dropped) into the page area, carrying the icon to its centre. It then
 * holds over the page while the site loads — the icon breathing, the axon pulse
 * running along the top edge — so a half-built page is never on screen. When
 * the page has loaded, painted, and stayed settled for a moment (sites often
 * redirect once more), the panel fades and the page is there. The transition
 * therefore lasts exactly as long as the site takes.
 *
 * It starts at the icon's own edge, with the icon's own corner: the panel is
 * laid out at the page's box and scaled down onto the icon, so its corner is
 * scaled too — the keyframes below undo that, keeping the corner the icon's 23%
 * at the start and the page card's 22px at the end.
 *
 * Everything that moves is composited — `transform`, `opacity` and `clip-path`
 * — because creating the new page stalls the host's main thread for 70–150ms
 * right after the growth starts. A `border-radius` animation froze there and
 * the corners ballooned into a pill until the thread came back (measured
 * 2026-09-20); `clip-path` keeps running on the compositor, as the transform
 * does. The page itself is created two frames later (Site.tsx), so the
 * compositor already has the animations when the stall lands.
 *
 * A drop into split view grows slowly instead, pacing the site's load: the
 * growth is given far longer than it needs and is hurried to its end the
 * moment the page is ready.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SocialAppId } from './apps';
import { appBrand, appIcons } from './icons';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaunchProps {
  app: SocialAppId;
  /** Where the panel grows from; null appears in place (keyboard opens). */
  origin: Box | null;
  /** The page area it opens into, read every frame (the window can resize). */
  target: () => Box | null;
  /** 'load' paces the growth to the site's load (split view); 'quick' opens at once. */
  pace?: 'quick' | 'load';
  /** The page has loaded and painted, and isn't loading again. */
  ready: boolean;
  /** The panel has reached the page's box (the dock icon may come back). */
  onGrown?: () => void;
  onDone: () => void;
}

const GLYPH = 96;
const RADIUS = 22; // --fin-r-frame, the page card's corner
const ICON_RADIUS = 0.23; // .soc-icon's corner, as a share of its width
const SETTLE_MS = 600; // ready this long without loading again (Pinterest reloads ~400ms after its first load)
const HOLD_MAX_MS = 15_000; // a site that never settles is shown anyway
const GROW_MS = 520;
/** A paced growth is given room to run for a slow site, then hurried when the page lands. */
const GROW_SLOW_MS = 2600;
const HURRY = 5;
const EASE: [number, number, number, number] = [0.2, 0.9, 0.24, 1];
const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const css = (e: [number, number, number, number]) => `cubic-bezier(${e.join(', ')})`;

/**
 * The browser's own animation (Web Animations), not a JS-driven one: Chromium
 * runs transform and opacity animations on the compositor, so they keep their
 * frame rate while the main thread is busy creating the page. Resolves when
 * done, leaving the final value in place.
 */
function run(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): { animation: Animation; finished: Promise<void> } {
  const animation = el.animate(keyframes, { fill: 'forwards', ...options });
  const finished = animation.finished
    .then(() => {
      animation.commitStyles();
      animation.cancel();
    })
    .catch(() => undefined);
  return { animation, finished };
}

/** Where a cubic-bezier easing has got to at `t` (0–1). */
function eased([x1, y1, x2, y2]: [number, number, number, number], t: number): number {
  const curve = (a: number, b: number, u: number) => ((1 - u) ** 3 * 0 + 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u ** 2 * b + u ** 3);
  let low = 0;
  let high = 1;
  let u = t;
  // The curve is monotone in x, so bisection finds the u that gives this t.
  for (let i = 0; i < 24; i++) {
    const x = curve(x1, x2, u);
    if (Math.abs(x - t) < 1e-4) break;
    if (x < t) low = u;
    else high = u;
    u = (low + high) / 2;
  }
  return curve(y1, y2, u);
}

/**
 * Corners that look right while the panel is scaled: the panel is drawn at the
 * page's size, so a corner of R shows as R × the current scale. These keyframes
 * divide it back out, taking the drawn corner from the icon's to the card's.
 * They follow the growth's easing themselves, so they can run linearly.
 */
function cornerFrames(from: Box, to: Box, steps = 14): Keyframe[] {
  const sx0 = from.w / to.w;
  const sy0 = from.h / to.h;
  const start = from.w * ICON_RADIUS;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps;
    const p = eased(EASE, offset);
    const drawn = start + (RADIUS - start) * p;
    const sx = sx0 + (1 - sx0) * p;
    const sy = sy0 + (1 - sy0) * p;
    frames.push({ offset, clipPath: `inset(0px round ${(drawn / sx).toFixed(2)}px / ${(drawn / sy).toFixed(2)}px)`, easing: 'linear' });
  }
  return frames;
}

const same = (a: Box | null, b: Box | null) => Boolean(a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
/** The icon filling `b` (transform-origin 0 0; the element is 96px square). */
const glyphIn = (b: Box) => `translate(${b.x}px, ${b.y}px) scale(${b.w / GLYPH})`;
const glyphCentred = (b: Box) => `translate(${b.x + b.w / 2 - GLYPH / 2}px, ${b.y + b.h / 2 - GLYPH / 2}px) scale(1)`;

export default function Launch({ app, origin, target, pace = 'quick', ready, onGrown, onDone }: LaunchProps) {
  const panel = useRef<HTMLDivElement>(null);
  const glyph = useRef<HTMLDivElement>(null);
  const lift = useRef<HTMLDivElement>(null);
  const pulse = useRef<HTMLDivElement>(null);
  const growing = useRef<Animation[]>([]);
  const targetRef = useRef(target);
  targetRef.current = target;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const grownRef = useRef(onGrown);
  grownRef.current = onGrown;
  const [grown, setGrown] = useState(false);
  const [settled, setSettled] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const brand = appBrand[app];

  /** Put the panel, pulse and (optionally) the icon at `b`, without animating. */
  const place = (b: Box, withGlyph: boolean) => {
    const p = panel.current;
    const g = glyph.current;
    const u = pulse.current;
    if (!p || !g || !u) return;
    p.style.left = `${b.x}px`;
    p.style.top = `${b.y}px`;
    p.style.width = `${b.w}px`;
    p.style.height = `${b.h}px`;
    u.style.left = `${b.x + RADIUS}px`;
    u.style.top = `${b.y}px`;
    u.style.width = `${Math.max(0, b.w - RADIUS * 2)}px`;
    if (withGlyph) g.style.transform = glyphCentred(b);
  };

  // Grow out of the icon.
  useLayoutEffect(() => {
    const p = panel.current;
    const g = glyph.current;
    const to = targetRef.current();
    if (!p || !g || !to) {
      doneRef.current();
      return;
    }
    // The panel is laid out at the page's box and scaled down onto the icon.
    place(to, !origin);
    if (!origin) {
      setGrown(true);
      grownRef.current?.();
      return;
    }
    const duration = pace === 'load' ? GROW_SLOW_MS : GROW_MS;
    const timing: KeyframeAnimationOptions = { duration, easing: css(EASE) };
    const from = `translate(${origin.x - to.x}px, ${origin.y - to.y}px) scale(${origin.w / to.w}, ${origin.h / to.h})`;
    const corners = cornerFrames(origin, to);
    // The starting state, before the first paint: no frame shows the panel
    // full-size, square-cornered, or the icon at the window's corner.
    p.style.transform = from;
    p.style.clipPath = String(corners[0].clipPath);
    g.style.transform = glyphIn(origin);
    const box = run(p, [{ transform: from }, { transform: 'translate(0px, 0px) scale(1, 1)' }], timing);
    const corner = run(p, corners, { ...timing, easing: 'linear' });
    const icon = run(g, [{ transform: glyphIn(origin) }, { transform: glyphCentred(to) }], timing);
    growing.current = [box.animation, corner.animation, icon.animation];
    void icon.finished.then(() => {
      growing.current = [];
      setGrown(true);
      grownRef.current?.();
    });
    // Built once per launch; `place` only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once grown, follow the page area if it moves (window resize, divider).
  useEffect(() => {
    if (!grown || revealing) return;
    let last: Box | null = null;
    let frame = 0;
    const follow = () => {
      const b = targetRef.current();
      if (b && !same(b, last)) {
        place(b, true);
        last = b;
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grown, revealing]);

  // Ready has to hold for a moment: a site that redirects loads twice.
  useEffect(() => {
    if (!ready) {
      setSettled(false);
      return;
    }
    const t = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [ready]);

  // A site that never settles is shown anyway.
  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), HOLD_MAX_MS);
    return () => window.clearTimeout(t);
  }, []);

  // The page landed while a paced growth was still running: hurry it to its end.
  useEffect(() => {
    if (grown || !(settled || timedOut)) return;
    for (const a of growing.current) a.updatePlaybackRate(HURRY);
  }, [grown, settled, timedOut]);

  // The page is ready: the icon lifts away, the panel fades, the page is there.
  useEffect(() => {
    if (!grown || revealing || !(settled || timedOut)) return;
    setRevealing(true);
    const p = panel.current;
    const l = lift.current;
    const u = pulse.current;
    if (!p || !l || !u) return doneRef.current();
    void Promise.all([
      run(l, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.14)', opacity: 0 }], { duration: 220, easing: OUT }).finished,
      run(u, [{ opacity: 1 }, { opacity: 0 }], { duration: 150 }).finished,
      run(p, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: OUT, delay: 50 }).finished,
    ]).then(() => doneRef.current());
  }, [grown, settled, timedOut, revealing]);

  return (
    <div className="soc-launch" data-holding={grown && !revealing} aria-hidden="true">
      <div ref={panel} className="soc-launch__panel" style={{ backgroundColor: brand.base, backgroundImage: brand.image }} />
      <div ref={pulse} className="soc-launch__pulse">
        <span />
      </div>
      <div ref={glyph} className="soc-launch__glyph">
        <div ref={lift} className="soc-launch__lift">
          <img src={appIcons[app]} alt="" draggable={false} />
        </div>
      </div>
    </div>
  );
}
