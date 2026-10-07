/**
 * Storeroom — the inspiration library: rail, add field, the grid, the sheet.
 *
 * Not a canvas and not a design tool: a storeroom. References come in by drop,
 * paste, the add field, or "Save … to Storeroom" in Social; the rail sorts them
 * by kind and tag; each opens into a sheet where the why, tags and notes are
 * written. Built on the Finance shell (rail, lens, top bar, sheets) in the
 * Storeroom's tan.
 *
 * Keys: Ctrl+V keeps whatever is on the clipboard, `/` searches, Ctrl+L adds a
 * link, Escape goes back Home (in the main window).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent } from 'react';
import {
  AppWindow,
  Archive,
  Clapperboard,
  FolderOpen,
  ImageIcon,
  Inbox,
  Link2,
  PanelRight,
  PenTool,
  Plus,
  Search,
  StickyNote,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import ErrorBoundary from '../ErrorBoundary';
import { Mark } from '../finance/components/Glyphs';
import { LiquidLens, useLiquidIndicator } from '../finance/components/Liquid';
import { Menu, type MenuEntry } from '../finance/components/Menu';
import { isDesktop, mediaUrl, storeroomBackend as backend } from './backend';
import { carriesIntake, classifyText, readTransfer, type Intake } from './capture';
import { Masonry } from './Grid';
import ItemSheet from './ItemSheet';
import { pngDataUrl } from './palette';
import SocialPane, { PANE_MIN, type PaneDrag } from './SocialPane';
import { StoreroomProvider, useStoreroom } from './StoreroomContext';
import type { StoreItem, StoreView } from './types';

const PANE_KEY = 'axonix:storeroom:pane';
const PANE_WIDTH_KEY = 'axonix:storeroom:pane-width';
/** How long after a drag starts in a social page its report still describes the drop. */
const DRAG_FRESH_MS = 60_000;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience.
  }
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

export const isUnsorted = (i: StoreItem) => !i.why.trim() && i.tags.length === 0;
const isMotion = (i: StoreItem) => i.kind === 'video' || (i.kind === 'image' && /\.gif$/i.test(i.file ?? ''));

export function inView(item: StoreItem, view: StoreView): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'unsorted':
      return isUnsorted(item);
    case 'motion':
      return isMotion(item);
    case 'image':
      return item.kind === 'image' && !isMotion(item);
    case 'svg':
    case 'link':
    case 'note':
      return item.kind === view;
    default:
      return item.tags.includes(view.slice(2));
  }
}

/** Every word must appear somewhere: title, why, notes, tags, site, source or id. */
export function matches(item: StoreItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [item.id, item.title, item.why, item.notes, item.tags.map((t) => `#${t}`).join(' '), item.site, item.source, item.description].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w.replace(/^#/, '')));
}

export const VIEW_LABEL: Record<string, { title: string; empty: string }> = {
  all: { title: 'Everything', empty: 'Drop images, SVG or video here, paste with Ctrl+V, or right-click anything in Social → Save to Storeroom.' },
  unsorted: { title: 'Unsorted', empty: 'Everything has a why or a tag. Nothing waiting.' },
  image: { title: 'Images', empty: 'No still images yet.' },
  motion: { title: 'Motion', empty: 'GIFs and video land here — references for timing and easing.' },
  svg: { title: 'Vectors', empty: 'Paste SVG code (Copy as SVG in Paper or Figma) or drop .svg files.' },
  link: { title: 'Links', empty: 'Paste a web address and it arrives with a screenshot.' },
  note: { title: 'Notes', empty: 'Type a thought into the add field and press Enter.' },
};

export default function StoreroomApp({ onHome, homeTitle, request, standalone = false }: { onHome?: () => void; /** What the brand button says it does, where it is not "back to Home". */ homeTitle?: string; request?: { id: string; n: number } | null; standalone?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (request) setOpenId(request.id);
  }, [request]);
  return (
    <StoreroomProvider onOpenItem={setOpenId}>
      <Storeroom onHome={onHome} homeTitle={homeTitle} openId={openId} setOpenId={setOpenId} standalone={standalone} />
    </StoreroomProvider>
  );
}

function Storeroom({ onHome, homeTitle, openId, setOpenId, standalone }: { onHome?: () => void; homeTitle?: string; openId: string | null; setOpenId: (id: string | null) => void; standalone: boolean }) {
  const { items, loading, loadError, fresh, intake, keepFromSocial, trash, aspects, noteAspect, root } = useStoreroom();
  const [view, setView] = useState<StoreView>('all');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ item: StoreItem; at: { x: number; y: number }; trigger: HTMLElement } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const add = useRef<AddFieldHandle>(null);
  const depth = useRef(0);

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
  const onGuestDrag = useCallback(
    (drag: PaneDrag | null, endedAt?: { x: number; y: number } | null) => {
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
    },
    [],
  );
  const freshGuestDrag = () => {
    const g = guestDrag.current;
    return g && Date.now() - g.at < DRAG_FRESH_MS ? g.drag : null;
  };

  // A tag view whose last item lost the tag goes back to everything.
  useEffect(() => {
    if (view.startsWith('t:') && !loading && !items.some((i) => inView(i, view))) setView('all');
  }, [view, items, loading]);

  const shown = useMemo(() => items.filter((i) => inView(i, view) && matches(i, query)), [items, view, query]);

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
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
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

  return (
    <div
      className="fin str"
      data-pane={pane || undefined}
      data-resizing={resizing || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Rail view={view} onView={setView} onHome={onHome} homeTitle={homeTitle} />
      <div ref={main} className="fin-main">
        <div className="fin-grain fin-main__grain" aria-hidden="true" />
        <div className="fin-topbar str-topbar">
          <AddField ref={add} onIntake={(list) => void intake(list, 'add')} />
          <div className="fin-topbar__right">
            <label className="str-search">
              <Search size={13} strokeWidth={1.9} aria-hidden="true" />
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
              {!query && <span className="fin-key">/</span>}
            </label>
            <button
              type="button"
              className="fin-icon-btn fin-icon-btn--lg str-pane-toggle"
              onClick={togglePane}
              aria-pressed={pane}
              aria-label={pane ? 'Close Social beside the Storeroom' : 'Open Social beside the Storeroom'}
              title={pane ? 'Close Social' : 'Open Social beside the Storeroom — drag pictures into the grid'}
            >
              <PanelRight size={15} strokeWidth={1.7} />
            </button>
            {isDesktop && !standalone && (
              <button type="button" className="fin-icon-btn fin-icon-btn--lg" onClick={() => backend.openWindow()} aria-label="Open in its own window" title="Open in its own window">
                <AppWindow size={15} strokeWidth={1.7} />
              </button>
            )}
          </div>
        </div>
        <div className="fin-main__scroll">
          <ErrorBoundary label="storeroom">
            <div className="str-page">
              {loadError && (
                <p className="fin-error" role="alert">
                  The Storeroom could not be read, so nothing new can be kept right now. ({loadError})
                </p>
              )}
              <div className="fin-page__head str-head">
                <div className="fin-page__lead">
                  <h2>{label.title}</h2>
                  <p>
                    {loading
                      ? ' '
                      : query
                        ? `${shown.length} of ${items.filter((i) => inView(i, view)).length} match “${query}”`
                        : view === 'all'
                          ? `${items.length} reference${items.length === 1 ? '' : 's'}${unsorted ? ` · ${unsorted} unsorted` : ''}`
                          : `${shown.length} reference${shown.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                {isDesktop && (
                  <button type="button" className="fin-link str-head__folder" onClick={() => backend.showInFolder(null)} title={root}>
                    <FolderOpen size={13} strokeWidth={1.8} />
                    Open the folder
                  </button>
                )}
              </div>
              {!loading && !shown.length ? (
                <div className="str-empty">
                  <p>{query ? 'Nothing matches.' : label.empty}</p>
                </div>
              ) : (
                <Masonry items={shown} aspects={aspects} fresh={fresh} onOpen={setOpenId} onMenu={openMenu} onAspect={noteAspect} />
              )}
            </div>
          </ErrorBoundary>
        </div>
        {dragging && (
          <div className="str-drop" aria-hidden="true">
            <div className="str-drop__panel">
              <Upload size={20} strokeWidth={1.6} />
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
      <ItemSheet id={openId} onClose={() => setOpenId(null)} />
      {menu && <Menu entries={menuEntries(menu.item)} placement={{ at: menu.at }} onClose={() => setMenu(null)} trigger={menu.trigger} label={`${menu.item.id} actions`} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the add field                                                       */
/* ------------------------------------------------------------------ */

export interface AddFieldHandle {
  focus(): void;
  fill(text: string): void;
}

export const AddField = forwardRef<AddFieldHandle, { onIntake: (list: Intake[]) => void }>(function AddField({ onIntake }, ref) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    fill: (text) => {
      setValue(text);
      input.current?.focus();
    },
  }));
  const kind = classifyText(value)[0]?.type;
  const hint = !value.trim() ? null : kind === 'url' ? 'Link' : kind === 'svg' ? 'SVG' : 'Note';
  const submit = () => {
    const list = classifyText(value);
    if (!list.length) return;
    onIntake(list);
    setValue('');
  };
  const onPaste = (e: ReactClipboardEvent<HTMLInputElement>) => {
    // Pasted files (an image, an SVG from Explorer) are kept at once.
    const list = readTransfer(e.clipboardData);
    if (list.length && list.every((i) => i.type === 'file')) {
      e.preventDefault();
      onIntake(list);
    }
  };
  return (
    <div className="str-add" data-focused={focused || undefined}>
      <button type="button" className="str-add__plus" onClick={() => picker.current?.click()} aria-label="Add files" title="Add files">
        <Plus size={14} strokeWidth={2} />
      </button>
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            if (value) setValue('');
            else e.currentTarget.blur();
          }
        }}
        placeholder="Paste a link, SVG code or a thought — Enter keeps it"
        aria-label="Add to the Storeroom"
        spellCheck={false}
      />
      {hint ? <span className="str-add__hint">{hint}</span> : <span className="fin-key str-add__key">Ctrl L</span>}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept="image/*,video/*,.svg"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) onIntake(files.map((file) => ({ type: 'file', file })));
        }}
      />
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* the rail                                                            */
/* ------------------------------------------------------------------ */

interface RailItem {
  key: StoreView;
  label: string;
  icon?: LucideIcon;
  count: number;
}

function Rail({ view, onView, onHome, homeTitle }: { view: StoreView; onView: (v: StoreView) => void; onHome?: () => void; homeTitle?: string }) {
  const { items } = useStoreroom();
  const host = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, view, 'y');

  const count = (v: StoreView) => items.filter((i) => inView(i, v)).length;
  const library: RailItem[] = [
    { key: 'all', label: 'Everything', icon: Archive, count: items.length },
    { key: 'unsorted', label: 'Unsorted', icon: Inbox, count: count('unsorted') },
  ];
  const kinds: RailItem[] = [
    { key: 'image', label: 'Images', icon: ImageIcon, count: count('image') },
    { key: 'motion', label: 'Motion', icon: Clapperboard, count: count('motion') },
    { key: 'svg', label: 'Vectors', icon: PenTool, count: count('svg') },
    { key: 'link', label: 'Links', icon: Link2, count: count('link') },
    { key: 'note', label: 'Notes', icon: StickyNote, count: count('note') },
  ];
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  }, [items]);

  const row = (n: RailItem) => {
    const on = n.key === view;
    const Icon = n.icon;
    return (
      <button key={n.key} type="button" data-liquid-key={n.key} className={on ? 'fin-nav fin-nav--on' : 'fin-nav'} aria-current={on ? 'page' : undefined} onClick={() => onView(n.key)}>
        <span className="fin-nav__glyph">{Icon ? <Icon size={15} strokeWidth={1.5} color={on ? 'var(--str-accent-text)' : 'rgba(226,234,252,.42)'} aria-hidden="true" /> : <span className="str-nav__hash">#</span>}</span>
        <span className="str-nav__label">{n.label}</span>
        {n.count ? <span className="fin-nav__count">{n.count}</span> : null}
      </button>
    );
  };

  return (
    <aside className="fin-rail str-rail">
      <div className="fin-grain fin-rail__grain" aria-hidden="true" />
      {onHome ? (
        <button type="button" className="fin-rail__brand" onClick={onHome} title={homeTitle ?? 'Back to Axonix Home'}>
          <Mark />
          <span>{homeTitle ? 'STOREROOM' : 'AXONIX'}</span>
        </button>
      ) : (
        <span className="fin-rail__brand str-rail__brand">
          <Mark />
          <span>STOREROOM</span>
        </span>
      )}
      <nav className="fin-rail__nav str-rail__nav" ref={host}>
        <LiquidLens lensRef={lens} radius={10} />
        <span className="fin-rail__section">Storeroom</span>
        {library.map(row)}
        <span className="fin-rail__section fin-rail__section--gap">Kinds</span>
        {kinds.map(row)}
        {tags.length > 0 && <span className="fin-rail__section fin-rail__section--gap">Tags</span>}
        {tags.map(([tag, n]) => row({ key: `t:${tag}`, label: tag, count: n }))}
      </nav>
    </aside>
  );
}
