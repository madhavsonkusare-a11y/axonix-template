/**
 * One app's page: a `<webview>` in its own persistent session, stacked with
 * the others inside the page card. Only the active one is visible.
 *
 * Switching slides the pages along the dock's axis — moving down the dock
 * brings the next page up from below — so where a page sits on screen matches
 * where its icon sits. Keyboard switches (Ctrl+1…6) are instant. The first
 * open slides the page out from the dock.
 *
 * Pages only ever translate and fade, never scale: a `<webview>` that attaches
 * or resizes under a scale transform keeps drawing at the inverse scale
 * (attached under scale .92, Instagram drew 9% too large and ran off the card).
 *
 * A sleeping app keeps its last frame as a picture, so waking it shows where
 * you were at once and the live page fades in over it when it has loaded.
 *
 * Split view uses the same page: an app is never loaded twice. A page moves
 * between the whole card and a pane by a transition on `left`/`right`.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate } from 'motion';
import { useLiquidGlass } from '../finance/components/Liquid';
import { partitionOf, type SocialApp, type SocialAppId } from './apps';
import { bridge, type WebviewTag } from './bridge';
import { appIcons } from './icons';

export type SiteEvent =
  | { type: 'badge'; count: number }
  | { type: 'loading'; loading: boolean }
  | { type: 'nav'; canBack: boolean; canForward: boolean }
  | { type: 'ready'; webContentsId: number }
  | { type: 'navigated' }
  /** The pointer came into the page, or it was clicked or tabbed into. */
  | { type: 'take-focus' }
  /** A two-finger swipe across the page. */
  | { type: 'swipe'; direction: 'back' | 'forward' }
  /** Finished loading and painted — what a launch panel waits for. */
  | { type: 'loaded' }
  /** A picture or link is being dragged out of the page (the Storeroom's drop uses it). */
  | { type: 'drag'; drag: GuestDrag }
  /** The drag ended; `point` is where, in the page's own coordinates (outside it when negative). */
  | { type: 'drag-end'; point: { x: number; y: number } | null };

/** What the guest preload says is being dragged out of a page. */
export interface GuestDrag {
  /** The picture's own address (http/https only). */
  src: string | null;
  alt: string;
  /** The link it sits in, if any. */
  link: string | null;
  /** The page it was dragged from. */
  page: string;
  title: string;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const web = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v) && v.length <= 4000 ? v : null);

/** The guest's message is page-side data: keep only well-formed fields. */
function guestDrag(raw: unknown): GuestDrag | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const drag = { src: web(d.src), alt: text(d.alt, 300), link: web(d.link), page: web(d.page) ?? '', title: text(d.title, 300) };
  return drag.src || drag.link ? drag : null;
}

export interface SiteProps {
  app: SocialApp;
  active: boolean;
  live: boolean;
  snapshot?: string;
  /** +1 when the new page is below the old one in the dock, −1 when above. */
  direction: number;
  instant: boolean;
  onEvent: (id: SocialAppId, event: SiteEvent) => void;
  register: (id: SocialAppId, el: WebviewTag | null) => void;
  /** Where a shown page sits: the whole card, or one pane of split view. */
  slot?: 'full' | 'split-left' | 'split-right';
  /** In split view, the pane that the title bar, keys and sign-in act on. */
  focused?: boolean;
  /** Draws the loading pulse along this page's own top edge. */
  loading?: boolean;
  /** A launch panel is covering this page, so it draws no placeholder of its own. */
  covered?: boolean;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
// Pen's glass.glsl "Blurry Lens" model, mapped onto quick-liquid's live
// backdrop/Snell lens and deliberately softened so website text stays calm.
// The shader's split direction becomes the fixed light direction here.
const SWIPE_ORB_GLASS = {
  material: 'clear' as const,
  borderRadius: 999,
  ior: 1.22,
  refractionStrength: 10,
  bezelWidth: 22,
  thickness: 14,
  chromaticAberration: 0.04,
  specularStrength: 0.54,
  edgeHighlight: 0.78,
  fresnelPower: 3,
  blur: 1.2,
  saturation: 1.3,
  tintOpacity: 0.03,
  lightAngle: 129.6,
  elevation: 0,
  quality: 'high' as const,
};
const HIDE_SCROLLBARS = `
  html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
`;

/**
 * A page resized while it was hidden can keep its old viewport: Chromium stops
 * sending size updates to a hidden frame, and showing it again does not always
 * resend them. The page then lays out wider or narrower than the card and gets
 * clipped. Compare the page's viewport with its element and, if they differ,
 * nudge the element by a pixel for a frame so the new size is sent.
 */
async function resync(wv: WebviewTag) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let inner: [number, number];
    try {
      inner = (await wv.executeJavaScript('[innerWidth, innerHeight]')) as [number, number];
    } catch {
      return; // Not attached or mid-navigation; the next show checks again.
    }
    const zoom = wv.getZoomFactor();
    const w = Math.round(wv.offsetWidth / zoom);
    const h = Math.round(wv.offsetHeight / zoom);
    if (Math.abs(inner[0] - w) <= 1 && Math.abs(inner[1] - h) <= 1) return;
    wv.style.width = 'calc(100% - 1px)';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    wv.style.width = '';
    await new Promise((r) => setTimeout(r, 120));
  }
}

function Site({ app, active, live, snapshot, direction, instant, onEvent, register, slot = 'full', focused = false, loading = false, covered = false }: SiteProps) {
  // Plain `animate`, not `useAnimate`: the scoped version stops its animations
  // when React re-runs effects (development StrictMode), and the second run no
  // longer sees an arriving page, so entrances silently vanished.
  const scope = useRef<HTMLDivElement>(null);
  const view = useRef<WebviewTag | null>(null);
  const swipeCue = useRef<HTMLDivElement>(null);
  const swipeOrb = useRef<HTMLSpanElement>(null);
  const swipeCueTimer = useRef<number | null>(null);
  const [painted, setPainted] = useState(false);
  // Creating a <webview> stalls this process's main thread for 70–150ms. A
  // launch panel's animations must reach the compositor before that lands, or
  // they freeze in place (Launch.tsx), so the page is attached two frames after
  // its card appears.
  const [attached, setAttached] = useState(false);
  useEffect(() => {
    if (!live) {
      setAttached(false);
      return;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setAttached(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [live]);
  const mounted = useRef(false);
  const activeNow = useRef(active);
  activeNow.current = active;
  useLiquidGlass(swipeOrb, SWIPE_ORB_GLASS, active && live);

  const showSwipeCue = (raw: unknown) => {
    const cue = swipeCue.current;
    if (!cue || !raw || typeof raw !== 'object') return;
    const data = raw as { phase?: unknown; direction?: unknown; progress?: unknown; speed?: unknown };
    const phase = data.phase === 'commit' || data.phase === 'cancel' ? data.phase : 'move';
    const side = data.direction === 'forward' ? 'right' : 'left';
    const progress = Math.min(1, Math.max(0, Number(data.progress) || 0));
    const speed = Math.min(1, Math.max(0, Number(data.speed) || 0));
    // The orb uses the full, deliberate gesture runway: it begins peeking
    // from the edge and travels well into the page before navigation commits.
    cue.style.setProperty('--swipe-x', `${12 + progress * 164}px`);
    // Uniform scale keeps the shader's SDF circular. Velocity adds a small
    // physical pulse without stretching the lens into an oval.
    cue.style.setProperty('--swipe-scale', String(0.72 + progress * 0.24 + speed * 0.08));
    cue.dataset.side = side;
    cue.dataset.phase = phase;
    cue.dataset.on = 'true';
    if (swipeCueTimer.current !== null) window.clearTimeout(swipeCueTimer.current);
    if (phase === 'commit' || phase === 'cancel') {
      swipeCueTimer.current = window.setTimeout(() => {
        cue.dataset.on = 'false';
        swipeCueTimer.current = null;
      }, phase === 'commit' ? 240 : 190);
    }
  };

  useEffect(() => () => {
    if (swipeCueTimer.current !== null) window.clearTimeout(swipeCueTimer.current);
  }, []);

  // Page events → the app shell.
  useEffect(() => {
    const wv = view.current;
    register(app.id, live ? wv : null);
    if (!live || !attached || !wv) {
      setPainted(false);
      return;
    }
    const nav = () => {
      try {
        onEvent(app.id, { type: 'nav', canBack: wv.canGoBack(), canForward: wv.canGoForward() });
      } catch {
        // Not attached yet.
      }
    };
    const handlers: [string, (e: Event) => void][] = [
      [
        'ipc-message',
        (e) => {
          const { channel, args } = e as unknown as { channel: string; args: unknown[] };
          if (channel === 'axonix:badge') onEvent(app.id, { type: 'badge', count: Math.max(0, Number(args[0]) || 0) });
          if (channel === 'axonix:focus-me') onEvent(app.id, { type: 'take-focus' });
          if (channel === 'axonix:swipe-progress') showSwipeCue(args[0]);
          if (channel === 'axonix:swipe') onEvent(app.id, { type: 'swipe', direction: args[0] === 'back' ? 'back' : 'forward' });
          if (channel === 'axonix:drag') {
            const drag = guestDrag(args[0]);
            if (drag) onEvent(app.id, { type: 'drag', drag });
          }
          if (channel === 'axonix:drag-end') {
            const p = args[0] as { x?: unknown; y?: unknown } | undefined;
            const point = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Number(p.x), y: Number(p.y) } : null;
            onEvent(app.id, { type: 'drag-end', point });
          }
        },
      ],
      ['did-start-loading', () => onEvent(app.id, { type: 'loading', loading: true })],
      [
        'did-stop-loading',
        () => {
          onEvent(app.id, { type: 'loading', loading: false });
          setPainted(true);
          nav();
          if (activeNow.current) void resync(wv);
          // "Loaded" means drawn, not just downloaded: wait for the page to
          // paint two frames (capped, since a hidden page may not paint).
          void Promise.race([
            wv.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'),
            new Promise((r) => setTimeout(r, 400)),
          ])
            .catch(() => undefined)
            .then(() => onEvent(app.id, { type: 'loaded' }));
        },
      ],
      [
        'dom-ready',
        () => {
          onEvent(app.id, { type: 'ready', webContentsId: wv.getWebContentsId() });
          // The social pages still scroll normally with wheel, touchpad and keys;
          // Chromium simply does not reserve or draw a scrollbar beside them.
          void wv.insertCSS?.(HIDE_SCROLLBARS);
          nav();
        },
      ],
      [
        'did-navigate',
        () => {
          onEvent(app.id, { type: 'navigated' });
          nav();
        },
      ],
      ['did-navigate-in-page', nav],
      // A crashed page reloads itself once rather than leaving a blank card.
      ['render-process-gone', () => window.setTimeout(() => wv.reload(), 600)],
    ];
    for (const [name, fn] of handlers) wv.addEventListener(name, fn);
    let settle: number | null = null;
    const resized = new ResizeObserver(() => {
      if (settle !== null) window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (activeNow.current) void resync(wv);
      }, 250);
    });
    resized.observe(wv);
    return () => {
      for (const [name, fn] of handlers) wv.removeEventListener(name, fn);
      resized.disconnect();
      if (settle !== null) window.clearTimeout(settle);
      register(app.id, null);
    };
  }, [live, attached, app.id, onEvent, register]);

  // A page that is leaving keeps the geometry it was shown with, so it fades
  // out where it was instead of jumping to its next slot first.
  const shownSlot = useRef(slot);
  if (active) shownSlot.current = slot;
  const wasActive = useRef(false);

  // Entrances and exits.
  useLayoutEffect(() => {
    const el = scope.current;
    if (!el) return;
    const first = !mounted.current;
    mounted.current = true;
    const entering = active && !wasActive.current;
    wasActive.current = active;
    const side = slot === 'split-left' ? -1 : slot === 'split-right' ? 1 : 0;

    if (active) {
      el.style.visibility = 'visible';
      el.removeAttribute('inert');
      if (view.current) void resync(view.current);
      // Already on screen and only its pane changed: the CSS transition on
      // left/right moves it. Nothing to animate here.
      if (!entering) return;
      // Arriving pages take their slot at once; only their fade and slide animate.
      el.style.transition = 'none';
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.transition = '';
      });
      if (instant) {
        void animate(el, { opacity: 1, x: 0, y: 0 }, { duration: 0 });
      } else if (side !== 0) {
        // Into a split pane: slides in from its own edge.
        void animate(el, { opacity: [0, 1], x: [side * 32, 0], y: 0 }, { type: 'spring', stiffness: 340, damping: 32, opacity: { duration: 0.2, ease: EASE } });
      } else if (first) {
        void animate(el, { opacity: [0, 1], x: [-40, 0], y: 0 }, { type: 'spring', stiffness: 300, damping: 30, opacity: { duration: 0.22, ease: EASE } });
      } else {
        void animate(el, { opacity: [0, 1], y: [direction * 22, 0], x: 0 }, { type: 'spring', stiffness: 380, damping: 36, opacity: { duration: 0.2, ease: EASE } });
      }
    } else {
      el.setAttribute('inert', '');
      if (first) {
        el.style.visibility = 'hidden';
        el.style.opacity = '0';
        return;
      }
      const hide = () => {
        if (!activeNow.current) el.style.visibility = 'hidden';
      };
      const leaving = shownSlot.current === 'split-left' ? -1 : shownSlot.current === 'split-right' ? 1 : 0;
      if (instant) {
        el.style.opacity = '0';
        hide();
      } else if (leaving !== 0) {
        void animate(el, { opacity: 0, x: leaving * 20, y: 0 }, { duration: 0.16, ease: EASE }).then(hide);
      } else {
        void animate(el, { opacity: 0, y: direction * -12 }, { duration: 0.15, ease: EASE }).then(hide);
      }
    }
    // Direction and speed belong to the switch that changed `active`, not to later renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slot]);

  return (
    <div ref={scope} className={`soc-site soc-site--${shownSlot.current}`} data-app={app.id} data-active={active} data-focused={focused}>
      {!snapshot && !painted && !covered && (
        <div className="soc-site__launch" aria-hidden="true">
          <img src={appIcons[app.id]} alt="" />
        </div>
      )}
      {snapshot && <img className="soc-site__snap" data-hidden={live && painted} src={snapshot} alt="" aria-hidden="true" />}
      {live &&
        attached &&
        (bridge ? (
          <webview
            ref={view as unknown as React.Ref<HTMLWebViewElement>}
            className="soc-webview"
            src={app.home}
            partition={partitionOf(app.id)}
            // Written as a string: React drops `true` on attributes it doesn't know as boolean.
            {...({ allowpopups: 'true' } as object)}
          />
        ) : (
          <MockPage app={app} onPainted={() => setPainted(true)} />
        ))}
      {/* "The signal travels the axon": loading runs along this page's top edge. */}
      <div className="soc-edge" data-on={Boolean(active && loading)} aria-hidden="true">
        <span />
      </div>
      <div ref={swipeCue} className="soc-swipe-cue" data-on="false" data-side="left" data-phase="move" aria-hidden="true">
        <span ref={swipeOrb} className="soc-swipe-cue__orb">
          <span className="ql-content"><i /></span>
        </span>
      </div>
    </div>
  );
}

/** Stand-in for a site in a plain browser, so the shell can be designed without Electron. */
function MockPage({ app, onPainted }: { app: SocialApp; onPainted: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onPainted, 500);
    return () => window.clearTimeout(t);
  }, [onPainted]);
  return (
    <div className="soc-webview soc-mock">
      <div className="soc-mock__rail">
        <img src={appIcons[app.id]} alt="" />
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <div className="soc-mock__feed">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="soc-mock__post">
            <span className="soc-mock__avatar" />
            <span className="soc-mock__line" />
            <span className="soc-mock__media" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(Site);
