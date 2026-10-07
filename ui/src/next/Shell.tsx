/**
 * The new shell — paper at rest, glass in motion.
 *
 * Three things, each with one job:
 * - **The rail** says where you are: the modules, then the Pocket, the clock
 *   and the mark. A column on the left edge, standing on the ground (it was a
 *   floating dock until 2026-10-07).
 * - **The sidebar** is the module's own: its views first, then what it is made
 *   of. It sits on the ground beside the page, not inside it, and can be put
 *   away; its views then become tabs in the page's top bar and the rest moves
 *   into the menu on the module's name.
 * - **The page** is the one sheet of paper. Its top bar turns to glass once
 *   something scrolls beneath it.
 *
 * The page is whole: the rail has its own strip of the window, so nothing is
 * kept clear for it and nothing sits under it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, PanelLeft, type LucideIcon } from 'lucide-react';
import { Mark } from '../finance/components/Glyphs';
import { Menu, type MenuEntry } from '../finance/components/Menu';
import Dock, { type DockApp } from './Dock';
import { useNextLayout } from './layout';
import Ruler from './scrub/Ruler';
import { skyOf } from './sky';
import { relDay, shortDay, useScrub } from './scrub/Scrub';

const MOVE = { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
/** The hour, to the minute, so the sky can follow it. */
function useHour(): number {
  const read = () => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  };
  const [hour, setHour] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setHour(read()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return hour;
}

/** How many shells are on screen (one, except while a module hands over to the next). */
let shells = 0;
const nothing = () => {};

export interface ShellProps {
  /** The module showing, by its dock id. */
  module: string;
  title: string;
  icon: LucideIcon;
  apps?: DockApp[];
  onOpenApp?: (id: string) => void;
  /** The mark, and the search field: search, jump, or add. */
  onAsk?: () => void;
  /** A window that holds one module and nothing else (the Storeroom's own): no dock, no ruler. */
  dockless?: boolean;
  /** The sidebar's contents: the module's views, then its things. A module with no views (Home) has none. */
  side?: ReactNode;
  /** The same views as tabs, for when the sidebar is put away. */
  tabs?: ReactNode;
  /** Everything else in the sidebar, for the menu on the module's name. */
  menu?: () => MenuEntry[];
  /** The module's own field at the head of the top bar (Calendar's add line). Search takes the place when there is none. */
  lead?: ReactNode;
  /** The whole head of the top bar, drawn by the module (Tasks: the add line, Tasks | Projects, the filter). It has no sidebar then. */
  top?: ReactNode;
  /**
   * The sky the page stands on. Every module's page is the hour's sky; Home is
   * the exception, because it has the sky as a band of its own. Pass a mood to
   * choose one, or `false` for plain paper.
   */
  sky?: string | false;
  /** Trailing controls in the top bar. */
  actions?: ReactNode;
  /** Remounts the scroller, so each view starts at its top. */
  scrollKey: string;
  /**
   * The module lays out the page itself and scrolls its own parts (a calendar
   * grid, a document, a web page). The page then does not scroll as a whole.
   */
  fill?: boolean;
  children: ReactNode;
}

export default function Shell({ module, title, icon: Icon, apps, onOpenApp, onAsk, dockless, side, tabs, menu, lead, top, sky, actions, scrollKey, fill, children }: ShellProps) {
  const [layout, setLayout] = useNextLayout();
  const scrub = useScrub();
  // Whether the sidebar is showing. The preference is kept for the modules that have one.
  const hasSide = side !== undefined;
  const sided = hasSide && layout.list;
  const root = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const crumb = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  const hour = useHour();
  // Another day is shown at its noon: the sky says the hour, and that day has none in particular.
  const mood = sky === false ? undefined : (sky ?? (module === 'home' ? undefined : skyOf(scrub.live ? hour : 12)));

  // Menus, sheets and toasts render outside this tree; the skin and the dock's
  // edge are published on the root so they follow the new look as well.
  // The skin is taken off only when no shell is left: one module handing over
  // to the next must not drop it for an instant, or everything with a colour
  // transition would flash the first version's colours on the way in.
  useLayoutEffect(() => {
    const el = document.documentElement;
    shells += 1;
    el.dataset.nx = 'true';
    return () => {
      shells -= 1;
      queueMicrotask(() => {
        if (shells > 0) return;
        delete el.dataset.nx;
        delete el.dataset.nxDock;
      });
    };
  }, []);
  const edge = dockless ? 'none' : layout.edge;
  useLayoutEffect(() => {
    document.documentElement.dataset.nxDock = edge;
  }, [edge]);

  // Each view starts with a clear top bar.
  useLayoutEffect(() => {
    if (page.current) delete page.current.dataset.scrolled;
  }, [scrollKey]);

  /**
   * Applies a layout change and lets the page travel to its new place rather
   * than jump: the paper stretches from where it was and its contents slide.
   * Transform only.
   */
  const settle = useCallback((change: () => void) => {
    const before = { paper: paper.current?.getBoundingClientRect() };
    flushSync(change);
    const after = paper.current?.getBoundingClientRect();
    if (before.paper && after && paper.current && page.current) {
      const dx = before.paper.left - after.left;
      const dy = before.paper.top - after.top;
      const sx = before.paper.width / after.width;
      const sy = before.paper.height / after.height;
      if (dx || dy || sx !== 1 || sy !== 1) {
        paper.current.animate([{ transformOrigin: '0 0', transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }], MOVE);
        page.current.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }], MOVE);
      }
    }
  }, []);

  const toggleSide = useCallback(() => settle(() => setLayout({ list: !layout.list })), [layout.list, settle, setLayout]);

  // Ctrl/⌘+\ — the sidebar, the way editors toggle theirs.
  useEffect(() => {
    if (!hasSide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      toggleSide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSide, hasSide]);

  const entries = (): MenuEntry[] => [...(menu?.() ?? []),{ separator: true, id: 'sep-side' }, { id: 'side', label: 'Show the sidebar', hint: 'Ctrl \\', onSelect: toggleSide }];

  const toggle = (
    <button type="button" className="nx-iconbtn" aria-pressed={layout.list} aria-label={layout.list ? 'Hide the sidebar' : 'Show the sidebar'} title={`${layout.list ? 'Hide' : 'Show'} sidebar · Ctrl \\`} onClick={toggleSide}>
      <PanelLeft size={16} strokeWidth={1.6} aria-hidden="true" />
    </button>
  );

  return (
    <div ref={root} className="nx" data-module={module} data-view={scrollKey} data-dock={edge} data-side={sided} data-sky={mood} data-time={scrub.past ? 'past' : scrub.future ? 'future' : undefined}>
      {sided && (
        <aside className="nx-side" aria-label={title}>
          <div className="nx-side__head">
            <span className="nx-tile nx-tile--sm nx-tile--on">
              <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <span className="nx-side__title">{title}</span>
            {toggle}
          </div>
          {side}
        </aside>
      )}

      <div className="nx-sheet">
        <div ref={paper} className="nx-sheet__paper" aria-hidden="true" />
        <div ref={page} className="nx-sheet__page">
          {/* Looking back is warm, looking ahead is cool: a wash from the top of the page, over nothing you press. */}
          <div className="nx-wash" aria-hidden="true" />
          <div className="nx-main">
            <header className="nx-top">
              {top !== undefined ? (
                top
              ) : !hasSide ? (
                <span className="nx-brand">
                  <Mark />
                  AXONIX
                </span>
              ) : sided ? (
                // Search has one door, the mark in the rail (Ctrl K): the top bar no longer repeats it.
                lead
              ) : (
                <>
                  {toggle}
                  <button
                    ref={crumb}
                    type="button"
                    className="nx-crumb"
                    aria-haspopup="menu"
                    aria-expanded={menuAt !== null}
                    onClick={() => setMenuAt(menuAt ? null : (crumb.current?.getBoundingClientRect() ?? null))}
                  >
                    <span className="nx-tile nx-tile--xs nx-tile--on">
                      <Icon size={11} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span>{title}</span>
                    <ChevronDown className="nx-crumb__chev" size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <span className="nx-crumb__sep" aria-hidden="true">
                    /
                  </span>
                  <div className="nx-top__tabs">{tabs}</div>
                  {lead}
                </>
              )}
              {top === undefined && <span className="nx-top__space" />}
              {!scrub.live && (
                <span className="nx-tchip" role="status">
                  <i aria-hidden="true" />
                  <span>
                    <b>{scrub.past ? 'Looking back' : 'Looking ahead'}</b> · {shortDay(scrub.day)}, {relDay(scrub.day, scrub.today)}
                  </span>
                  <button type="button" className="fin-pill fin-pill--sm" onClick={scrub.reset}>
                    Back to today
                  </button>
                </span>
              )}
              <div className="nx-top__actions">{actions}</div>
            </header>
            <div
              className="nx-scroll fin-main__scroll"
              data-fill={fill || undefined}
              key={scrollKey}
              onScroll={(e) => {
                if (!page.current) return;
                if (e.currentTarget.scrollTop > 6) page.current.dataset.scrolled = 'true';
                else delete page.current.dataset.scrolled;
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>

      {!dockless && <Dock apps={apps ?? []} current={module} onOpen={onOpenApp ?? nothing} onAsk={onAsk ?? nothing} />}
      {!dockless && scrub.open && <Ruler edge={layout.edge} />}

      {menuAt && <Menu label={title} trigger={crumb.current} placement={{ over: menuAt }} minWidth={264} onClose={() => setMenuAt(null)} entries={entries()} />}
    </div>
  );
}
