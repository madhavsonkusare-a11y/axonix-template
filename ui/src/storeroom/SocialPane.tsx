/**
 * Social beside the Storeroom: one app's signed-in page at a time, so a picture
 * can be dragged straight into the grid.
 *
 * The same pages as Axonix Social (Site.tsx): the app's own saved session, the
 * same allowlists and guest preload, the same freeze-when-hidden rule — only
 * the app on screen here counts as shown. Apps opened here stay loaded while
 * the pane is open; closing the pane releases them.
 *
 * The guest preload reports each drag out of the page (the picture's own
 * address, its post, its alt text); the Storeroom uses that report when the
 * drop lands in the grid.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import Site, { type GuestDrag, type SiteEvent } from '../social/Site';
import { SOCIAL_APPS, appById, type SocialAppId } from '../social/apps';
import { bridge, type WebviewTag } from '../social/bridge';
import { appIcons } from '../social/icons';

const APP_KEY = 'axonix:storeroom:pane-app';
const HINT_KEY = 'axonix:storeroom:pane-hint';
export const PANE_MIN = 420;

function storedApp(): SocialAppId {
  try {
    return appById(localStorage.getItem(APP_KEY))?.id ?? 'pinterest';
  } catch {
    return 'pinterest';
  }
}

export interface PaneDrag {
  app: SocialAppId;
  drag: GuestDrag;
}

export default function SocialPane({
  width,
  onResize,
  onResizing,
  onDrag,
  onClose,
}: {
  width: number;
  /** Final width after the edge was dragged. */
  onResize: (width: number) => void;
  onResizing: (resizing: boolean) => void;
  /** A drag started in the page, or ended (null) — `at` is where, in this window's coordinates. */
  onDrag: (drag: PaneDrag | null, at?: { x: number; y: number } | null) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState<SocialAppId>(storedApp);
  const [live, setLive] = useState<ReadonlySet<SocialAppId>>(() => new Set([storedApp()]));
  const [loading, setLoading] = useState<Partial<Record<SocialAppId, boolean>>>({});
  const [nav, setNav] = useState<Partial<Record<SocialAppId, { canBack: boolean; canForward: boolean }>>>({});
  const views = useRef<Partial<Record<SocialAppId, WebviewTag>>>({});
  const pane = useRef<HTMLElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const pick = (id: SocialAppId) => {
    setActive(id);
    setLive((l) => (l.has(id) ? l : new Set(l).add(id)));
    try {
      localStorage.setItem(APP_KEY, id);
    } catch {
      // Remembering is a convenience.
    }
  };

  // Only the app on screen here counts as shown; the rest may freeze.
  useEffect(() => {
    bridge?.setShown?.([active]);
  }, [active]);
  useEffect(() => () => bridge?.setShown?.([]), []);

  // Said once: how the pane is meant to be used.
  useEffect(() => {
    try {
      if (localStorage.getItem(HINT_KEY)) return;
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      return;
    }
    toast('Drag a picture into the grid to keep it', { description: 'Hold Alt to lift a photo the site covers, like on Instagram.' });
  }, []);

  const withPage = (fn: (wv: WebviewTag) => void) => {
    const wv = views.current[activeRef.current];
    if (!wv) return;
    try {
      fn(wv);
    } catch {
      // Not attached yet.
    }
  };

  // Axonix's page keys, when they arrive from a page in this window.
  useEffect(
    () =>
      bridge?.onShortcut((action) => {
        if (action === 'reload') withPage((wv) => wv.reload());
        if (action === 'back') withPage((wv) => wv.canGoBack() && wv.goBack());
        if (action === 'forward') withPage((wv) => wv.canGoForward() && wv.goForward());
      }),
    [],
  );

  const onEvent = useCallback(
    (id: SocialAppId, e: SiteEvent) => {
      if (e.type === 'loading') setLoading((l) => ({ ...l, [id]: e.loading }));
      if (e.type === 'nav') setNav((n) => ({ ...n, [id]: { canBack: e.canBack, canForward: e.canForward } }));
      if (e.type === 'swipe') {
        const wv = views.current[id];
        try {
          if (e.direction === 'back' && wv?.canGoBack()) wv.goBack();
          if (e.direction === 'forward' && wv?.canGoForward()) wv.goForward();
        } catch {
          // Not attached.
        }
      }
      if (e.type === 'drag') onDrag({ app: id, drag: e.drag });
      if (e.type === 'drag-end') {
        // The page fills this box, so its coordinates are offsets from it.
        const box = page.current?.getBoundingClientRect();
        onDrag(null, e.point && box ? { x: box.left + e.point.x, y: box.top + e.point.y } : null);
      }
    },
    [onDrag],
  );

  const register = useCallback((id: SocialAppId, el: WebviewTag | null) => {
    if (el) views.current[id] = el;
    else delete views.current[id];
  }, []);

  /* ---------- the edge: drag to resize ---------- */

  const resize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const el = pane.current;
    if (!el) return;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    // The grid keeps room for at least two columns of references (2 × 228 + gap + padding).
    const max = Math.max(PANE_MIN, window.innerWidth - 232 - 540);
    let next = startW;
    onResizing(true);
    const move = (ev: PointerEvent) => {
      next = Math.round(Math.min(max, Math.max(PANE_MIN, startW + (startX - ev.clientX))));
      el.style.width = `${next}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      onResizing(false);
      onResize(next);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const state = nav[active];
  return (
    <aside ref={pane} className="str-pane" style={{ width }} aria-label="Social beside the Storeroom">
      <div className="str-pane__edge" onPointerDown={resize} role="separator" aria-orientation="vertical" aria-label="Resize Social" />
      <header className="str-pane__bar">
        <div className="str-pane__apps" role="tablist" aria-label="Social apps">
          {SOCIAL_APPS.map((app) => (
            <button
              key={app.id}
              type="button"
              role="tab"
              className="str-pane__app"
              aria-selected={app.id === active}
              title={app.name}
              onClick={() => pick(app.id)}
            >
              <img src={appIcons[app.id]} alt={app.name} draggable={false} />
            </button>
          ))}
        </div>
        <span className="str-pane__spacer" />
        <button type="button" className="fin-icon-btn" onClick={() => withPage((wv) => wv.goBack())} disabled={!state?.canBack} aria-label="Back" title="Back (Alt+←)">
          <ChevronLeft size={15} strokeWidth={1.9} />
        </button>
        <button type="button" className="fin-icon-btn" onClick={() => withPage((wv) => wv.goForward())} disabled={!state?.canForward} aria-label="Forward" title="Forward (Alt+→)">
          <ChevronRight size={15} strokeWidth={1.9} />
        </button>
        <button type="button" className="fin-icon-btn" onClick={() => withPage((wv) => wv.reload())} aria-label="Reload" title="Reload (Ctrl+R)">
          <RotateCw size={13} strokeWidth={1.9} />
        </button>
        <button type="button" className="fin-icon-btn" onClick={onClose} aria-label="Close Social" title="Close Social">
          <X size={15} strokeWidth={1.8} />
        </button>
      </header>
      <div ref={page} className="str-pane__page">
        {SOCIAL_APPS.filter((app) => live.has(app.id)).map((app) => (
          <Site
            key={app.id}
            app={app}
            active={app.id === active}
            live
            direction={1}
            instant={false}
            onEvent={onEvent}
            register={register}
            slot="full"
            focused={app.id === active}
            loading={Boolean(loading[app.id])}
          />
        ))}
      </div>
    </aside>
  );
}
