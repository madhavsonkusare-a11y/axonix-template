/**
 * The Storeroom's grid: a masonry of references, newest along the top.
 *
 * Karakeep lays its cards out with react-masonry-css (round-robin columns).
 * Here every item already knows its size (the sidecar records it at capture),
 * so each card goes to the shortest column and nothing measures itself or
 * jumps. Video sizes arrive with their metadata.
 *
 * Cards are picture-first: an image, SVG or video fills its card, and its
 * title, why and id show on hover. Links show their screenshot and site; notes
 * show their text. Dragging a card hands the real file to another app.
 */
import { memo, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Globe, Play } from 'lucide-react';
import { isDesktop, mediaUrl, storeroomBackend as backend } from './backend';
import { liftAttrs, refThing } from '../next/lift/things';
import type { StoreItem } from './types';

const GAP = 14;
const MIN_COLUMN = 228;

/** Very tall or very wide pictures are cropped in the grid (never in the sheet). */
export const clampRatio = (r: number) => Math.min(3, Math.max(0.45, r));

function ratioOf(item: StoreItem, aspects: Readonly<Record<string, number>>): number {
  if (item.width && item.height) return item.width / item.height;
  return aspects[item.id] ?? (item.kind === 'video' ? 16 / 9 : 1);
}

/** Roughly how tall a card will be, to choose its column. */
function heightOf(item: StoreItem, width: number, aspects: Readonly<Record<string, number>>): number {
  if (item.kind === 'link') return width * 0.625 + 60;
  if (item.kind === 'note') {
    const chars = (item.notes || item.title).length;
    return 52 + Math.min(9, Math.ceil(chars / Math.max(18, width / 7.4))) * 19;
  }
  return width / clampRatio(ratioOf(item, aspects));
}

export function Masonry({
  items,
  aspects,
  fresh,
  onOpen,
  onMenu,
  onAspect,
  minColumn = MIN_COLUMN,
}: {
  /** The narrowest a column may be; fewer, wider columns as it grows. */
  minColumn?: number;
  items: StoreItem[];
  aspects: Readonly<Record<string, number>>;
  fresh: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onMenu: (item: StoreItem, at: { x: number; y: number }, trigger: HTMLElement) => void;
  onAspect: (id: string, ratio: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const count = Math.max(1, Math.floor((width + GAP) / (minColumn + GAP)));
  const columnWidth = width ? (width - GAP * (count - 1)) / count : minColumn;
  // Oldest first, each to the shortest column, then read newest first: a new
  // reference lands on top of one column and every other card stays put.
  const columns = useMemo(() => {
    const heights = new Array<number>(count).fill(0);
    const out: StoreItem[][] = Array.from({ length: count }, () => []);
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const shortest = heights.indexOf(Math.min(...heights));
      out[shortest].push(item);
      heights[shortest] += heightOf(item, columnWidth, aspects) + GAP;
    }
    return out.map((column) => column.reverse());
  }, [items, count, columnWidth, aspects]);

  return (
    <div ref={host} className="str-masonry" style={{ gap: GAP }}>
      {width > 0 &&
        columns.map((column, i) => (
          <div key={i} className="str-masonry__col" style={{ gap: GAP }}>
            {column.map((item) => (
              <ItemCard key={item.id} item={item} fresh={fresh.has(item.id)} ratio={ratioOf(item, aspects)} onOpen={onOpen} onMenu={onMenu} onAspect={onAspect} />
            ))}
          </div>
        ))}
    </div>
  );
}

const ItemCard = memo(function ItemCard({
  item,
  fresh,
  ratio,
  onOpen,
  onMenu,
  onAspect,
}: {
  item: StoreItem;
  fresh: boolean;
  ratio: number;
  onOpen: (id: string) => void;
  onMenu: (item: StoreItem, at: { x: number; y: number }, trigger: HTMLElement) => void;
  onAspect: (id: string, ratio: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const draggable = isDesktop && Boolean(item.file);
  const src = item.kind === 'video' ? mediaUrl(item, 'file') : mediaUrl(item, 'thumb');
  const menu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    onMenu(item, { x: e.clientX, y: e.clientY }, e.currentTarget);
  };

  let body: ReactNode;
  if (item.kind === 'link') {
    body = (
      <>
        <span className="str-card__shot">
          {src ? (
            <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : (
            <span className="str-card__noshot">
              {item.capture === 'pending' ? 'Capturing the page…' : item.capture === 'failed' ? 'Couldn’t capture this page' : item.site}
            </span>
          )}
          {item.capture === 'pending' && <span className="str-card__pulse" aria-hidden="true" />}
        </span>
        <span className="str-card__linkfoot">
          <span className="str-card__site">
            <Globe size={11} strokeWidth={1.8} aria-hidden="true" />
            {item.site ?? 'link'}
          </span>
          <span className="str-card__linktitle">{item.title}</span>
        </span>
      </>
    );
  } else if (item.kind === 'note') {
    body = (
      <span className="str-card__note">
        <span className="str-card__notetitle">{item.title}</span>
        {item.notes && item.notes.trim() !== item.title.trim() && <span className="str-card__notebody">{item.notes}</span>}
      </span>
    );
  } else {
    const style = { aspectRatio: String(clampRatio(ratio)) };
    body = (
      <>
        {item.kind === 'video' ? (
          <span
            className="str-card__media"
            style={style}
            onPointerEnter={() => void video.current?.play().catch(() => {})}
            onPointerLeave={() => video.current?.pause()}
          >
            {src && (
              <video
                ref={video}
                src={`${src}#t=0.1`}
                muted
                loop
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (!item.width && v.videoWidth && v.videoHeight) onAspect(item.id, v.videoWidth / v.videoHeight);
                }}
              />
            )}
            <span className="str-card__play" aria-hidden="true">
              <Play size={10} strokeWidth={0} fill="currentColor" />
            </span>
          </span>
        ) : (
          <span className="str-card__media" style={style} data-svg={item.kind === 'svg' || undefined}>
            {src && (
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (!item.width && img.naturalWidth && img.naturalHeight) onAspect(item.id, img.naturalWidth / img.naturalHeight);
                }}
              />
            )}
          </span>
        )}
        <span className="str-card__hover">
          <span className="str-card__id fin-num">{item.id}</span>
          <span className="str-card__title">{item.title}</span>
          {item.why && <span className="str-card__why">{item.why}</span>}
        </span>
      </>
    );
  }

  return (
    <button
      type="button"
      className="str-card"
      data-kind={item.kind}
      data-fresh={fresh || undefined}
      // Held still, the card is lifted (next/lift); dragged straight away, it is the file itself.
      {...liftAttrs(refThing(item), { hold: true })}
      aria-label={`${item.id} ${item.title}`}
      onClick={() => onOpen(item.id)}
      onContextMenu={menu}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              // The operating system's drag, carrying the real file (Electron's startDrag).
              e.preventDefault();
              backend.startDrag(item.id);
            }
          : undefined
      }
    >
      {body}
    </button>
  );
});
