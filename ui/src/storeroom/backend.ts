/**
 * Where the Storeroom's items live.
 *
 * In the desktop app: `D:\04 Media\Storeroom`, through the main process
 * (`electron/storeroom.ts`, exposed by the preload as `window.axonixStoreroom`).
 * Media reaches the page through `storeroom://`.
 *
 * In a plain browser (the Vite dev server): the same service in memory, with a
 * few made-up references, so the grid can be clicked through without touching
 * the real library. Nothing here survives a reload.
 */
import type { GuestDrag } from '../social/Site';
import type { AddResult, ItemPatch, Kind, Listing, SavedNotice, StoreItem } from './types';

export interface StoreroomBridge {
  list(): Promise<Listing>;
  pathForFile(file: File): string | null;
  addFiles(paths: string[], via: string): Promise<AddResult[]>;
  addBytes(name: string, data: Uint8Array, via: string): Promise<AddResult>;
  addText(text: string, via: string): Promise<AddResult>;
  addUrl(url: string, via: string): Promise<AddResult>;
  /** A picture or link dragged out of a social page beside the Storeroom, saved through that app's session. */
  saveSocial(app: string, drag: GuestDrag): Promise<AddResult>;
  update(id: string, patch: ItemPatch): Promise<StoreItem>;
  /** Moves the item's folder into `.trash/`; resolves to its name there, for Undo. */
  trash(id: string): Promise<string>;
  restore(trashName: string): Promise<StoreItem>;
  recapture(id: string): Promise<StoreItem>;
  copyImage(pngDataUrl: string): Promise<boolean>;
  showInFolder(id: string | null): void;
  openUrl(url: string): void;
  /** Drag the item's real file out of Axonix (into Paper, Figma, Explorer). */
  startDrag(id: string): void;
  openWindow(): void;
  onChanged(cb: () => void): () => void;
  onSaved(cb: (notice: SavedNotice) => void): () => void;
  onFailed(cb: (failure: { message: string }) => void): () => void;
}

const desktop: StoreroomBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { axonixStoreroom?: StoreroomBridge }).axonixStoreroom ?? null) : null;

export const isDesktop = desktop !== null;

/* ------------------------------------------------------------------ */
/* the browser stand-in                                                */
/* ------------------------------------------------------------------ */

interface Entry {
  item: StoreItem;
  blob?: Blob;
}

const memory = new Map<string, Entry>();
const trashed = new Map<string, Entry>();
const listeners = new Set<() => void>();
const blobUrls = new Map<Blob, string>();
let counter = 0;

const changed = () => queueMicrotask(() => listeners.forEach((l) => l()));
const nowIso = () => new Date().toISOString();

function make(kind: Kind, fields: Partial<StoreItem>, blob?: Blob): StoreItem {
  counter += 1;
  const id = `R${String(counter).padStart(4, '0')}`;
  const item: StoreItem = { id, kind, title: id, tags: [], why: '', notes: '', created: nowIso(), mtime: Date.now(), files: [], ...fields };
  if (blob && !item.file) item.file = kind === 'svg' ? 'vector.svg' : kind === 'video' ? 'clip.mp4' : 'image.png';
  if (item.file) item.files = [item.file];
  if (blob) item.bytes = blob.size;
  memory.set(id, { item, blob });
  changed();
  return item;
}

const poster = (w: number, h: number, body: string) =>
  new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`], { type: 'image/svg+xml' });

function seed() {
  if (counter) return;
  make(
    'svg',
    { title: 'Grid study (demo)', why: 'One red block carries the whole composition.', tags: ['poster', 'layout/grid'], width: 600, height: 840, via: 'demo' },
    poster(600, 840, '<rect width="600" height="840" fill="#efe9dd"/><rect x="48" y="48" width="330" height="330" fill="#e2332b"/><rect x="48" y="420" width="504" height="6" fill="#111"/><text x="48" y="520" font-family="Arial" font-weight="700" font-size="92" fill="#111">Kunst</text><text x="48" y="600" font-family="Arial" font-size="92" fill="#111">gewerbe</text><text x="48" y="790" font-family="Arial" font-size="18" fill="#111">Demo reference — not a real item</text>'),
  );
  make(
    'svg',
    { title: 'Cold mesh (demo)', tags: ['color', 'gradient'], width: 800, height: 520, via: 'demo' },
    poster(800, 520, '<defs><radialGradient id="a" cx="30%" cy="20%" r="90%"><stop offset="0" stop-color="#bfe3ff"/><stop offset=".45" stop-color="#4a7ee8"/><stop offset="1" stop-color="#06070a"/></radialGradient></defs><rect width="800" height="520" fill="url(#a)"/>'),
  );
  make(
    'svg',
    { title: 'Mono specimen (demo)', why: 'Numerals that sit tight at large sizes.', tags: ['type/mono'], width: 640, height: 640, via: 'demo' },
    poster(640, 640, '<rect width="640" height="640" fill="#0d0f12"/><text x="40" y="360" font-family="Consolas, monospace" font-size="260" fill="#f7f9fc">Aa1</text><text x="44" y="600" font-family="Consolas, monospace" font-size="20" fill="#7c838d">0123456789 — demo</text>'),
  );
  make('note', { title: 'Exits beat entrances (demo)', notes: 'Leaving should be faster than arriving: 150ms out, 240ms in. Demo note.', tags: ['motion'], via: 'demo' });
  make('link', { title: 'A saved page (demo)', source: 'https://example.com/', site: 'example.com', description: 'In the desktop app a saved link arrives with a screenshot of the page.', via: 'demo' });
}

function extKind(name: string): Kind | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'svg') return 'svg';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  return null;
}

const SVG_TEXT = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;

const browser: StoreroomBridge = {
  async list() {
    seed();
    const items = [...memory.values()].map((e) => e.item).sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
    return { root: 'this browser (dev mode)', items, trashed: trashed.size };
  },
  pathForFile: () => null,
  async addFiles() {
    return [{ ok: false, error: 'Files arrive by content in the browser', name: '' }];
  },
  async addBytes(name, data, via) {
    const kind = extKind(name);
    if (!kind) return { ok: false, error: `${name}: only images, SVG and video go in the Storeroom`, name };
    const type = kind === 'svg' ? 'image/svg+xml' : kind === 'video' ? 'video/mp4' : 'image/png';
    const blob = new Blob([data.slice()], { type });
    let dims: { width?: number; height?: number } = {};
    if (kind !== 'video') {
      try {
        const bmp = await createImageBitmap(blob);
        dims = { width: bmp.width, height: bmp.height };
      } catch {
        dims = {};
      }
    }
    return { ok: true, item: make(kind, { title: name.replace(/\.[^.]*$/, ''), file: name, via, ...dims }, blob), name };
  },
  async addText(text, via) {
    if (SVG_TEXT.test(text)) return { ok: true, item: make('svg', { title: 'Pasted SVG', via }, new Blob([text], { type: 'image/svg+xml' })), name: 'text' };
    const first = text.trim().split(/\r?\n/)[0].slice(0, 80) || 'Note';
    return { ok: true, item: make('note', { title: first, notes: text.trim(), via }), name: 'text' };
  },
  async addUrl(url, via) {
    const existing = [...memory.values()].find((e) => e.item.source === url);
    if (existing) return { ok: true, item: existing.item, duplicate: true, name: url };
    const host = new URL(url).hostname.replace(/^www\./, '');
    return { ok: true, item: make('link', { title: host, source: url, site: host, via }), name: url };
  },
  async saveSocial(app, drag) {
    const via = `social:${app}`;
    if (drag.src) {
      const existing = [...memory.values()].find((e) => e.item.mediaUrl === drag.src);
      if (existing) return { ok: true, item: existing.item, duplicate: true, name: drag.src };
      return { ok: true, item: make('image', { title: drag.alt || drag.title || app, source: drag.page || undefined, mediaUrl: drag.src, via }), name: drag.src };
    }
    if (drag.link) return browser.addUrl(drag.link, via);
    return { ok: false, error: 'Nothing to keep in that drag' };
  },
  async update(id, patch) {
    const entry = memory.get(id);
    if (!entry) throw new Error(`${id} is not in the Storeroom`);
    entry.item = { ...entry.item, ...patch, mtime: Date.now() };
    changed();
    return entry.item;
  },
  async trash(id) {
    const entry = memory.get(id);
    if (!entry) throw new Error(`${id} is not in the Storeroom`);
    memory.delete(id);
    const name = `${Date.now()} ${id}`;
    trashed.set(name, entry);
    changed();
    return name;
  },
  async restore(name) {
    const entry = trashed.get(name);
    if (!entry) throw new Error('That item is no longer in the trash.');
    trashed.delete(name);
    memory.set(entry.item.id, entry);
    changed();
    return entry.item;
  },
  async recapture(id) {
    const entry = memory.get(id);
    if (!entry) throw new Error(`${id} is not in the Storeroom`);
    return entry.item;
  },
  async copyImage() {
    return false;
  },
  showInFolder() {},
  openUrl(url) {
    window.open(url, '_blank', 'noopener');
  },
  startDrag() {},
  openWindow() {},
  onChanged(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  onSaved() {
    return () => {};
  },
  onFailed() {
    return () => {};
  },
};

export const storeroomBackend: StoreroomBridge = desktop ?? browser;

/**
 * An item's picture for the grid (a thumbnail where one is worth making), or
 * one of its files at full size. `v` changes only when the media does, so
 * editing a title never reloads the image.
 */
export function mediaUrl(item: StoreItem, which: 'thumb' | 'file' = 'thumb', name = item.file): string | null {
  if (!name) return null;
  if (!desktop) {
    const blob = memory.get(item.id)?.blob;
    if (!blob) return null;
    let url = blobUrls.get(blob);
    if (!url) {
      url = URL.createObjectURL(blob);
      blobUrls.set(blob, url);
    }
    return url;
  }
  const v = `${name}-${item.bytes ?? 0}`;
  return which === 'thumb' && name === item.file
    ? `storeroom://thumb/${item.id}?v=${encodeURIComponent(v)}`
    : `storeroom://file/${item.id}/${encodeURIComponent(name)}?v=${encodeURIComponent(v)}`;
}
