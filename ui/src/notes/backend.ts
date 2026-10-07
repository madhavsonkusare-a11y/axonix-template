/**
 * Where notes live.
 *
 * In the desktop app: the whole vault, through `electron/vault.ts` (exposed by
 * the preload as `window.axonixVault`) — the same contract as Tasks: every
 * write names the text it replaces, "delete" moves into the vault's `.trash/`,
 * and dot-folders and Obsidian's excluded paths are out of bounds.
 *
 * In a plain browser (the Vite dev server): a small vault in localStorage, so
 * the editor can be tried without touching the real one.
 */

export interface NoteFile {
  path: string;
  mtime: number;
  size: number;
}

export interface VaultTree {
  root: string;
  vaultName: string;
  folders: string[];
  files: NoteFile[];
  images: string[];
}

export interface RawNote {
  path: string;
  text: string;
  mtime: number;
}

export interface TrashedNote extends RawNote { originalPath: string; deletedAt: number }

export interface VaultBridge {
  saveDocument(path: string, text: string, blocks: string | null, expected: string, expectedBlocks: string | null): Promise<RawNote>;
  listTrash(): Promise<TrashedNote[]>;
  tree(): Promise<VaultTree>;
  read(path: string): Promise<RawNote>;
  write(path: string, text: string, expected: string | null): Promise<RawNote>;
  readBlocks(path: string): Promise<{ text: string; mtime: number } | null>;
  writeBlocks(path: string, text: string, expected: string | null): Promise<{ text: string; mtime: number }>;
  renameBlocks(from: string, to: string): Promise<boolean>;
  trashBlocks(path: string): Promise<boolean>;
  rename(from: string, to: string, expected: string): Promise<RawNote>;
  trash(path: string, expected: string): Promise<string>;
  restore(trashPath: string, to: string): Promise<RawNote>;
  /** Saves an image beside the note (in `attachments/`); resolves to its vault path. */
  attach(note: string, name: string, base64: string): Promise<string>;
  backlinks(path: string): Promise<{ path: string; line: string }[]>;
  onChanged(cb: (paths: string[]) => void): () => void;
  openInObsidian(path: string): void;
  showInFolder(path: string): void;
  /** http(s) and mailto links, in the default browser or mail app. */
  openUrl(url: string): void;
}

export const isConflict = (e: unknown) => /conflict/i.test(e instanceof Error ? e.message : String(e));
export const messageOf = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/* ------------------------------------------------------------------ */
/* the browser stand-in                                                */
/* ------------------------------------------------------------------ */

const KEY = 'axonix:vault:fs';

interface VirtualVault {
  files: Record<string, { text: string; mtime: number }>;
  images: Record<string, string>;
  trash: Record<string, { text: string; mtime: number }>;
  blocks?: Record<string, { text: string; mtime: number }>;
  trashBlocks?: Record<string, { text: string; mtime: number }>;
  trashOrigins?: Record<string, string>;
}

function load(): VirtualVault {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { files: {}, images: {}, trash: {}, ...(JSON.parse(raw) as Partial<VirtualVault>) };
  } catch {
    // Unreadable: start empty.
  }
  return { files: {}, images: {}, trash: {} };
}

const listeners = new Set<(paths: string[]) => void>();
function commit(v: VirtualVault, paths: string[]) {
  localStorage.setItem(KEY, JSON.stringify(v));
  queueMicrotask(() => listeners.forEach((l) => l(paths)));
}
const conflict = (p: string) => new Error(`conflict: ${p} changed since it was read`);
const find = (files: Record<string, unknown>, p: string) => Object.keys(files).find((k) => k.toLowerCase() === p.toLowerCase());

const browser: VaultBridge = {
  async saveDocument(path, text, blocks, expected, expectedBlocks) {
    const v = load();
    if (v.files[path]?.text !== expected || (v.blocks?.[path]?.text ?? null) !== expectedBlocks) throw conflict(path);
    v.files[path] = { text, mtime: Date.now() };
    if (blocks !== null) { v.blocks ??= {}; v.blocks[path] = { text: blocks, mtime: Date.now() }; }
    commit(v, [path]);
    return { path, ...v.files[path] };
  },
  async listTrash() {
    const v = load();
    return Object.entries(v.trash).filter(([p]) => v.trashOrigins?.[p]?.startsWith('Notes/')).map(([path, f]) => ({ path, ...f, originalPath: v.trashOrigins![path], deletedAt: f.mtime }));
  },
  async tree() {
    const v = load();
    const folders = new Set<string>();
    for (const p of [...Object.keys(v.files), ...Object.keys(v.images)]) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    }
    return {
      root: 'this browser (dev mode)',
      vaultName: 'Dev vault',
      folders: [...folders],
      files: Object.entries(v.files).map(([path, f]) => ({ path, mtime: f.mtime, size: f.text.length })),
      images: Object.keys(v.images),
    };
  },
  async read(path) {
    const v = load();
    const k = find(v.files, path);
    if (!k) throw new Error(`${path} does not exist`);
    return { path: k, ...v.files[k] };
  },
  async write(path, text, expected) {
    const v = load();
    const k = find(v.files, path);
    if (expected === null ? k !== undefined : k === undefined || v.files[k].text !== expected) throw conflict(path);
    v.files[k ?? path] = { text, mtime: Date.now() };
    commit(v, [k ?? path]);
    return { path: k ?? path, ...v.files[k ?? path] };
  },
  async readBlocks(path) {
    return load().blocks?.[path] ?? null;
  },
  async writeBlocks(path, text, expected) {
    const v = load();
    v.blocks ??= {};
    const current = v.blocks[path]?.text ?? null;
    if (current !== expected) throw conflict(path);
    const result = { text, mtime: Date.now() };
    v.blocks[path] = result;
    commit(v, [path]);
    return result;
  },
  async renameBlocks(from, to) {
    const v = load();
    if (!v.blocks?.[from]) return false;
    if (v.blocks[to]) throw conflict(to);
    v.blocks[to] = v.blocks[from];
    delete v.blocks[from];
    commit(v, [from, to]);
    return true;
  },
  async trashBlocks(path) {
    const v = load();
    if (!v.blocks?.[path]) return false;
    delete v.blocks[path];
    commit(v, [path]);
    return true;
  },
  async rename(from, to, expected) {
    const v = load();
    const k = find(v.files, from);
    if (!k || v.files[k].text !== expected) throw conflict(from);
    const t = find(v.files, to);
    if (t && t !== k) throw new Error(`conflict: ${to} already exists`);
    const f = v.files[k];
    delete v.files[k];
    v.files[to] = { text: f.text, mtime: Date.now() };
    commit(v, [k, to]);
    return { path: to, ...v.files[to] };
  },
  async trash(path, expected) {
    const v = load();
    const k = find(v.files, path);
    if (!k || v.files[k].text !== expected) throw conflict(path);
    const where = `.trash/${Date.now()} ${k.replace(/\//g, ' - ')}`;
    v.trash[where] = v.files[k];
    v.trashOrigins ??= {}; v.trashOrigins[where] = k;
    if (v.blocks?.[k]) { v.trashBlocks ??= {}; v.trashBlocks[where] = v.blocks[k]; delete v.blocks[k]; }
    delete v.files[k];
    commit(v, [k]);
    return where;
  },
  async restore(trashPath, to) {
    const v = load();
    const f = v.trash[trashPath];
    if (!f) throw new Error('That note is no longer in the trash.');
    if (find(v.files, to) || (v.trashBlocks?.[trashPath] && v.blocks?.[to])) throw new Error(`conflict: ${to} already exists`);
    delete v.trash[trashPath];
    v.files[to] = { text: f.text, mtime: Date.now() };
    if (v.trashBlocks?.[trashPath]) { v.blocks ??= {}; v.blocks[to] = v.trashBlocks[trashPath]; delete v.trashBlocks[trashPath]; }
    delete v.trashOrigins?.[trashPath];
    commit(v, [to]);
    return { path: to, ...v.files[to] };
  },
  async attach(note, name, base64) {
    const v = load();
    const dir = note.includes('/') ? `${note.slice(0, note.lastIndexOf('/'))}/attachments` : 'attachments';
    const dot = name.lastIndexOf('.');
    let path = `${dir}/${name}`;
    for (let n = 2; v.images[path]; n++) path = `${dir}/${name.slice(0, dot)} ${n}${name.slice(dot)}`;
    const ext = name.slice(dot + 1).toLowerCase();
    v.images[path] = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`;
    commit(v, [path]);
    return path;
  },
  async backlinks(path) {
    const v = load();
    const name = path.replace(/\.md$/i, '').split('/').pop()!.toLowerCase();
    return Object.entries(v.files)
      .filter(([p, f]) => p !== path && f.text.toLowerCase().includes(`[[${name}`))
      .map(([p, f]) => ({ path: p, line: f.text.split('\n').find((l) => l.toLowerCase().includes(`[[${name}`))!.trim() }));
  },
  onChanged(cb) {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => e.key === KEY && cb([]);
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener('storage', onStorage);
    };
  },
  openInObsidian() {},
  showInFolder() {},
  openUrl(url) {
    window.open(url, '_blank', 'noopener');
  },
};

const desktopBridge: VaultBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { axonixVault?: VaultBridge }).axonixVault ?? null) : null;

export const vault: VaultBridge = desktopBridge ?? browser;
export const isDesktopVault = desktopBridge !== null;

/** A URL the page can load for an image in the vault. */
export function imageUrl(path: string): string {
  if (desktopBridge) return `vault://local/${path.split('/').map(encodeURIComponent).join('/')}`;
  return load().images[path] ?? '';
}
