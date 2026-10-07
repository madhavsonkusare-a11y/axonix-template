/**
 * The Storeroom's sidebar.
 *
 * Views first: everything, what still has no why and no tag, then each kind.
 * Under them the tags, folded when there are many. A tag is a place you go,
 * like a view, so the lens covers those rows too.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { AppWindow, Archive, ChevronRight, Clapperboard, FolderOpen, History, ImageIcon, Inbox, Link2, PenTool, StickyNote, type LucideIcon } from 'lucide-react';
import { LiquidLens, useLiquidIndicator } from '../../finance/components/Liquid';
import type { MenuEntry } from '../../finance/components/Menu';
import { inView } from '../../storeroom/StoreroomApp';
import { useStoreroom } from '../../storeroom/StoreroomContext';
import { isDesktop, storeroomBackend as backend } from '../../storeroom/backend';
import type { StoreItem, StoreView } from '../../storeroom/types';

export const STORE_VIEWS: { key: StoreView; label: string; icon: LucideIcon }[] = [
  { key: 'all', label: 'Everything', icon: Archive },
  { key: 'unsorted', label: 'Unsorted', icon: Inbox },
  { key: 'image', label: 'Images', icon: ImageIcon },
  { key: 'motion', label: 'Motion', icon: Clapperboard },
  { key: 'svg', label: 'Vectors', icon: PenTool },
  { key: 'link', label: 'Links', icon: Link2 },
  { key: 'note', label: 'Notes', icon: StickyNote },
];

const FOLD = 'axonix.next.storeroom.tags';
const FEW = 12;

export function tagCounts(items: StoreItem[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export default function StoreroomSide({ view, onView, onLegacy, alone }: { view: StoreView; onView: (v: StoreView) => void; onLegacy: () => void; /** Already in the Storeroom's own window. */ alone?: boolean }) {
  const { items } = useStoreroom();
  const host = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, view, 'y');
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(FOLD) !== 'closed';
    } catch {
      return true;
    }
  });
  const [all, setAll] = useState(false);
  const fold = useCallback(() => {
    setOpen((now) => {
      try {
        localStorage.setItem(FOLD, now ? 'closed' : 'open');
      } catch {
        /* storage refused: the fold lasts for this session only */
      }
      return !now;
    });
  }, []);

  const tags = useMemo(() => tagCounts(items), [items]);
  // The tag being looked at stays in the list even when the list is cut short.
  const current = view.startsWith('t:') ? view.slice(2) : null;
  const shown = all ? tags : tags.filter(([t], i) => i < FEW || t === current);
  const count = (v: StoreView) => items.filter((i) => inView(i, v)).length;

  return (
    <>
      <nav className="nx-nav nxs-nav" ref={host} aria-label="Storeroom views">
        <LiquidLens lensRef={lens} radius={10} />
        {STORE_VIEWS.map((v) => {
          const n = v.key === 'all' ? items.length : count(v.key);
          return (
            <button key={v.key} type="button" data-liquid-key={v.key} className="nx-nav__item" aria-current={v.key === view ? 'page' : undefined} onClick={() => onView(v.key)}>
              <span className="nx-nav__glyph">
                <v.icon size={16} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span>{v.label}</span>
              {n > 0 &&
                (v.key === 'unsorted' ? (
                  <span className="nx-nav__badge fin-num" title={`${n} with no why and no tag`}>
                    {n}
                  </span>
                ) : (
                  <span className="nxt-nav__count fin-num">{n}</span>
                ))}
            </button>
          );
        })}

        {tags.length > 0 && (
          <div className="nx-group__head nxt-nav__projects">
            <button type="button" className="nx-group__toggle" aria-expanded={open} onClick={fold}>
              <ChevronRight className="nx-group__chev" size={12} strokeWidth={2} aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
              <span>Tags</span>
              <span className="fin-num">{tags.length}</span>
            </button>
          </div>
        )}
        {open &&
          shown.map(([tag, n]) => {
            const key = `t:${tag}` as StoreView;
            return (
              <button key={key} type="button" data-liquid-key={key} className="nx-nav__item nxt-nav__project" aria-current={key === view ? 'page' : undefined} onClick={() => onView(key)}>
                <span className="nx-nav__glyph nxs-nav__hash fin-num">#</span>
                <span className="nxt-nav__name">{tag}</span>
                <span className="nxt-nav__count fin-num">{n}</span>
              </button>
            );
          })}
        {open && tags.length > FEW && (
          <button type="button" className="nx-row nxt-nav__add" onClick={() => setAll((v) => !v)}>
            <span className="nx-row__label">{all ? 'Show fewer' : `Show all ${tags.length}`}</span>
          </button>
        )}
      </nav>

      <div className="nx-side__foot">
        {isDesktop && (
          <>
            <button type="button" className="nx-row" onClick={() => backend.showInFolder(null)}>
              <span className="nx-row__icon">
                <FolderOpen size={14} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className="nx-row__label">Open the folder</span>
            </button>
            {!alone && (
              <button type="button" className="nx-row" onClick={() => backend.openWindow()}>
                <span className="nx-row__icon">
                  <AppWindow size={14} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <span className="nx-row__label">Open in its own window</span>
              </button>
            )}
          </>
        )}
        {/* In the app the first Storeroom is in Ctrl K. Its own window has no Ctrl K, so there the row stays. */}
        {alone && (
          <button type="button" className="nx-row" onClick={onLegacy}>
            <span className="nx-row__icon">
              <History size={14} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span className="nx-row__label">Legacy Storeroom</span>
          </button>
        )}
      </div>
    </>
  );
}

/** With the sidebar put away: the tags and the foot, as the menu on the module's name. */
export function storeroomMenu(items: StoreItem[], onView: (v: StoreView) => void, onLegacy: () => void, alone = false): MenuEntry[] {
  const glyph = { size: 14, strokeWidth: 1.6 } as const;
  const tags = tagCounts(items).slice(0, 14);
  return [
    ...tags.map(([tag, n]) => ({ id: `tag-${tag}`, label: `#${tag}`, hint: String(n), onSelect: () => onView(`t:${tag}`) })),
    ...(tags.length ? [{ separator: true as const, id: 'sep-tags' }] : []),
    ...(isDesktop
      ? [
          { id: 'folder', label: 'Open the folder', icon: <FolderOpen {...glyph} />, onSelect: () => backend.showInFolder(null) },
          ...(alone ? [] : [{ id: 'window', label: 'Open in its own window', icon: <AppWindow {...glyph} />, onSelect: () => backend.openWindow() }]),
          { separator: true as const, id: 'sep-desktop' },
        ]
      : []),
    ...(alone ? [{ id: 'legacy', label: 'Legacy Storeroom', icon: <History {...glyph} />, onSelect: onLegacy }] : []),
  ];
}
