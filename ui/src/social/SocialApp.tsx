/**
 * Axonix Social — the window: title bar, dock, page card, overview, sign-ins.
 *
 * Pages are created the first time their app is opened and kept alive after,
 * so switching back is instant and nothing reloads. An app off screen for two
 * minutes is frozen by the main process (electron/background.ts): it keeps its
 * page but stops using the CPU. After ten minutes (sooner when memory is short,
 * later when there is plenty) it goes to sleep: its last frame is kept as a
 * picture and the page is released; opening it again wakes it on the same
 * session, still signed in.
 *
 * Split view shows two apps side by side. It is only a layout: each app still
 * has exactly one page, and `active` is always the focused pane, so the title
 * bar, back/reload, shortcuts and the sign-in chip act on whichever pane the
 * pointer is over (or was last clicked or tabbed into). In split view a dock
 * click replaces the focused pane (or focuses an app already showing);
 * dropping an icon on a half puts it there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, House, Maximize2, Moon, PanelLeft, PanelRight, RotateCw } from 'lucide-react';
import { SOCIAL_APPS, appById, type SocialAppId } from './apps';
import { bridge, type SavePrompt, type WebviewTag } from './bridge';
import Dock, { type SplitSide } from './Dock';
import Site, { type SiteEvent } from './Site';
import Overview from './Overview';
import Launch, { type Box } from './Launch';
import { PasswordsPanel, SaveBubble, SignInChip } from './Passwords';
import { appIcons } from './icons';

const SLEEP_AFTER_MS = 10 * 60_000;

/** How long an app may stay in the background before it sleeps, given free memory. */
function sleepAfter(freeMb: number | null): number {
  if (freeMb === null) return SLEEP_AFTER_MS;
  if (freeMb < 1024) return 2 * 60_000;
  if (freeMb < 2048) return 5 * 60_000;
  if (freeMb >= 8192) return 15 * 60_000;
  return SLEEP_AFTER_MS;
}
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const indexOf = (id: SocialAppId) => SOCIAL_APPS.findIndex((a) => a.id === id);

type How = 'pointer' | 'keyboard';
type Pane = SplitSide;
interface SplitLayout {
  left: SocialAppId;
  right: SocialAppId;
}

/** How far the divider may go, and where it clicks into place. */
const RATIO_MIN = 0.28;
const RATIO_MAX = 0.72;
const RATIO_SNAPS = [1 / 3, 1 / 2, 2 / 3];
const clampRatio = (v: number) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, v));

/** The unread total as a taskbar overlay: a red disc with the count. */
function badgeImage(count: number): string | null {
  if (count <= 0) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#ff453a';
  g.beginPath();
  g.arc(16, 16, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `600 ${count > 9 ? 17 : 21}px "Segoe UI Variable", "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(count > 99 ? '99' : String(count), 16, 17);
  return c.toDataURL('image/png');
}

export default function SocialApp({ onHome }: { onHome?: () => void } = {}) {
  const [active, setActive] = useState<SocialAppId | null>(null);
  const [live, setLive] = useState<Set<SocialAppId>>(new Set());
  const [sleeping, setSleeping] = useState<Set<SocialAppId>>(new Set());
  const [snapshots, setSnapshots] = useState<Partial<Record<SocialAppId, string>>>({});
  const [badges, setBadges] = useState<Partial<Record<SocialAppId, number>>>({});
  const [bounces, setBounces] = useState<Partial<Record<SocialAppId, number>>>({});
  const [loading, setLoading] = useState<Partial<Record<SocialAppId, boolean>>>({});
  const [nav, setNav] = useState<Partial<Record<SocialAppId, { canBack: boolean; canForward: boolean }>>>({});
  const [offers, setOffers] = useState<Partial<Record<SocialAppId, { webContentsId: number; username: string }>>>({});
  const [prompt, setPrompt] = useState<SavePrompt | null>(null);
  const [overview, setOverview] = useState(false);
  const [passwordsOpen, setPasswordsOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: SocialAppId; x: number; y: number } | null>(null);
  const [switching, setSwitching] = useState({ direction: 1, instant: false });

  // Split view.
  const [split, setSplit] = useState<SplitLayout | null>(null);
  const [ratio, setRatio] = useState(0.5);
  const [resizing, setResizing] = useState(false);
  const [drag, setDrag] = useState<{ id: SocialAppId; side: SplitSide | null; cursor: { x: number; y: number } } | null>(null);

  // Launch panels: an app opening out of its icon, held until its page has loaded.
  const [launch, setLaunch] = useState<{ key: number; id: SocialAppId; origin: Box | null; pace: 'quick' | 'load' } | null>(null);
  /** The panel has reached the page's box; the dock icon can come back. */
  const [launchGrown, setLaunchGrown] = useState(false);
  const [loaded, setLoaded] = useState<Set<SocialAppId>>(new Set());
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const stageRef = useRef<HTMLElement | null>(null);
  const views = useRef<Partial<Record<SocialAppId, WebviewTag>>>({});
  const contents = useRef<Partial<Record<SocialAppId, number>>>({});
  const lastSeen = useRef<Partial<Record<SocialAppId, number>>>({});
  const activeRef = useRef(active);
  activeRef.current = active;
  const liveRef = useRef(live);
  liveRef.current = live;
  const overviewRef = useRef(overview);
  overviewRef.current = overview;
  const splitRef = useRef(split);
  splitRef.current = split;

  const boxOf = (el: Element | null | undefined): Box | null => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };
  // Measure the painted icon, not its button. The button grows with Dock
  // magnification, while this is the exact border the launch panel must leave.
  const iconBox = (id: SocialAppId) => boxOf(document.querySelector(`.soc-dock__app[data-app="${id}"] .soc-icon`));
  const pageBox = useCallback((id: SocialAppId) => boxOf(stageRef.current?.querySelector(`.soc-site[data-app="${id}"]`)), []);

  /**
   * Open `id` out of `origin` (its dock icon, or where it was dropped). The
   * page's own entrance is skipped — it happens under the panel.
   */
  const startLaunch = useCallback((id: SocialAppId, origin: Box | null, pace: 'quick' | 'load' = 'quick') => {
    setLaunchGrown(false);
    setLaunch({ key: Date.now(), id, origin, pace });
  }, []);

  const snap = useCallback(async (id: SocialAppId) => {
    const wcId = contents.current[id];
    if (!bridge || wcId === undefined || !liveRef.current.has(id)) return;
    try {
      const url = await bridge.capture(wcId, id);
      if (url) setSnapshots((s) => ({ ...s, [id]: url }));
    } catch {
      // A page mid-navigation can refuse a capture; the last picture stands.
    }
  }, []);

  /** Make sure an app has a live page; a first launch bounces its icon. */
  const wake = useCallback((id: SocialAppId) => {
    if (!liveRef.current.has(id)) {
      setLive((s) => new Set(s).add(id));
      setBounces((b) => ({ ...b, [id]: (b[id] ?? 0) + 1 }));
    }
    setSleeping((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  /** An app leaves the screen: remember when, and keep its last frame. */
  const leave = useCallback(
    (id: SocialAppId) => {
      lastSeen.current[id] = Date.now();
      void snap(id);
    },
    [snap],
  );

  const focus = useCallback((id: SocialAppId) => {
    if (activeRef.current === id) return;
    setActive(id);
  }, []);

  const open = useCallback(
    (id: SocialAppId, how: How) => {
      setOverview(false);
      setPasswordsOpen(false);
      setMenu(null);
      const prev = activeRef.current;
      const sp = splitRef.current;

      if (sp) {
        // Already showing: just focus that pane.
        if (id === sp.left || id === sp.right) {
          focus(id);
          return;
        }
        // Otherwise the focused pane changes app.
        const pane: Pane = prev === sp.right ? 'right' : 'left';
        // An app whose page isn't loaded opens out of its icon and holds until
        // it is; an already-loaded one just slides in.
        const cover = !loadedRef.current.has(id);
        leave(sp[pane]);
        wake(id);
        setSwitching({ direction: pane === 'left' ? -1 : 1, instant: how === 'keyboard' || cover });
        setSplit({ ...sp, [pane]: id });
        setActive(id);
        if (cover) startLaunch(id, how === 'keyboard' ? null : iconBox(id));
        return;
      }

      if (prev === id) return;
      if (prev) leave(prev);
      const cover = !loadedRef.current.has(id);
      setSwitching({ direction: prev ? Math.sign(indexOf(id) - indexOf(prev)) || 1 : 1, instant: how === 'keyboard' || cover });
      wake(id);
      setActive(id);
      if (cover) startLaunch(id, how === 'keyboard' ? null : iconBox(id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus, leave, wake, startLaunch],
  );

  /** Put `id` on one side. Starts split view, or changes one pane of it. */
  const openSplit = useCallback(
    (id: SocialAppId, side: Pane, how: How = 'pointer', at?: { x: number; y: number }) => {
      setOverview(false);
      setPasswordsOpen(false);
      setMenu(null);
      const sp = splitRef.current;
      const other: Pane = side === 'left' ? 'right' : 'left';
      // A dropped app always opens out of the icon that was dragged (the ghost
      // sits 8px below-right of the pointer, 44px square); the menu opens it out
      // of its dock icon; the keyboard shows the panel in place.
      const origin = how === 'keyboard' ? null : at ? { x: at.x + 8, y: at.y + 8, w: 44, h: 44 } : iconBox(id);
      // Its page makes its entrance under the panel.
      setSwitching({ direction: side === 'left' ? -1 : 1, instant: true });

      if (sp) {
        if (sp[side] === id) return focus(id);
        // Dropped onto the other side of an app that is already split: swap.
        if (sp[other] === id) {
          setSplit({ left: sp.right, right: sp.left });
          return focus(id);
        }
        leave(sp[side]);
        wake(id);
        setSplit({ ...sp, [side]: id });
        setActive(id);
        startLaunch(id, origin, 'load');
        return;
      }

      const primary = activeRef.current;
      // Split needs a second app; with nothing open this is an ordinary open.
      if (!primary || primary === id) return open(id, how);
      wake(id);
      setSplit(side === 'left' ? { left: id, right: primary } : { left: primary, right: id });
      setActive(id);
      startLaunch(id, origin, 'load');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus, leave, open, wake, startLaunch],
  );

  /** Leave split view; the focused pane takes the whole card. */
  const exitSplit = useCallback(() => {
    const sp = splitRef.current;
    if (!sp) return;
    const keep = activeRef.current ?? sp.left;
    leave(keep === sp.left ? sp.right : sp.left);
    setSwitching({ direction: 1, instant: false });
    setSplit(null);
  }, [leave]);

  /** Swap sides; each app keeps its width, as windows do. */
  const swapSplit = useCallback(() => {
    const sp = splitRef.current;
    if (!sp) return;
    setSplit({ left: sp.right, right: sp.left });
    setRatio((r) => clampRatio(1 - r));
  }, []);

  const toggleOverview = useCallback(async () => {
    setMenu(null);
    setPasswordsOpen(false);
    if (overviewRef.current) {
      setOverview(false);
      return;
    }
    const sp = splitRef.current;
    const shown = sp ? [sp.left, sp.right] : activeRef.current ? [activeRef.current] : [];
    await Promise.race([Promise.all(shown.map(snap)), new Promise((r) => setTimeout(r, 450))]);
    setOverview(true);
  }, [snap]);

  const act = useCallback(
    (action: string) => {
      if (action.startsWith('open:')) {
        const target = appById(action.slice(5));
        if (target) open(target.id, 'keyboard');
        return;
      }
      // Ctrl+Shift+1…6: into the other pane (or the right half, starting split view).
      if (action.startsWith('split:')) {
        const target = appById(action.slice(6));
        const sp = splitRef.current;
        if (target) openSplit(target.id, sp && activeRef.current === sp.right ? 'left' : 'right', 'keyboard');
        return;
      }
      if (action === 'overview') void toggleOverview();
      if (action === 'home') {
        onHome?.();
        return;
      }
      const id = activeRef.current;
      const wv = id ? views.current[id] : undefined;
      if (!wv) return;
      try {
        if (action === 'reload') wv.reload();
        if (action === 'back' && wv.canGoBack()) wv.goBack();
        if (action === 'forward' && wv.canGoForward()) wv.goForward();
      } catch {
        // Page not attached yet.
      }
    },
    [open, openSplit, toggleOverview, onHome],
  );

  // Page events.
  const onEvent = useCallback((id: SocialAppId, e: SiteEvent) => {
    if (e.type === 'badge') setBadges((b) => (b[id] === e.count ? b : { ...b, [id]: e.count }));
    if (e.type === 'loading') setLoading((l) => ({ ...l, [id]: e.loading }));
    if (e.type === 'nav') setNav((n) => ({ ...n, [id]: { canBack: e.canBack, canForward: e.canForward } }));
    if (e.type === 'ready') contents.current[id] = e.webContentsId;
    if (e.type === 'navigated') setOffers((o) => (o[id] ? { ...o, [id]: undefined } : o));
    if (e.type === 'loaded') setLoaded((l) => (l.has(id) ? l : new Set(l).add(id)));
    // Two-finger swipe across a page: that page goes back or forward.
    if (e.type === 'swipe') {
      const wv = views.current[id];
      try {
        if (e.direction === 'back' && wv?.canGoBack()) wv.goBack();
        if (e.direction === 'forward' && wv?.canGoForward()) wv.goForward();
      } catch {
        // Page not attached.
      }
    }
    // Split view: the pane the pointer is over becomes the focused one.
    if (e.type === 'take-focus') {
      const sp = splitRef.current;
      if (sp && (id === sp.left || id === sp.right) && activeRef.current !== id) {
        setActive(id);
        }
    }
  }, []);

  // A released (sleeping) page has to load again next time.
  useEffect(() => {
    setLoaded((l) => {
      const keep = [...l].filter((id) => live.has(id));
      return keep.length === l.size ? l : new Set(keep);
    });
  }, [live]);

  // A launch whose app is no longer on screen (replaced, slept, overview) ends.
  useEffect(() => {
    if (!launch) return;
    const shown = split ? launch.id === split.left || launch.id === split.right : launch.id === active;
    if (!shown || overview) setLaunch(null);
  }, [launch, split, active, overview]);

  const register = useCallback((id: SocialAppId, el: WebviewTag | null) => {
    if (el) views.current[id] = el;
    else delete views.current[id];
  }, []);

  // Social always opens on an empty stage — the owner's choice: closing it and
  // coming back should start fresh, not reopen whatever was last on screen.
  // Only an app named on the command line (`--app=`, from a shortcut) opens.
  // The divider's position is a setting, not an open app, so it is restored.
  useEffect(() => {
    if (!bridge) return;
    void bridge.state().then((s) => {
      if (typeof s?.splitRatio === 'number') setRatio(clampRatio(s.splitRatio));
      if (s?.openApp) open(s.openApp, 'pointer');
    });
  }, [open]);

  // Remember only where the divider sits, and not on every frame of a drag.
  useEffect(() => {
    if (!resizing) bridge?.setSplitRatio?.(ratio);
  }, [ratio, resizing]);

  // Shortcuts arrive from the main process, so they work inside a page too.
  useEffect(() => {
    if (bridge) {
      const off = bridge.onShortcut(act);
      return () => {
        off();
      };
    }
    // Plain browser: the same keys, from this page only.
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const digit = /^Digit([1-6])$/.exec(e.code)?.[1];
      let action: string | null = null;
      if (ctrl && e.shiftKey && digit) action = `split:${SOCIAL_APPS[Number(digit) - 1].id}`;
      else if (ctrl && digit) action = `open:${SOCIAL_APPS[Number(digit) - 1].id}`;
      else if (ctrl && e.key === 'ArrowUp') action = 'overview';
      if (!action) return;
      e.preventDefault();
      act(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);

  // Sign-ins.
  useEffect(() => {
    if (!bridge) return;
    const offForm = bridge.onLoginForm((p) =>
      setOffers((o) => ({ ...o, [p.app]: p.present && p.username ? { webContentsId: p.webContentsId, username: p.username } : undefined })),
    );
    const offSave = bridge.onSavePrompt(setPrompt);
    return () => {
      offForm();
      offSave();
    };
  }, []);

  // Which apps are on screen: the main process freezes the others after a while.
  useEffect(() => {
    bridge?.setShown?.(split ? [split.left, split.right] : active ? [active] : []);
  }, [active, split]);

  // Sleep apps left in the background. Anything on screen stays awake.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const after = sleepAfter((await bridge?.freeMemory?.().catch(() => null)) ?? null);
      const now = Date.now();
      const sp = splitRef.current;
      const shown = (id: SocialAppId) => id === activeRef.current || id === sp?.left || id === sp?.right;
      const sleepy = [...liveRef.current].filter((id) => !shown(id) && now - (lastSeen.current[id] ?? now) > after);
      if (!sleepy.length) return;
      for (const id of sleepy) void snap(id);
      setLive((s) => {
        const next = new Set(s);
        for (const id of sleepy) next.delete(id);
        return next;
      });
      setSleeping((s) => new Set([...s, ...sleepy]));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [snap]);

  const sleep = (id: SocialAppId) => {
    void snap(id);
    const sp = splitRef.current;
    if (sp && (sp.left === id || sp.right === id)) {
      // The other pane takes the whole card.
      setSplit(null);
      setActive(sp.left === id ? sp.right : sp.left);
    } else if (activeRef.current === id) {
      setActive(null);
    }
    setLive((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    setSleeping((s) => new Set(s).add(id));
  };

  // Unread total on the taskbar button.
  const total = Object.values(badges).reduce((sum, n) => sum + (n ?? 0), 0);
  useEffect(() => {
    bridge?.setBadge(badgeImage(total), total);
  }, [total]);

  // Escape closes the top layer, then split view, then Social itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (menu) setMenu(null);
      else if (overview) setOverview(false);
      else if (passwordsOpen) setPasswordsOpen(false);
      else if (split) exitSplit();
      else onHome?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, overview, passwordsOpen, split, exitSplit, onHome]);

  // Dragging the divider. Pages stop taking the pointer while it moves (a
  // <webview> would swallow the move events), and the panes follow it live.
  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    e.preventDefault();
    const box = stage.getBoundingClientRect();
    setResizing(true);
    const move = (ev: PointerEvent) => {
      const v = clampRatio((ev.clientX - box.left) / box.width);
      setRatio(RATIO_SNAPS.find((s) => Math.abs(s - v) < 0.015) ?? v);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setResizing(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onDividerKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') setRatio((r) => clampRatio(r - step));
    else if (e.key === 'ArrowRight') setRatio((r) => clampRatio(r + step));
    else if (e.key === 'Home' || e.key === 'Enter') setRatio(0.5);
    else return;
    e.preventDefault();
  };

  const current = appById(active);
  const currentNav = active ? nav[active] : undefined;
  const offer = active ? offers[active] : undefined;
  const otherPane = split ? (active === split.left ? split.right : split.left) : null;
  const shownOn = (id: SocialAppId) => (split ? (id === split.left ? 'split-left' : id === split.right ? 'split-right' : null) : id === active ? 'full' : null);

  return (
    <div className="soc" data-dragging={Boolean(drag)} data-resizing={resizing}>
      <div className="soc__grain" aria-hidden="true" />

      <header className="soc-titlebar">
        <div className="soc-nav" aria-label="Page">
          <button type="button" aria-label="Back" title="Back  Alt+←" disabled={!currentNav?.canBack} onClick={() => act('back')}>
            <ChevronLeft size={17} strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="Forward" title="Forward  Alt+→" disabled={!currentNav?.canForward} onClick={() => act('forward')}>
            <ChevronRight size={17} strokeWidth={1.8} />
          </button>
          <span className="soc-nav__sep" aria-hidden="true" />
          <button type="button" aria-label="Reload" title="Reload  Ctrl+R" disabled={!current} onClick={() => act('reload')}>
            <RotateCw size={14} strokeWidth={1.8} />
          </button>
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          {split && !overview ? (
            <motion.div
              key="panes"
              className="soc-panes-bar"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              <div className="soc-panes" role="tablist" aria-label="Split view panes">
                {(['left', 'right'] as const).map((pane) => {
                  const a = appById(split[pane])!;
                  const on = active === a.id;
                  return (
                    <button
                      key={pane}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      className="soc-panes__tab"
                      data-on={on}
                      title={`${pane === 'left' ? 'Left' : 'Right'} pane — back, reload and sign-in act on the focused pane`}
                      onClick={() => focus(a.id)}
                    >
                      {on && <motion.span layoutId="soc-pane-lens" className="soc-panes__lens" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
                      <img src={appIcons[a.id]} alt="" />
                      <span>{a.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="soc-nav soc-nav--tools" aria-label="Split view">
                <button type="button" aria-label="Swap sides" title="Swap sides" onClick={swapSplit}>
                  <ArrowLeftRight size={14} strokeWidth={1.8} />
                </button>
                <button type="button" aria-label="Exit split view" title="Exit split view  Esc" onClick={exitSplit}>
                  <Maximize2 size={13} strokeWidth={1.9} />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.h1
              key={overview ? 'overview' : (current?.id ?? 'none')}
              className="soc-titlebar__title"
              initial={{ opacity: 0, y: switching.instant ? 0 : 6 * switching.direction }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: switching.instant ? 0 : -6 * switching.direction, transition: { duration: 0.12 } }}
              transition={{ duration: switching.instant ? 0 : 0.2, ease: EASE }}
            >
              {overview ? 'Overview' : (current?.name ?? 'Social')}
            </motion.h1>
          )}
        </AnimatePresence>

        <div className="soc-titlebar__end">
          <AnimatePresence>{offer && !overview && <SignInChip key="chip" username={offer.username} onFill={() => void bridge?.fill(active!, offer.webContentsId)} />}</AnimatePresence>
        </div>
      </header>

      <Dock
        active={active}
        splitApp={otherPane}
        running={live}
        sleeping={sleeping}
        badges={badges}
        bounces={bounces}
        launching={launch && !launchGrown ? launch.id : null}
        overview={overview}
        passwordsOpen={passwordsOpen}
        onOpen={(id) => open(id, 'pointer')}
        onMenu={(id, x, y) => setMenu({ id, x, y })}
        onSplitDrop={(id, side, at) => openSplit(id, side, 'pointer', at)}
        onSplitDrag={(id, side, cursor) => setDrag(id && cursor ? { id, side, cursor } : null)}
        stageRef={stageRef}
        onOverview={() => void toggleOverview()}
        onPasswords={() => {
          setMenu(null);
          setOverview(false);
          setPasswordsOpen((o) => !o);
        }}
        onAxonix={() => (onHome ? onHome() : bridge?.openAxonix())}
      />

      <motion.main
        ref={stageRef}
        className="soc-stage"
        data-split={Boolean(split)}
        style={{ '--ratio': ratio } as React.CSSProperties}
        initial={false}
        // Opacity only — the card holds the pages, and a page under a scale transform draws at the wrong size.
        animate={{ opacity: overview ? 0.08 : 1 }}
        transition={{ duration: 0.2, ease: EASE }}
        aria-hidden={overview}
      >
        {SOCIAL_APPS.filter((a) => live.has(a.id) || snapshots[a.id]).map((a) => {
          const slot = shownOn(a.id);
          return (
            // Clicking into a page focuses it; the <webview> takes focus, which bubbles here.
            <div key={a.id} className="soc-stage__slot" onFocus={() => split && slot && focus(a.id)} onPointerDown={() => split && slot && focus(a.id)}>
              <Site
                app={a}
                active={slot !== null}
                live={live.has(a.id)}
                snapshot={snapshots[a.id]}
                slot={slot ?? 'full'}
                focused={Boolean(split) && a.id === active}
                loading={loading[a.id]}
                covered={launch?.id === a.id}
                direction={switching.direction}
                instant={switching.instant}
                onEvent={onEvent}
                register={register}
              />
            </div>
          );
        })}

        {split && (
          <div
            className="soc-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize split view"
            aria-valuemin={RATIO_MIN * 100}
            aria-valuemax={RATIO_MAX * 100}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            title="Drag to resize · double-click for equal halves"
            onPointerDown={onDividerDown}
            onDoubleClick={() => setRatio(0.5)}
            onKeyDown={onDividerKey}
          >
            <span className="soc-divider__grip" />
          </div>
        )}

        <AnimatePresence>
          {drag?.side && (
            <motion.div
              key="drop"
              className="soc-drop"
              data-side={drag.side}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.14 }}
            >
              <div className="soc-drop__target">
                <span className="soc-drop__glyph">{drag.side === 'left' ? <PanelLeft size={20} strokeWidth={1.7} /> : <PanelRight size={20} strokeWidth={1.7} />}</span>
                <span>
                  {split
                    ? split[drag.side] === drag.id
                      ? `${appById(drag.id)?.name} is already here`
                      : `Replace ${appById(split[drag.side])?.name}`
                    : `Open ${appById(drag.id)?.name} on the ${drag.side}`}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!active && (
          <div className="soc-empty">
            <p>Pick an app from the dock. Drag one onto the page to see two side by side.</p>
          </div>
        )}
      </motion.main>

      {drag && (
        <div className="soc-drag-ghost" style={{ transform: `translate3d(${drag.cursor.x + 8}px, ${drag.cursor.y + 8}px, 0)` }} aria-hidden="true">
          <img src={appIcons[drag.id]} alt="" />
        </div>
      )}

      <AnimatePresence>
        {overview && (
          <Overview
            key="overview"
            active={active}
            running={live}
            sleeping={sleeping}
            snapshots={snapshots}
            badges={badges}
            onPick={(id) => {
              setOverview(false);
              open(id, 'pointer');
            }}
            onClose={() => setOverview(false)}
          />
        )}
      </AnimatePresence>

      {launch && (
        <Launch
          key={launch.key}
          app={launch.id}
          origin={launch.origin}
          target={() => pageBox(launch.id)}
          pace={launch.pace}
          ready={loaded.has(launch.id) && !loading[launch.id]}
          onGrown={() => setLaunchGrown(true)}
          onDone={() => setLaunch((l) => (l?.key === launch.key ? null : l))}
        />
      )}

      <AnimatePresence>{passwordsOpen && <PasswordsPanel key="passwords" onClose={() => setPasswordsOpen(false)} />}</AnimatePresence>

      <AnimatePresence>{prompt && <SaveBubble key={prompt.token} prompt={prompt} onDone={() => setPrompt(null)} />}</AnimatePresence>

      <AnimatePresence>
        {menu && (
          <>
            <div key="scrim" className="soc-menu-scrim" onPointerDown={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()} />
            <motion.div
              key="menu"
              className="soc-menu"
              role="menu"
              style={{ left: menu.x + 6, top: menu.y - 8 }}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.16, ease: EASE }}
            >
              <p className="soc-menu__title">{appById(menu.id)?.name}</p>
              <MenuItem
                icon={<House size={14} strokeWidth={1.7} />}
                label="Back to feed"
                onClick={() => {
                  const id = menu.id;
                  open(id, 'pointer');
                  const target = appById(id);
                  const wv = views.current[id];
                  if (wv && target) void wv.loadURL(target.home);
                  setMenu(null);
                }}
              />
              <MenuItem
                icon={<RotateCw size={14} strokeWidth={1.7} />}
                label="Reload"
                disabled={!live.has(menu.id)}
                onClick={() => {
                  views.current[menu.id]?.reload();
                  setMenu(null);
                }}
              />
              <span className="soc-menu__sep" aria-hidden="true" />
              <MenuItem
                icon={<PanelLeft size={14} strokeWidth={1.7} />}
                label="Open on the left"
                disabled={!split && (!active || active === menu.id)}
                onClick={() => openSplit(menu.id, 'left')}
              />
              <MenuItem
                icon={<PanelRight size={14} strokeWidth={1.7} />}
                label="Open on the right"
                hint={`Ctrl+Shift+${indexOf(menu.id) + 1}`}
                disabled={!split && (!active || active === menu.id)}
                onClick={() => openSplit(menu.id, 'right')}
              />
              {split && (split.left === menu.id || split.right === menu.id) && (
                <MenuItem
                  icon={<Maximize2 size={14} strokeWidth={1.7} />}
                  label="Exit split view"
                  onClick={() => {
                    focus(menu.id);
                    setMenu(null);
                    // Keep the app that was right-clicked.
                    requestAnimationFrame(exitSplit);
                  }}
                />
              )}
              <span className="soc-menu__sep" aria-hidden="true" />
              <MenuItem
                icon={<Moon size={14} strokeWidth={1.7} />}
                label="Sleep now"
                disabled={!live.has(menu.id)}
                onClick={() => {
                  sleep(menu.id);
                  setMenu(null);
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({ icon, label, hint, disabled, onClick }: { icon: React.ReactNode; label: string; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="soc-menu__item" disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {hint && <kbd className="soc-menu__hint">{hint}</kbd>}
    </button>
  );
}
