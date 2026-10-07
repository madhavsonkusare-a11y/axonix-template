/**
 * Liquid glass, from quick-liquid (MIT, github.com/amarnath3003/quickLiquid).
 *
 * Spent on exactly two things, both of which float above the page:
 *   - selection indicators (the nav rail, every segmented control) — a lens
 *     that slides with a stretch-and-settle spring
 *   - sheets (add transaction, accounts, settings) — a refracting panel
 *
 * Tauri renders through WebView2, which is Chromium, so the real SVG
 * displacement path is live — not the blur-only fallback other engines get.
 *
 * Two engine rules that must not be broken (quick-liquid VISUAL_QA_HANDOFF §3):
 * no `isolation`, `filter`, `opacity < 1`, `mask` or `mix-blend-mode` on a glass
 * host or any of its ancestors — each creates a backdrop root and silently
 * turns the refraction off while the blur keeps working.
 *
 * Motion: the springs run through quick-liquid's scheduler, which would settle
 * them instantly under `prefers-reduced-motion`. Axonix plays full motion
 * whatever the system says (the owner's choice, 2026-09-20: no reduced-motion
 * path anywhere), so the scheduler is told the system never asks for less.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AnimationScheduler, LiquidGlassEngine, Spring, type LiquidGlassConfig } from 'quick-liquid';

/**
 * True inside a surface that is already glass (a sheet). Apple's guidance is
 * not to layer glass on glass; controls there show a plain indicator and turn
 * to glass only while they are being pressed, the way the system's own
 * controls come alive when touched.
 */
export const GlassSurface = createContext(false);

AnimationScheduler.prefersReducedMotion = () => false;

/**
 * Mounts a glass engine on `ref` while `enabled`. Config is read once per mount.
 *
 * `onPage` marks glass that sits in a page rather than floating over one (the
 * selection lens). Under the new shell that glass is retired: a page arrives
 * out of a blur, and a filter above a lens switches the lens off, so there the
 * selection is a plain thumb drawn by CSS (`next.css`, "Calm"). The first
 * versions keep their lens.
 */
export function useLiquidGlass(ref: RefObject<HTMLElement | null>, config: Partial<LiquidGlassConfig>, enabled = true, onPage = false) {
  const cfg = useRef(config);
  cfg.current = config;
  // Transparency effects off (Windows) / Reduce Transparency: no glass at all;
  // the solid base material in CSS shows instead.
  const solid = usePrefersReducedTransparency();

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || solid) return;
    if (onPage && document.documentElement.dataset.nx === 'true') return;
    const engine = new LiquidGlassEngine(el, { appearance: 'dark', ...cfg.current });
    return () => engine.destroy();
  }, [ref, enabled, solid, onPage]);
}

const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';

function usePrefersReducedTransparency(): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(REDUCED_TRANSPARENCY).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(REDUCED_TRANSPARENCY);
    const update = () => setOn(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return on;
}

export const INDICATOR_GLASS: Partial<LiquidGlassConfig> = {
  material: 'clear',
  borderRadius: 999,
  refractionStrength: 10,
  bezelWidth: 12,
  thickness: 12,
  blur: 0,
  tintOpacity: 0.09,
  edgeHighlight: 0.75,
  specularStrength: 0.22,
  chromaticAberration: 0.18,
  elevation: 0,
  quality: 'medium',
};

interface Box { start: number; end: number; cross: number; size: number }

/**
 * Slides `indicator` onto the child of `container` whose `data-liquid-key`
 * matches `activeKey`.
 *
 * The two edges travel on different springs — the leading edge stiff, the
 * trailing edge soft — so the lens stretches toward its target and then
 * catches up with itself. That lag is the whole "liquid" read; a single
 * spring on position just looks like a slide.
 */
export function useLiquidIndicator(
  container: RefObject<HTMLElement | null>,
  indicator: RefObject<HTMLElement | null>,
  activeKey: string | undefined,
  axis: 'x' | 'y',
) {
  const springs = useRef<{ start: Spring; end: Spring; cross: Spring; size: Spring } | null>(null);
  const job = useRef<number | null>(null);

  useLayoutEffect(() => {
    const host = container.current;
    const lens = indicator.current;
    if (!host || !lens) return;

    const measure = (): Box | null => {
      if (activeKey === undefined) return null;
      const el = host.querySelector<HTMLElement>(`[data-liquid-key="${CSS.escape(activeKey)}"]`);
      if (!el) return null;
      return axis === 'x'
        ? { start: el.offsetLeft, end: el.offsetLeft + el.offsetWidth, cross: el.offsetTop, size: el.offsetHeight }
        : { start: el.offsetTop, end: el.offsetTop + el.offsetHeight, cross: el.offsetLeft, size: el.offsetWidth };
    };

    const paint = () => {
      const s = springs.current!;
      const along = s.start.value;
      const length = Math.max(0, s.end.value - s.start.value);
      if (axis === 'x') {
        lens.style.transform = `translate3d(${along}px, ${s.cross.value}px, 0)`;
        lens.style.width = `${length}px`;
        lens.style.height = `${s.size.value}px`;
      } else {
        lens.style.transform = `translate3d(${s.cross.value}px, ${along}px, 0)`;
        lens.style.width = `${s.size.value}px`;
        lens.style.height = `${length}px`;
      }
    };

    const place = (box: Box, animate: boolean) => {
      lens.dataset.visible = 'true';
      if (!springs.current || !animate) {
        springs.current = {
          start: new Spring(box.start, 'snappy'),
          end: new Spring(box.end, 'snappy'),
          cross: new Spring(box.cross, 'snappy'),
          size: new Spring(box.size, 'snappy'),
        };
        paint();
        return;
      }
      const s = springs.current;
      const forward = box.start > s.start.value;
      const lead = { stiffness: 520, damping: 34 };
      const trail = { stiffness: 260, damping: 25 };
      s.start.updateConfig(forward ? trail : lead);
      s.end.updateConfig(forward ? lead : trail);
      s.start.setTarget(box.start);
      s.end.setTarget(box.end);
      s.cross.setTarget(box.cross);
      s.size.setTarget(box.size);

      const scheduler = AnimationScheduler.shared();
      if (job.current !== null) scheduler.cancel(job.current);
      job.current = scheduler.schedule((now) => {
        const moving = [s.start.tick(now), s.end.tick(now), s.cross.tick(now), s.size.tick(now)].some(Boolean);
        paint();
        if (!moving) job.current = null;
        return moving;
      });
    };

    const box = measure();
    if (!box) {
      lens.dataset.visible = 'false';
      return;
    }
    place(box, true);

    // Re-seat without animation when the layout itself moves (window resize,
    // a badge appearing) — only a change of selection should animate. The
    // observer reports once immediately on observe(); acting on that report
    // would snap the lens and cancel the slide that was just started.
    let initial = true;
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      const next = measure();
      if (next) place(next, false);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [container, indicator, activeKey, axis]);

  useEffect(
    () => () => {
      if (job.current !== null) AnimationScheduler.shared().cancel(job.current);
    },
    [],
  );
}

/**
 * The glass lens element itself. Rendered as the FIRST child of its container,
 * so the options paint above it in DOM order — the engine forbids a z-index on
 * its lens layer, so stacking has to come from order.
 */
export function LiquidLens({ lensRef, radius = 999, pressed }: { lensRef: RefObject<HTMLSpanElement | null>; radius?: number; pressed?: boolean }) {
  // The engine writes border-radius inline, so the shape has to come from here, not CSS.
  useLiquidGlass(lensRef, { ...INDICATOR_GLASS, borderRadius: radius }, pressed === undefined, true);
  // On a glass surface the glass lives on an inner layer that comes and goes
  // with the press: tearing the engine down clears inline styles, which on the
  // lens itself would also wipe the position its spring is holding.
  const inner = useRef<HTMLSpanElement>(null);
  useLiquidGlass(inner, { ...INDICATOR_GLASS, borderRadius: radius }, pressed === true, true);
  if (pressed === undefined) return <span ref={lensRef} className="fin-lens" data-visible="false" aria-hidden="true" />;
  return (
    <span ref={lensRef} className="fin-lens fin-lens--plain" data-visible="false" data-pressed={pressed} aria-hidden="true" style={{ borderRadius: radius }}>
      <span ref={inner} className="fin-lens__glass" />
    </span>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

/** Segmented control with a liquid lens. Replaces every `.fin-seg` in the tracker. */
export function LiquidSegment<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  mono = true,
  label,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'md' | 'lg';
  mono?: boolean;
  label?: string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, value, 'x');

  // On glass, the lens turns to glass only while pressed and for the slide
  // that follows, then settles back to a plain pill.
  const onGlass = useContext(GlassSurface);
  const [pressed, setPressed] = useState(false);
  const settle = useRef<number | null>(null);
  const press = (down: boolean) => {
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = null;
    if (down) setPressed(true);
    else settle.current = window.setTimeout(() => setPressed(false), 520);
  };
  useEffect(() => () => {
    if (settle.current !== null) window.clearTimeout(settle.current);
  }, []);

  return (
    <div
      ref={host}
      role="radiogroup"
      aria-label={label}
      className={['fin-seg', size === 'lg' && 'fin-seg--lg', !mono && 'fin-seg--text', className].filter(Boolean).join(' ')}
      onPointerDown={onGlass ? () => press(true) : undefined}
      onPointerUp={onGlass ? () => press(false) : undefined}
      onPointerCancel={onGlass ? () => press(false) : undefined}
      onPointerLeave={onGlass && pressed ? () => press(false) : undefined}
    >
      <LiquidLens lensRef={lens} pressed={onGlass ? pressed : undefined} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-liquid-key={o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
