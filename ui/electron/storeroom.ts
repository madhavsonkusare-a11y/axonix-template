/**
 * Storeroom — the inspiration library's file service (main process).
 *
 * Modelled on Karakeep's bookmark model (links, notes and assets, tags, a
 * crawler that screenshots every saved link), rebuilt the Axonix way: files are
 * the truth. Every item is a folder, `items/R0042/`, holding its media and an
 * `item.md` sidecar (YAML frontmatter + free notes), so Explorer, Obsidian and
 * agents can read the whole library with nothing running. `R0042` is the item's
 * stable name — short enough to say out loud ("use R0042") and never reused,
 * not even after the item is trashed.
 *
 *   <root>/items/R0042/item.md          frontmatter: kind, title, why, tags, source…
 *   <root>/items/R0042/<media file>      the image, SVG, video or link screenshot
 *   <root>/.trash/<stamp> R0042/         "deleted" items; nothing here is erased
 *   <root>/.cache/thumbs/                thumbnails — safe to delete, rebuilt on demand
 *
 * Media reaches the page read-only through `storeroom://file/<id>/<name>` and
 * `storeroom://thumb/<id>`. Links are captured in a hidden, sandboxed window
 * with its own in-memory session (1440×900, JPEG 80 — Karakeep's defaults).
 */
import { BrowserWindow, clipboard, ClipboardItem, ipcMain, nativeImage, net, protocol, session, shell } from 'electron';
import type { CustomScheme, IpcMainInvokeEvent, NativeImage, Session, WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { imageSize } from 'image-size';
import YAML from 'yaml';
import { appById, partitionOf } from '../src/social/apps';
import { blockTrackers } from './blocker';

/** Registered with the vault's scheme before `app.whenReady()`. */
export const STOREROOM_SCHEME: CustomScheme = {
  scheme: 'storeroom',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

export type Kind = 'image' | 'svg' | 'video' | 'link' | 'note';

export interface StoreItem {
  id: string;
  kind: Kind;
  title: string;
  /** The item's main media file, inside its folder. Notes have none. */
  file?: string;
  /** Where it came from: the page for a saved image, the address for a link. */
  source?: string;
  /** The media's own address, when it differs from `source`. */
  mediaUrl?: string;
  /** How it arrived: drop, paste, add, social:pinterest… */
  via?: string;
  tags: string[];
  why: string;
  notes: string;
  width?: number;
  height?: number;
  bytes?: number;
  site?: string;
  description?: string;
  icon?: string;
  /** A link still being captured, or one whose capture failed. */
  capture?: 'pending' | 'failed';
  created: string;
  mtime: number;
  files: string[];
}

export interface AddResult {
  ok: boolean;
  item?: StoreItem;
  duplicate?: boolean;
  error?: string;
  name?: string;
}

interface Options {
  root: string;
  /** The Axonix windows allowed to use the Storeroom: the main window and the Storeroom's own. */
  isHost: (sender: WebContents) => boolean;
  broadcast: (channel: string, payload: unknown) => void;
  openWindow: () => void;
}

export interface StoreroomService {
  root: string;
  saveRemoteMedia(ses: Session, url: string, from: Origin): Promise<StoreItem>;
  saveLink(url: string, via: string): Promise<StoreItem>;
  saveScreenshot(image: NativeImage, from: Origin): StoreItem;
  saveText(text: string, from: Origin): StoreItem;
}

interface Origin {
  page?: string;
  title?: string;
  via: string;
}

const MAX_MEDIA_BYTES = 400 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const THUMB_WIDTH = 720;
const CRAWL_VIEWPORT = { width: 1440, height: 900 };
const CRAWL_TIMEOUT_MS = 25_000;
const CRAWL_SETTLE_MS = 1_500;

const ID = /^R\d{4,7}$/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};
const EXT_OF_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
const SVG_TEXT = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;

const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

function kindOfExt(ext: string): Kind | null {
  if (ext === 'svg') return 'svg';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

/** Local time with its offset — sortable, and readable in Obsidian. */
function localIso(d = new Date()): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function webUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A URL reduced to what identifies the page, for "already saved". */
function sameUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|igsh|si$)/i.test(k)) url.searchParams.delete(k);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase();
  } catch {
    return raw;
  }
}

/** Tags are lowercase words; `/` groups them (type/grotesk). */
export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}/_-]/gu, '').replace(/\/{2,}/g, '/').slice(0, 48);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 40) break;
  }
  return out;
}

function cleanFileName(raw: string, ext: string, fallback: string): string {
  let stem = raw
    .replace(/\.[^.]*$/, '')
    .replace(/[\\/:*?"<>|#\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  if (!stem || RESERVED.test(stem) || stem.toLowerCase() === 'item' || stem.startsWith('.')) stem = fallback;
  return `${stem}.${ext}`;
}

/** "swiss_poster-1962" → "swiss poster 1962" */
const titleFromName = (name: string) => name.replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Bigger images on Pinterest and X: ask for the original, fall back to what was shown. */
function mediaCandidates(raw: string): string[] {
  try {
    const url = new URL(raw);
    if (url.hostname === 'i.pinimg.com') {
      const up = raw.replace(/\/\d+x\d*\//, '/originals/');
      return up !== raw ? [up, raw] : [raw];
    }
    if (url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/')) {
      url.searchParams.set('name', 'orig');
      return url.href !== raw ? [url.href, raw] : [raw];
    }
  } catch {
    // Not a URL we improve.
  }
  return [raw];
}

/* ------------------------------------------------------------------ */
/* the sidecar                                                          */
/* ------------------------------------------------------------------ */

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function splitDoc(text: string): { yaml: string; body: string } {
  const m = FRONTMATTER.exec(text);
  return m ? { yaml: m[1], body: text.slice(m[0].length) } : { yaml: '', body: text };
}

/** Frontmatter keys in the order they are written. */
const KEY_ORDER = ['id', 'kind', 'title', 'why', 'tags', 'file', 'source', 'media_url', 'site', 'description', 'icon', 'image', 'via', 'width', 'height', 'bytes', 'capture', 'created'];

function compose(meta: Record<string, unknown>, notes: string): string {
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) if (meta[k] !== undefined && meta[k] !== null) ordered[k] = meta[k];
  for (const [k, v] of Object.entries(meta)) if (!(k in ordered) && v !== undefined && v !== null) ordered[k] = v;
  const doc = new YAML.Document(ordered);
  const tags = doc.get('tags', true);
  if (YAML.isSeq(tags)) tags.flow = true;
  const body = notes.trim();
  return `---\n${doc.toString({ lineWidth: 0 })}---\n${body ? `\n${body}\n` : ''}`;
}

/* ------------------------------------------------------------------ */

export function registerStoreroom({ root: rootRaw, isHost, broadcast, openWindow }: Options): StoreroomService {
  const root = path.resolve(rootRaw);
  const itemsDir = path.join(root, 'items');
  const trashDir = path.join(root, '.trash');
  const thumbsDir = path.join(root, '.cache', 'thumbs');

  function ensureRoot() {
    fs.mkdirSync(itemsDir, { recursive: true });
    const readme = path.join(root, 'README.md');
    if (!fs.existsSync(readme)) {
      try {
        fs.writeFileSync(
          readme,
          [
            '# Storeroom',
            '',
            'Axonix\'s inspiration library. Every reference is a folder in `items/`, named by its',
            'stable id (`R0042`), holding the media and an `item.md` sidecar: YAML frontmatter',
            '(`kind`, `title`, `why`, `tags`, `source`…) and free notes. Edit them anywhere.',
            '',
            '- `.trash/` holds deleted items; nothing is erased.',
            '- `.cache/` holds thumbnails and can be deleted at any time.',
            '',
          ].join('\n'),
        );
      } catch {
        // A read-only root still lists and serves.
      }
    }
  }

  function writeAtomic(full: string, data: string | Uint8Array) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.axonix-tmp`);
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, full);
  }

  const dirOf = (id: unknown): string => {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('invalid item id');
    return path.join(itemsDir, id);
  };

  /** A file inside one item's folder, never outside it. */
  function fileOf(id: unknown, name: unknown): string {
    const dir = dirOf(id);
    if (typeof name !== 'string' || !name || name.length > 200 || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || name.startsWith('.') || RESERVED.test(name.replace(/\.[^.]*$/, ''))) {
      throw new Error('invalid file name');
    }
    const full = path.join(dir, name);
    if (path.dirname(full) !== dir) throw new Error('path escapes the item');
    return full;
  }

  /* ---------- ids ---------- */

  let nextN = 0;
  function scanMax(): number {
    let max = 0;
    for (const dir of [itemsDir, trashDir]) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        const m = /(?:^| )R(\d{4,7})$/.exec(n);
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return max;
  }

  /** A fresh folder with the next unused id. mkdir is the lock: it fails if the id is taken. */
  function allocate(): { id: string; dir: string } {
    ensureRoot();
    if (!nextN) nextN = scanMax() + 1;
    for (let tries = 0; tries < 10_000; tries++) {
      const id = `R${String(nextN).padStart(4, '0')}`;
      nextN++;
      const dir = path.join(itemsDir, id);
      try {
        fs.mkdirSync(dir);
        return { id, dir };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    throw new Error('could not find a free item id');
  }

  /* ---------- reading ---------- */

  function readItem(id: string): StoreItem | null {
    const dir = path.join(itemsDir, id);
    const md = path.join(dir, 'item.md');
    let text: string;
    let stat: fs.Stats;
    try {
      text = fs.readFileSync(md, 'utf8');
      stat = fs.statSync(md);
    } catch {
      return null;
    }
    const { yaml, body } = splitDoc(text);
    let meta: Record<string, unknown> = {};
    try {
      const parsed = YAML.parse(yaml);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
    } catch {
      // Frontmatter someone broke by hand: the item still lists, as a note with its text.
    }
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((n) => n !== 'item.md' && !n.startsWith('.'));
    } catch {
      // Listed a moment ago; gone now.
    }
    const file = typeof meta.file === 'string' && files.includes(meta.file) ? meta.file : undefined;
    const declared = typeof meta.kind === 'string' ? (meta.kind as Kind) : undefined;
    const kind: Kind =
      declared === 'link' || declared === 'note'
        ? declared
        : file
          ? (kindOfExt(extOf(file)) ?? 'note')
          : declared && ['image', 'svg', 'video'].includes(declared)
            ? declared
            : 'note';
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
    const created = str(meta.created, 40) || (meta.created instanceof Date ? localIso(meta.created) : '') || localIso(stat.birthtime);
    return {
      id,
      kind,
      title: str(meta.title, 300) || (file ? titleFromName(file) : body.trim().split(/\r?\n/)[0]?.slice(0, 80) || id),
      file,
      source: webUrl(meta.source) ?? undefined,
      mediaUrl: webUrl(meta.media_url) ?? undefined,
      via: str(meta.via, 40) || undefined,
      tags: cleanTags(meta.tags),
      why: str(meta.why, 600),
      notes: body.trim(),
      width: num(meta.width),
      height: num(meta.height),
      bytes: num(meta.bytes),
      site: str(meta.site, 120) || undefined,
      description: str(meta.description, 1200) || undefined,
      icon: webUrl(meta.icon) ?? undefined,
      capture: meta.capture === 'pending' || meta.capture === 'failed' ? meta.capture : undefined,
      created,
      mtime: stat.mtimeMs,
      files,
    };
  }

  function listItems(): StoreItem[] {
    ensureRoot();
    let names: string[] = [];
    try {
      names = fs.readdirSync(itemsDir);
    } catch {
      return [];
    }
    const out: StoreItem[] = [];
    for (const name of names) {
      if (!ID.test(name)) continue;
      const item = readItem(name);
      if (item) out.push(item);
    }
    return out.sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0) || b.id.localeCompare(a.id));
  }

  function mustRead(id: string): StoreItem {
    const item = readItem(id);
    if (!item) throw new Error(`${id} is not in the Storeroom`);
    return item;
  }

  /** Change some frontmatter keys (and the notes) of one item, keeping everything else as written. */
  function patchItem(id: string, patch: Record<string, unknown>, notes?: string): StoreItem {
    const md = path.join(dirOf(id), 'item.md');
    const text = fs.readFileSync(md, 'utf8');
    const { yaml, body } = splitDoc(text);
    const doc = YAML.parseDocument(yaml || '{}');
    if (doc.errors.length) throw new Error(`${id}/item.md has frontmatter Axonix cannot read; fix it by hand first`);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || (typeof v === 'string' && v === '' && k !== 'why')) doc.delete(k);
      // Tags stay on one line, as `[a, b]`, however they were written before.
      else if (k === 'tags') doc.set(k, doc.createNode(v, { flow: true }));
      else doc.set(k, v);
    }
    const nextBody = notes === undefined ? body : notes.trim() ? `\n${notes.trim()}\n` : '';
    writeAtomic(md, `---\n${doc.toString({ lineWidth: 0 })}---\n${nextBody}`);
    return mustRead(id);
  }

  /* ---------- creating ---------- */

  function measure(kind: Kind, data: Uint8Array): { width?: number; height?: number } {
    if (kind !== 'image' && kind !== 'svg') return {};
    try {
      const r = imageSize(data);
      if (!r.width || !r.height) return {};
      const turned = typeof r.orientation === 'number' && r.orientation >= 5;
      return { width: turned ? r.height : r.width, height: turned ? r.width : r.height };
    } catch {
      return {};
    }
  }

  function writeNew(dir: string, meta: Record<string, unknown>, notes = '') {
    writeAtomic(path.join(dir, 'item.md'), compose({ tags: [], why: '', ...meta, created: localIso() }, notes));
  }

  /** Drop a half-made item's folder (only ever one this process just created). */
  function abandon(dir: string) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Left behind empty or partial; it lists as nothing.
    }
  }

  function addMedia(name: string, data: Uint8Array, meta: { via: string; title?: string; source?: string; mediaUrl?: string; site?: string }): StoreItem {
    const ext = extOf(name);
    const kind = kindOfExt(ext);
    if (!kind) throw new Error(`${name}: only images, SVG and video go in the Storeroom`);
    if (!data.length) throw new Error(`${name} is empty`);
    if (data.length > MAX_MEDIA_BYTES) throw new Error(`${name} is larger than 400 MB`);
    if (kind === 'svg' && !SVG_TEXT.test(Buffer.from(data.subarray(0, 4096)).toString('utf8'))) throw new Error(`${name} is not an SVG`);
    const { id, dir } = allocate();
    try {
      const file = cleanFileName(name, ext === 'jpeg' ? 'jpg' : ext, kind === 'video' ? 'clip' : kind === 'svg' ? 'vector' : 'image');
      writeAtomic(path.join(dir, file), data);
      writeNew(dir, {
        id,
        kind,
        title: meta.title?.trim().slice(0, 300) || titleFromName(name) || id,
        file,
        source: meta.source,
        media_url: meta.mediaUrl,
        site: meta.site,
        via: meta.via,
        ...measure(kind, data),
        bytes: data.length,
      });
    } catch (e) {
      abandon(dir);
      throw e;
    }
    return mustRead(id);
  }

  function addText(text: string, meta: { via: string; title?: string; source?: string }): StoreItem {
    if (!text.trim()) throw new Error('Nothing to save');
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error('That text is larger than 5 MB');
    if (SVG_TEXT.test(text)) {
      const title = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(text)?.[1]?.trim();
      return addMedia('vector.svg', new Uint8Array(Buffer.from(text, 'utf8')), { ...meta, title: title || meta.title || 'Pasted SVG' });
    }
    const { id, dir } = allocate();
    try {
      const first = text.trim().split(/\r?\n/)[0].replace(/^#+\s*/, '').slice(0, 80);
      writeNew(dir, { id, kind: 'note', title: meta.title || first || 'Note', source: meta.source, via: meta.via }, text);
    } catch (e) {
      abandon(dir);
      throw e;
    }
    return mustRead(id);
  }

  /** Items already holding this address, as a link or as a saved image's page or media. */
  function findByUrl(url: string, kinds?: Kind[]): StoreItem | undefined {
    const key = sameUrl(url);
    return listItems().find((i) => (!kinds || kinds.includes(i.kind)) && [i.source, i.mediaUrl].some((u) => u && sameUrl(u) === key));
  }

  /* ---------- fetching ---------- */

  async function fetchMedia(ses: Session | null, url: string, referrer?: string): Promise<{ data: Uint8Array; ext: string; name: string }> {
    const get = (init: RequestInit) => (ses ? ses.fetch(url, init) : net.fetch(url, init));
    let res: Response;
    try {
      res = await get({ referrer, signal: AbortSignal.timeout(60_000) });
    } catch {
      res = await get({ signal: AbortSignal.timeout(60_000) });
    }
    if (!res.ok) throw new Error(`The site answered ${res.status}`);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_MEDIA_BYTES) throw new Error('That file is larger than 400 MB');
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.length > MAX_MEDIA_BYTES) throw new Error('That file is larger than 400 MB');
    let base = '';
    try {
      base = decodeURIComponent(new URL(res.url || url).pathname.split('/').pop() ?? '');
    } catch {
      base = '';
    }
    const ext = EXT_OF_TYPE[type] ?? (kindOfExt(extOf(base)) ? extOf(base) : '');
    if (!ext) throw new Error('That address is not an image or a video');
    return { data, ext, name: base || `image.${ext}` };
  }

  async function downloadMedia(ses: Session | null, url: string, from: Origin & { site?: string }): Promise<StoreItem> {
    let lastError: unknown = null;
    for (const candidate of mediaCandidates(url)) {
      try {
        const got = await fetchMedia(ses, candidate, from.page);
        const name = kindOfExt(extOf(got.name)) ? got.name : `${got.name.replace(/\.[^.]*$/, '') || 'image'}.${got.ext}`;
        return addMedia(name, got.data, { via: from.via, title: from.title, source: from.page ?? url, mediaUrl: from.page ? candidate : undefined, site: from.site });
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Could not download that');
  }

  /* ---------- capturing links ---------- */

  let crawlSession: Session | null = null;
  function crawler(): Session {
    if (crawlSession) return crawlSession;
    // In memory only (no `persist:`): nothing a captured page sets survives.
    const ses = session.fromPartition('storeroom-capture');
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());
    blockTrackers(ses);
    crawlSession = ses;
    return ses;
  }

  const EXTRACT = `(() => {
    const meta = (names) => {
      for (const n of names) {
        const el = document.querySelector('meta[property="' + n + '"], meta[name="' + n + '"]');
        const c = el && el.getAttribute('content');
        if (c && c.trim()) return c.trim();
      }
      return '';
    };
    const abs = (u) => { try { return u ? new URL(u, location.href).href : ''; } catch { return ''; } };
    const icons = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => abs(l.getAttribute('href')));
    return {
      url: location.href,
      title: meta(['og:title', 'twitter:title']) || document.title || '',
      description: meta(['og:description', 'twitter:description', 'description']),
      image: abs(meta(['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'])),
      site: meta(['og:site_name', 'application-name']) || location.hostname.replace(/^www\\./, ''),
      icon: icons.find(Boolean) || abs('/favicon.ico'),
    };
  })()`;

  const timeout = <T>(p: Promise<T>, ms: number, what: string) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} took too long`)), ms))]);

  async function crawl(id: string, url: string, placeholder: string) {
    const win = new BrowserWindow({
      show: false,
      width: CRAWL_VIEWPORT.width,
      height: CRAWL_VIEWPORT.height,
      webPreferences: {
        session: crawler(),
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    const contents = win.webContents;
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.setFrameRate(10);
    let frame: NativeImage | null = null;
    contents.on('paint', (_e, _dirty, image) => {
      frame = image;
    });
    try {
      await timeout(contents.loadURL(url), CRAWL_TIMEOUT_MS, 'Loading the page').catch((e) => {
        // A page that keeps loading forever, or that replaced itself with a
        // script redirect (ERR_ABORTED), still has something to show.
        if (!/too long|ERR_ABORTED/.test(String(e))) throw e;
      });
      // A reference picture without the page's scrollbar down its edge.
      await contents.insertCSS('::-webkit-scrollbar { display: none !important; } html, body { scrollbar-width: none !important; }').catch(() => '');
      await new Promise((r) => setTimeout(r, CRAWL_SETTLE_MS));
      const raw = (await timeout(contents.executeJavaScript(EXTRACT, true), 4000, 'Reading the page').catch(() => ({}))) as Record<string, unknown>;
      let shot = await contents.capturePage().catch(() => null);
      if (!shot || shot.isEmpty()) shot = frame;
      const patch: Record<string, unknown> = { capture: null };
      const title = str(raw.title, 300);
      const current = readItem(id);
      if (!current) return;
      if (title && current.title === placeholder) patch.title = title;
      if (str(raw.description, 1200)) patch.description = str(raw.description, 1200);
      if (str(raw.site, 120)) patch.site = str(raw.site, 120);
      const icon = webUrl(raw.icon);
      if (icon) patch.icon = icon;
      const image = webUrl(raw.image);
      if (shot && !shot.isEmpty()) {
        const jpeg = shot.toJPEG(80);
        writeAtomic(path.join(dirOf(id), 'screenshot.jpg'), jpeg);
        const size = shot.getSize();
        Object.assign(patch, { file: 'screenshot.jpg', width: size.width, height: size.height, bytes: jpeg.length });
      } else if (image) {
        // No picture of the page (a wall, a blank app shell): its share image instead.
        const got = await fetchMedia(crawler(), image).catch(() => null);
        if (got && (got.ext === 'jpg' || got.ext === 'png' || got.ext === 'webp')) {
          const file = `cover.${got.ext}`;
          writeAtomic(path.join(dirOf(id), file), got.data);
          Object.assign(patch, { file, bytes: got.data.length, ...measure('image', got.data) });
        }
      }
      // The page's share image, as an address only: for agents and for a later re-capture.
      if (image) patch.image = image;
      patchItem(id, patch);
    } catch {
      try {
        patchItem(id, { capture: 'failed' });
      } catch {
        // The item went to the trash while it was being captured.
      }
    } finally {
      if (!win.isDestroyed()) win.destroy();
      void crawler().clearStorageData().catch(() => {});
    }
  }

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (id: string, url: string, placeholder: string) => {
    queue = queue.then(() => crawl(id, url, placeholder)).catch(() => {});
  };

  /** A link becomes an item at once; its picture and details arrive when the capture finishes. */
  async function addUrl(url: string, via: string, title?: string): Promise<{ item: StoreItem; duplicate: boolean }> {
    const existing = findByUrl(url, ['link']);
    if (existing) return { item: existing, duplicate: true };
    // An address that is itself an image or a video is saved as that file.
    if (kindOfExt(extOf(new URL(url).pathname))) {
      return { item: await downloadMedia(null, url, { via, title }), duplicate: false };
    }
    try {
      const head = await net.fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      const type = (head.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (EXT_OF_TYPE[type]) return { item: await downloadMedia(null, url, { via, title }), duplicate: false };
    } catch {
      // Sites that refuse HEAD are pages often enough; capture it as one.
    }
    const host = new URL(url).hostname.replace(/^www\./, '');
    const placeholder = title?.trim().slice(0, 300) || host;
    const { id, dir } = allocate();
    try {
      writeNew(dir, { id, kind: 'link', title: placeholder, source: url, site: host, via, capture: 'pending' });
    } catch (e) {
      abandon(dir);
      throw e;
    }
    enqueue(id, url, placeholder);
    return { item: mustRead(id), duplicate: false };
  }

  /* ---------- trash ---------- */

  function trashItem(id: string): string {
    const src = dirOf(id);
    if (!fs.existsSync(src)) throw new Error(`${id} is not in the Storeroom`);
    fs.mkdirSync(trashDir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')} ${id}`;
    fs.renameSync(src, path.join(trashDir, name));
    return name;
  }

  function restoreItem(name: unknown): StoreItem {
    if (typeof name !== 'string' || !/^[\dTZ-]+ R\d{4,7}$/.test(name)) throw new Error('not a trashed item');
    const id = name.slice(name.lastIndexOf(' ') + 1);
    const src = path.join(trashDir, name);
    const dest = dirOf(id);
    if (!fs.existsSync(src)) throw new Error('That item is no longer in the trash.');
    if (fs.existsSync(dest)) throw new Error(`conflict: ${id} already exists`);
    fs.renameSync(src, dest);
    return mustRead(id);
  }

  /* ---------- media, read-only ---------- */

  function serve(full: string, request: Request): Response {
    const stat = fs.statSync(full);
    const ext = extOf(full);
    const headers: Record<string, string> = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    };
    // An SVG opened on its own runs nothing.
    if (ext === 'svg') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    // Ranges, so a video can seek.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${stat.size}` } });
      headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['content-length'] = String(end - start + 1);
      return new Response(Readable.toWeb(fs.createReadStream(full, { start, end })) as unknown as BodyInit, { status: 206, headers });
    }
    headers['content-length'] = String(stat.size);
    return new Response(Readable.toWeb(fs.createReadStream(full)) as unknown as BodyInit, { status: 200, headers });
  }

  /** A smaller copy for the grid, made once and kept in `.cache/` (PNG and JPEG; other formats show as they are). */
  function thumbnail(item: StoreItem): string | null {
    if (!item.file) return null;
    const ext = extOf(item.file);
    if (ext !== 'png' && ext !== 'jpg' && ext !== 'jpeg') return null;
    const src = path.join(itemsDir, item.id, item.file);
    const stat = fs.statSync(src);
    if (stat.size < 400 * 1024 && (item.width ?? 0) <= THUMB_WIDTH * 1.5) return null;
    const dest = path.join(thumbsDir, `${item.id}.${ext === 'png' ? 'png' : 'jpg'}`);
    try {
      if (fs.statSync(dest).mtimeMs >= stat.mtimeMs) return dest;
    } catch {
      // Not made yet.
    }
    const image = nativeImage.createFromPath(src);
    if (image.isEmpty()) return null;
    const small = image.getSize().width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image;
    writeAtomic(dest, ext === 'png' ? small.toPNG() : small.toJPEG(82));
    return dest;
  }

  protocol.handle('storeroom', async (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (url.hostname === 'thumb' && parts.length === 1) {
        const item = mustRead(parts[0]);
        const thumb = thumbnail(item);
        if (thumb) return serve(thumb, request);
        if (item.file) return serve(fileOf(item.id, item.file), request);
      }
      if (url.hostname === 'file' && parts.length === 2) return serve(fileOf(parts[0], parts[1]), request);
      return new Response('not found', { status: 404 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  /* ---------- watching ---------- */

  let watcher: fs.FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  function watch() {
    if (watcher) return;
    try {
      watcher = fs.watch(itemsDir, { recursive: true }, (_event, name) => {
        if (name && String(name).endsWith('.axonix-tmp')) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => broadcast('storeroom:changed', null), 250);
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  }

  /* ---------- handlers ---------- */

  const guard = (event: IpcMainInvokeEvent) => {
    if (!isHost(event.sender)) throw new Error('not allowed');
  };
  const viaOf = (v: unknown) => (typeof v === 'string' && /^[a-z][a-z:-]{0,39}$/.test(v) ? v : 'add');
  const settle = async (name: string, run: () => Promise<{ item: StoreItem; duplicate?: boolean }> | { item: StoreItem; duplicate?: boolean }): Promise<AddResult> => {
    try {
      const { item, duplicate } = await run();
      return { ok: true, item, duplicate: duplicate ?? false, name };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), name };
    }
  };

  ipcMain.handle('storeroom:list', (event) => {
    guard(event);
    const items = listItems();
    watch();
    let trashed = 0;
    try {
      trashed = fs.readdirSync(trashDir).length;
    } catch {
      trashed = 0;
    }
    return { root, items, trashed };
  });

  ipcMain.handle('storeroom:add-files', async (event, paths: unknown, via: unknown) => {
    guard(event);
    if (!Array.isArray(paths) || paths.length > 200) throw new Error('invalid files');
    const out: AddResult[] = [];
    for (const p of paths) {
      const name = typeof p === 'string' ? path.basename(p) : '?';
      out.push(
        await settle(name, () => {
          if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('invalid file');
          const stat = fs.statSync(p);
          if (!stat.isFile()) throw new Error(`${name} is a folder`);
          if (stat.size > MAX_MEDIA_BYTES) throw new Error(`${name} is larger than 400 MB`);
          if (!kindOfExt(extOf(name))) throw new Error(`${name}: only images, SVG and video go in the Storeroom`);
          return { item: addMedia(name, new Uint8Array(fs.readFileSync(p)), { via: viaOf(via) }) };
        }),
      );
    }
    return out;
  });

  ipcMain.handle('storeroom:add-bytes', async (event, name: unknown, data: unknown, via: unknown) => {
    guard(event);
    const n = typeof name === 'string' && name.length <= 200 ? name : 'Pasted image.png';
    return settle(n, () => {
      if (!(data instanceof Uint8Array)) throw new Error('invalid data');
      return { item: addMedia(n, data, { via: viaOf(via) }) };
    });
  });

  ipcMain.handle('storeroom:add-text', async (event, text: unknown, via: unknown) => {
    guard(event);
    return settle('text', () => {
      if (typeof text !== 'string') throw new Error('invalid text');
      return { item: addText(text, { via: viaOf(via) }) };
    });
  });

  ipcMain.handle('storeroom:add-url', async (event, raw: unknown, via: unknown) => {
    guard(event);
    const url = webUrl(raw);
    return settle(typeof raw === 'string' ? raw : 'link', () => {
      if (!url) throw new Error('That is not a web address');
      return addUrl(url, viaOf(via));
    });
  });

  ipcMain.handle('storeroom:update', (event, id: unknown, patch: unknown) => {
    guard(event);
    dirOf(id);
    const p = (patch ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    if (typeof p.title === 'string') next.title = p.title.trim().slice(0, 300) || undefined;
    if (typeof p.why === 'string') next.why = p.why.trim().slice(0, 600);
    if (Array.isArray(p.tags)) next.tags = cleanTags(p.tags);
    for (const k of ['width', 'height'] as const) if (typeof p[k] === 'number' && Number.isFinite(p[k]) && (p[k] as number) > 0) next[k] = Math.round(p[k] as number);
    const notes = typeof p.notes === 'string' ? p.notes.slice(0, 1_000_000) : undefined;
    return patchItem(id as string, next, notes);
  });

  ipcMain.handle('storeroom:trash', (event, id: unknown) => {
    guard(event);
    dirOf(id);
    return trashItem(id as string);
  });

  ipcMain.handle('storeroom:restore', (event, name: unknown) => {
    guard(event);
    return restoreItem(name);
  });

  ipcMain.handle('storeroom:recapture', (event, id: unknown) => {
    guard(event);
    dirOf(id);
    const item = mustRead(id as string);
    if (item.kind !== 'link' || !item.source) throw new Error('Only links are captured');
    patchItem(item.id, { capture: 'pending' });
    enqueue(item.id, item.source, item.title);
    return mustRead(item.id);
  });

  /** The page's own copy of an image (any format Chromium draws), as PNG. */
  ipcMain.handle('storeroom:copy-image', async (event, pngDataUrl: unknown) => {
    guard(event);
    if (typeof pngDataUrl !== 'string' || !pngDataUrl.startsWith('data:image/png;base64,')) return false;
    const image = nativeImage.createFromDataURL(pngDataUrl);
    if (image.isEmpty()) return false;
    const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  });

  /** One item's file in Explorer, or (no id) the whole library. */
  ipcMain.on('storeroom:show-in-folder', (event, id: unknown) => {
    if (!isHost(event.sender)) return;
    try {
      if (id === null || id === undefined) {
        ensureRoot();
        void shell.openPath(itemsDir);
        return;
      }
      dirOf(id);
      const item = readItem(id as string);
      if (item) shell.showItemInFolder(path.join(itemsDir, item.id, item.file ?? 'item.md'));
    } catch {
      // Not an item: nothing to show.
    }
  });

  ipcMain.on('storeroom:open-url', (event, raw: unknown) => {
    if (!isHost(event.sender)) return;
    const url = webUrl(raw);
    if (url) void shell.openExternal(url);
  });

  /** Drag an item out of Axonix — into Paper, Figma, Explorer — as its real file. */
  ipcMain.on('storeroom:start-drag', (event, id: unknown) => {
    if (!isHost(event.sender)) return;
    try {
      dirOf(id);
      const item = readItem(id as string);
      if (!item?.file) return;
      const file = path.join(itemsDir, item.id, item.file);
      const thumb = thumbnail(item);
      let icon = nativeImage.createFromPath(thumb ?? file);
      if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
      else icon = icon.resize({ width: 96 });
      event.sender.startDrag({ file, icon });
    } catch {
      // Nothing to drag.
    }
  });

  ipcMain.on('storeroom:open-window', (event) => {
    if (isHost(event.sender)) openWindow();
  });

  /* ---------- for the rest of the main process (Social's context menu) ---------- */

  const announce = (item: StoreItem, duplicate = false) => broadcast('storeroom:saved', { id: item.id, title: item.title, kind: item.kind, duplicate });

  const service: StoreroomService = {
    root,
    async saveRemoteMedia(ses, url, from) {
      const existing = mediaCandidates(url)
        .map((u) => findByUrl(u, ['image', 'video', 'svg']))
        .find(Boolean);
      if (existing) {
        announce(existing, true);
        return existing;
      }
      const item = await downloadMedia(ses, url, from);
      announce(item);
      return item;
    },
    async saveLink(url, via) {
      const clean = webUrl(url);
      if (!clean) throw new Error('That is not a web address');
      const { item, duplicate } = await addUrl(clean, via);
      announce(item, duplicate);
      return item;
    },
    saveScreenshot(image, from) {
      const jpeg = image.toJPEG(82);
      const name = `${(from.title ?? '').slice(0, 60) || 'screenshot'}.jpg`;
      const item = addMedia(name, new Uint8Array(jpeg), { via: from.via, title: from.title, source: from.page });
      announce(item);
      return item;
    },
    saveText(text, from) {
      // A selection is titled by its own first line; the page it came from is its source.
      const item = addText(text, { via: from.via, source: from.page });
      announce(item);
      return item;
    },
  };

  /**
   * A picture or link dragged out of a social page beside the Storeroom (the
   * guest preload reported it). Saved through that app's own session, so
   * signed-in media downloads and Pinterest/X hand over their full size.
   */
  ipcMain.handle('storeroom:save-social', async (event, appId: unknown, drag: unknown) => {
    guard(event);
    const app = appById(typeof appId === 'string' ? appId : null);
    const d = (drag ?? {}) as Record<string, unknown>;
    const src = webUrl(d.src);
    const link = webUrl(d.link);
    const alt = str(d.alt, 300);
    // Alt text is a good title when it describes something (Pinterest's does); "Image" is not.
    const title = (alt.length >= 8 && !/^(image|photo|picture|img)\b/i.test(alt) ? alt : '') || str(d.title, 300) || undefined;
    const page = webUrl(d.page) ?? undefined;
    return settle(src ?? link ?? 'drag', async () => {
      if (!app) throw new Error('Not a social app');
      const via = `social:${app.id}`;
      if (src) return { item: await service.saveRemoteMedia(session.fromPartition(partitionOf(app.id)), src, { page, title, via }) };
      if (link) return { item: await service.saveLink(link, via) };
      throw new Error('Nothing to keep in that drag');
    });
  });

  return service;
}
