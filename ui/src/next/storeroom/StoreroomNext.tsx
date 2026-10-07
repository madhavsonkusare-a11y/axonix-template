/**
 * The Storeroom in the new shell.
 *
 * Same library on disk, same context (`StoreroomContext`), and the pieces that
 * carry its behaviour are the first Storeroom's own: the masonry grid, the add
 * field, the item panel, and Social beside the grid for dragging pictures in.
 * Under this shell the item opens as a panel on the right edge and the module's
 * tan gives way to ink, so the references are the only colour on the page.
 *
 * What is new: the grid can be put in order (newest, oldest, by title) and its
 * pictures made smaller or larger; every tag is reachable, not the first
 * fourteen; and Unsorted says how much is waiting in the sidebar.
 *
 * Keys, as before: Ctrl+V keeps what is on the clipboard, `/` searches,
 * Ctrl+L goes to the add field.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Archive, PanelRight, Search, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import ErrorBoundary from '../../ErrorBoundary';
import { LiquidSegment } from '../../finance/components/Liquid';
import { Menu, PopUpButton, type MenuEntry } from '../../finance/components/Menu';
import { Masonry } from '../../storeroom/Grid';
import ItemSheet from '../../storeroom/ItemSheet';
import SocialPane, { PANE_MIN, type PaneDrag } from '../../storeroom/SocialPane';
import { AddField, VIEW_LABEL, inView, isUnsorted, matches, type AddFieldHandle } from '../../storeroom/StoreroomApp';
import { StoreroomProvider, useStoreroom } from '../../storeroom/StoreroomContext';
import { isDesktop, mediaUrl, storeroomBackend as backend } from '../../storeroom/backend';
import { carriesIntake, readTransfer } from '../../storeroom/capture';
import { pngDataUrl } from '../../storeroom/palette';
import type { StoreItem, StoreView } from '../../storeroom/types';
import Shell from '../Shell';
import type { DockApp } from '../Dock';
import { useDockApps } from '../apps';
import Linked from '../lift/Links';
import { StoreLens } from '../scrub/Lens';
import StoreroomSide, { STORE_VIEWS, storeroomMenu } from './StoreroomSide';

// The pane's own choices are the first Storeroom's, so they carry over.
const PANE_KEY = 'axonix:storeroom:pane';
const PANE_WIDTH_KEY = 'axonix:storeroom:pane-width';
const SORT_KEY = 'axonix.next.storeroom.sort';
const SIZE_KEY = 'axonix.next.storeroom.size';
/** How long after a drag starts in a social page its report still describes the drop. */
const DRAG_FRESH_MS = 60_000;

type Sort = 'new' | 'old' | 'title';
type Size = 's' | 'm' | 'l';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'new', label: 'Newest first' },
  { value: 'old', label: 'Oldest first' },
  { value: 'title', label: 'By title' },
];
/** The narrowest a column may be at each size. */
const COLUMN: Record<Size, number> = { s: 168, m: 228, l: 320 };

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience.
  }
};

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

export interface StoreroomNextProps {
  /** An item to open when the Storeroom shows (a toast's "Open"). */
  request?: { id: string; n: number } | null;
  onOpenApp: (id: string) => void;
  onSearch: () => void;
  onLegacy: () => void;
}

export default function StoreroomNext(props: StoreroomNextProps) {
  const apps = useDockApps();
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (props.request) setOpenId(props.request.id);
  }, [props.request]);
  return (
    <StoreroomProvider onOpenItem={setOpenId}>
      <StoreLens>
        <Room {...props} apps={apps} openId={openId} setOpenId={setOpenId} />
      </StoreLens>
    </StoreroomProvider>
  );
}

/**
 * The same room in a window of its own (`#storeroom`): no dock, no ruler, and
 * none of the other modules' state. That window never reads or writes
 * anything but the library.
 */
export function StoreroomAlone({ request, onLegacy }: { request?: { id: string; n: number } | null; onLegacy: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (request) setOpenId(request.id);
  }, [request]);
  return (
    <StoreroomProvider onOpenItem={setOpenId}>
      <Room apps={null} onLegacy={onLegacy} openId={openId} setOpenId={setOpenId} />
    </StoreroomProvider>
  );
}

function Room({
  apps,
  onOpenApp,
  onSearch,
  onLegacy,
  openId,
  setOpenId,
}: {
  /** The dock's modules, or null in the Storeroom's own window, which has no dock. */
  apps: DockApp[] | null;
  onOpenApp?: (id: string) => void;
  onSearch?: () => void;
  onLegacy: () => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  const alone = apps === null;
  const { items, loading, loadError, fresh, intake, keepFromSocial, trash, aspects, noteAspect } = useStoreroom();
  const [view, setView] = useState<StoreView>('all');
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<Sort>(() => (SORTS.some((s) => s.value === stored(SORT_KEY)) ? (stored(SORT_KEY) as Sort) : 'new'));
  const [size, setSizeState] = useState<Size>(() => (stored(SIZE_KEY) === 's' || stored(SIZE_KEY) === 'l' ? (stored(SIZE_KEY) as Size) : 'm'));
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ item: StoreItem; at: { x: number; y: number }; trigger: HTMLElement } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const add = useRef<AddFieldHandle>(null);
  const depth = useRef(0);

  const setSort = (s: Sort) => {
    setSortState(s);
    store(SORT_KEY, s);
  };
  const setSize = (s: Size) => {
    setSizeState(s);
    store(SIZE_KEY, s);
  };

  /* ---------- Social beside the Storeroom ---------- */

  const [pane, setPane] = useState(() => stored(PANE_KEY) === '1');
  const [paneWidth, setPaneWidth] = useState(() => {
    const saved = Number(stored(PANE_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= PANE_MIN ? saved : Math.max(PANE_MIN, Math.round(window.innerWidth * 0.36));
  });
  const [resizing, setResizing] = useState(false);
  const togglePane = () =>
    setPane((on) => {
      store(PANE_KEY, on ? '0' : '1');
      return !on;
    });
  // The last drag out of a social page, until its drop lands or it ends there.
  const guestDrag = useRef<{ drag: PaneDrag; at: number } | null>(null);
  const main = useRef<HTMLDivElement>(null);
  const keepRef = useRef(keepFromSocial);
  keepRef.current = keepFromSocial;
  const onGuestDrag = useCallback((drag: PaneDrag | null, endedAt?: { x: number; y: number } | null) => {
    if (drag) {
      guestDrag.current = { drag, at: Date.now() };
      return;
    }
    const ended = guestDrag.current;
    if (!ended) return;
    const box = main.current?.getBoundingClientRect();
    const overGrid = Boolean(endedAt && box && endedAt.x >= box.left && endedAt.x <= box.right && endedAt.y >= box.top && endedAt.y <= box.bottom);
    // A <webview> can report its dragend before the drop reaches this page
    // (electron#2897), and some drops never reach it at all. So: released over
    // the grid and no drop within half a second → keep it from the report.
    window.setTimeout(
      () => {
        if (guestDrag.current !== ended) return;
        guestDrag.current = null;
        if (overGrid) void keepRef.current(ended.drag.app, ended.drag.drag, []);
      },
      overGrid ? 450 : 1500,
    );
  }, []);
  const freshGuestDrag = () => {
    const g = guestDrag.current;
    return g && Date.now() - g.at < DRAG_FRESH_MS ? g.drag : null;
  };

  // A tag view whose last item lost the tag goes back to everything.
  useEffect(() => {
    if (view.startsWith('t:') && !loading && !items.some((i) => inView(i, view))) setView('all');
  }, [view, items, loading]);

  const inThisView = useMemo(() => items.filter((i) => inView(i, view)), [items, view]);
  const shown = useMemo(() => {
    const list = inThisView.filter((i) => matches(i, query));
    // The grid reads its list newest first.
    if (sort === 'old') return [...list].reverse();
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [inThisView, query, sort]);

  /* ---------- keys and the clipboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === '/' && !ctrl && !typing(e.target)) {
        e.preventDefault();
        search.current?.focus();
      } else if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        add.current?.focus();
      }
    };
    // Ctrl+V anywhere outside a field keeps what is on the clipboard.
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target) || document.querySelector('dialog[open]')) return;
      const list = readTransfer(e.clipboardData);
      if (!list.length) return;
      e.preventDefault();
      // Plain text is a note only when you say so: it goes into the add field.
      if (list.length === 1 && list[0].type === 'text') {
        add.current?.fill(list[0].text);
        return;
      }
      void intake(list, 'paste');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, [intake]);

  /* ---------- dropping ---------- */

  const acceptable = (data: DataTransfer | null) => carriesIntake(data) || freshGuestDrag() !== null;
  const onDragEnter = (e: DragEvent) => {
    if (!acceptable(e.dataTransfer)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!acceptable(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    // Dropped on the dock, the Pocket or the mark: Lift has taken it (next/lift).
    const taken = e.defaultPrevented;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (taken) return;
    // Read now: a drop's data is gone once this handler returns.
    const carried = readTransfer(e.dataTransfer);
    const social = freshGuestDrag();
    guestDrag.current = null;
    if (social) void keepFromSocial(social.app, social.drag, carried);
    else void intake(carried, 'drop');
  };

  /* ---------- a card's menu ---------- */

  const openMenu = useCallback((item: StoreItem, at: { x: number; y: number }, trigger: HTMLElement) => setMenu({ item, at, trigger }), []);
  const menuEntries = (item: StoreItem): MenuEntry[] => {
    const file = mediaUrl(item, 'file');
    const entries: MenuEntry[] = [{ id: 'open', label: 'Open', onSelect: () => setOpenId(item.id) }];
    if (isDesktop && file && (item.kind === 'image' || item.kind === 'svg' || item.kind === 'link')) {
      entries.push({
        id: 'copy',
        label: 'Copy image',
        onSelect: () =>
          void pngDataUrl(file)
            .then((png) => (png ? backend.copyImage(png) : false))
            .then((ok) => toast(ok ? `Copied ${item.id}` : 'Couldn’t copy the picture'))
            .catch(() => toast('Couldn’t copy the picture')),
      });
    }
    entries.push({
      id: 'id',
      label: `Copy id (${item.id})`,
      onSelect: () =>
        void navigator.clipboard
          .writeText(item.id)
          .then(() => toast(`Copied ${item.id}`))
          .catch(() => toast('Couldn’t copy that')),
    });
    if (item.source) entries.push({ id: 'source', label: 'Open source', onSelect: () => backend.openUrl(item.source!) });
    if (isDesktop) entries.push({ id: 'folder', label: 'Show in folder', onSelect: () => backend.showInFolder(item.id) });
    entries.push({ separator: true, id: 'sep' });
    entries.push({ id: 'trash', label: 'Move to trash', destructive: true, onSelect: () => void trash(item.id) });
    return entries;
  };

  const label = view.startsWith('t:') ? { title: `#${view.slice(2)}`, empty: 'Nothing with this tag.' } : VIEW_LABEL[view];
  const unsorted = items.filter(isUnsorted).length;

  const tabs = (
    <LiquidSegment<StoreView>
      label="Storeroom views"
      className="nx-tabs"
      mono={false}
      value={view}
      onChange={setView}
      options={[...STORE_VIEWS.map((v) => ({ value: v.key, label: v.label })), ...(view.startsWith('t:') ? [{ value: view, label: `#${view.slice(2)}` }] : [])]}
    />
  );

  return (
    <div className="nxs-root" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <Shell
        module="storeroom"
        title="Storeroom"
        icon={Archive}
        apps={apps ?? undefined}
        dockless={alone}
        onOpenApp={onOpenApp}
        onAsk={onSearch}
        side={<StoreroomSide view={view} onView={setView} onLegacy={onLegacy} alone={alone} />}
        tabs={tabs}
        menu={() => storeroomMenu(items, setView, onLegacy, alone)}
        lead={<AddField ref={add} onIntake={(list) => void intake(list, 'add')} />}
        actions={
          <>
            <label className="nx-find nxs-find">
              <Search size={14} strokeWidth={1.7} aria-hidden="true" />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    if (query) setQuery('');
                    else e.currentTarget.blur();
                  }
                }}
                placeholder="Search"
                aria-label="Search the Storeroom"
                spellCheck={false}
              />
              {query ? (
                <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={() => setQuery('')} aria-label="Clear the search">
                  <X size={12} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : (
                <span className="fin-key">/</span>
              )}
            </label>
            <button
              type="button"
              className="nx-iconbtn"
              onClick={togglePane}
              aria-pressed={pane}
              aria-label={pane ? 'Close Social beside the Storeroom' : 'Open Social beside the Storeroom'}
              title={pane ? 'Close Social' : 'Open Social beside the grid, to drag pictures in'}
            >
              <PanelRight size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </>
        }
        scrollKey="storeroom"
        fill
      >
        <ErrorBoundary label="storeroom">
          <div className="nxs" data-pane={pane || undefined} data-resizing={resizing || undefined}>
            <div ref={main} className="nxs-main">
              <div className="nxs-scroll">
                <div className="nxf-page nxs-page">
                  {loadError && (
                    <p className="fin-error" role="alert">
                      The Storeroom could not be read, so nothing new can be kept right now. ({loadError})
                    </p>
                  )}
                  <header className="nxf-head">
                    <div>
                      <h2>{label.title}</h2>
                      <p>
                        {loading ? (
                          ' '
                        ) : query ? (
                          <>
                            <b className="fin-num">{shown.length}</b> of {inThisView.length} match “{query}”
                          </>
                        ) : (
                          <>
                            <b className="fin-num">{shown.length}</b> {shown.length === 1 ? 'reference' : 'references'}
                            {view === 'all' && unsorted > 0 && (
                              <>
                                {' · '}
                                <button type="button" className="fin-link" onClick={() => setView('unsorted')}>
                                  {unsorted} unsorted
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="nxs-head__end">
                      <PopUpButton<Sort> label="Order" value={sort} onChange={setSort} options={SORTS} />
                      <LiquidSegment<Size>
                        label="Size of the pictures"
                        value={size}
                        onChange={setSize}
                        options={[
                          { value: 's', label: 'S' },
                          { value: 'm', label: 'M' },
                          { value: 'l', label: 'L' },
                        ]}
                      />
                    </div>
                  </header>
                  {!loading && !shown.length ? (
                    <section className="nxf-card">
                      <div className="fin-empty fin-empty--tall">
                        <p className="fin-empty__text">{query ? 'Nothing matches.' : label.empty}</p>
                      </div>
                    </section>
                  ) : (
                    <Masonry items={shown} aspects={aspects} fresh={fresh} onOpen={setOpenId} onMenu={openMenu} onAspect={noteAspect} minColumn={COLUMN[size]} />
                  )}
                </div>
              </div>
              {dragging && (
                <div className="nxs-drop" aria-hidden="true">
                  <div className="nxs-drop__panel">
                    <Upload size={20} strokeWidth={1.5} />
                    <strong>Drop to keep</strong>
                    <span>Images, SVG, video and links</span>
                  </div>
                </div>
              )}
            </div>
            {pane && (
              <SocialPane
                width={paneWidth}
                onResize={(w) => {
                  setPaneWidth(w);
                  store(PANE_WIDTH_KEY, String(w));
                }}
                onResizing={setResizing}
                onDrag={onGuestDrag}
                onClose={togglePane}
              />
            )}
          </div>
        </ErrorBoundary>
      </Shell>

      <ItemSheet id={openId} onClose={() => setOpenId(null)} extra={openId && !alone ? <Linked thing={{ kind: 'ref', id: openId }} before={() => setOpenId(null)} /> : undefined} />
      {menu && <Menu entries={menuEntries(menu.item)} placement={{ at: menu.at }} onClose={() => setMenu(null)} trigger={menu.trigger} label={`${menu.item.id} actions`} />}
    </div>
  );
}
