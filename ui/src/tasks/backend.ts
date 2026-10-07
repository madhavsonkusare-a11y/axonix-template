/**
 * Where task files live.
 *
 * In the desktop app: the vault's `Tasks/` folder, through the main process
 * (`electron/tasks.ts`, exposed by the preload as `window.axonixTasks`). It is
 * a deliberately thin file service — list, read, write, rename, trash — and
 * every write carries the text it expects to replace, so a file changed in
 * Obsidian a moment earlier is never overwritten blind.
 *
 * In a plain browser (the Vite dev server): the same service over
 * localStorage, so the board can be clicked through without touching the vault.
 */
import type { RawFile } from './types';

export interface TasksListing {
  /** Absolute folder, for display. */
  root: string;
  /** Project folders, including empty ones. */
  folders: string[];
  files: RawFile[];
}

export interface TasksBridge {
  list(): Promise<TasksListing>;
  /** Writes `text` if the file still holds `expected` (null: must not exist yet). */
  write(path: string, text: string, expected: string | null): Promise<RawFile>;
  /** Moves a file (rename, or to another project) if it still holds `expected`. */
  rename(from: string, to: string, expected: string): Promise<RawFile>;
  /** Moves a file into `Tasks/.trash/`; resolves to where it went. */
  trash(path: string, expected: string): Promise<string>;
  /** Brings a trashed file back to `to`. */
  restore(trashPath: string, to: string): Promise<RawFile>;
  mkdir(folder: string): Promise<void>;
  /** Renames one project folder and every task inside it. */
  renameProject(from: string, to: string): Promise<void>;
  /** Something in the folder changed on disk (Obsidian, sync, an agent, or us). */
  onChanged(cb: () => void): () => void;
  openInObsidian(path: string): void;
  showInFolder(path?: string): void;
}

/** True when a write was refused because the file changed underneath. */
export const isConflict = (e: unknown) => /conflict/i.test(e instanceof Error ? e.message : String(e));

/* ------------------------------------------------------------------ */
/* the browser stand-in                                                */
/* ------------------------------------------------------------------ */

const KEY = 'axonix:tasks:fs';

interface VirtualFs {
  folders: string[];
  files: Record<string, { text: string; mtime: number }>;
  trash: Record<string, { text: string; mtime: number }>;
}

function load(): VirtualFs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { folders: [], files: {}, trash: {}, ...(JSON.parse(raw) as Partial<VirtualFs>) };
  } catch {
    // An unreadable store starts empty; nothing in the vault is touched either way.
  }
  return { folders: [], files: {}, trash: {} };
}

const findKey = (files: Record<string, unknown>, path: string) => Object.keys(files).find((k) => k.toLowerCase() === path.toLowerCase());

function conflict(path: string): Error {
  return new Error(`conflict: ${path} changed since it was read`);
}

const listeners = new Set<() => void>();

function commit(fs: VirtualFs) {
  localStorage.setItem(KEY, JSON.stringify(fs));
  queueMicrotask(() => listeners.forEach((l) => l()));
}

function ensureFolder(fs: VirtualFs, path: string) {
  const i = path.lastIndexOf('/');
  const folder = i < 0 ? '' : path.slice(0, i);
  if (folder && !fs.folders.some((f) => f.toLowerCase() === folder.toLowerCase())) fs.folders.push(folder);
}

const browser: TasksBridge = {
  async list() {
    const fs = load();
    const folders = new Set(fs.folders);
    for (const p of Object.keys(fs.files)) if (p.includes('/')) folders.add(p.slice(0, p.lastIndexOf('/')));
    return {
      root: 'this browser (dev mode)',
      folders: [...folders].sort((a, b) => a.localeCompare(b)),
      files: Object.entries(fs.files).map(([path, f]) => ({ path, text: f.text, mtime: f.mtime })),
    };
  },
  async write(path, text, expected) {
    const fs = load();
    const key = findKey(fs.files, path);
    if (expected === null ? key !== undefined : key === undefined || fs.files[key].text !== expected) throw conflict(path);
    const mtime = Date.now();
    fs.files[key ?? path] = { text, mtime };
    ensureFolder(fs, path);
    commit(fs);
    return { path: key ?? path, text, mtime };
  },
  async rename(from, to, expected) {
    const fs = load();
    const key = findKey(fs.files, from);
    if (key === undefined || fs.files[key].text !== expected) throw conflict(from);
    const target = findKey(fs.files, to);
    if (target !== undefined && target !== key) throw new Error(`conflict: ${to} already exists`);
    const file = fs.files[key];
    delete fs.files[key];
    fs.files[to] = { text: file.text, mtime: Date.now() };
    ensureFolder(fs, to);
    commit(fs);
    return { path: to, ...fs.files[to] };
  },
  async trash(path, expected) {
    const fs = load();
    const key = findKey(fs.files, path);
    if (key === undefined || fs.files[key].text !== expected) throw conflict(path);
    const where = `.trash/${Date.now()} ${key.replace(/\//g, ' - ')}`;
    fs.trash[where] = fs.files[key];
    delete fs.files[key];
    commit(fs);
    return where;
  },
  async restore(trashPath, to) {
    const fs = load();
    const file = fs.trash[trashPath];
    if (!file) throw new Error('That file is no longer in the trash.');
    if (findKey(fs.files, to) !== undefined) throw new Error(`conflict: ${to} already exists`);
    delete fs.trash[trashPath];
    fs.files[to] = { text: file.text, mtime: Date.now() };
    ensureFolder(fs, to);
    commit(fs);
    return { path: to, ...fs.files[to] };
  },
  async mkdir(folder) {
    const fs = load();
    if (!fs.folders.some((f) => f.toLowerCase() === folder.toLowerCase())) fs.folders.push(folder);
    commit(fs);
  },
  async renameProject(from, to) {
    const fs = load();
    const existing = fs.folders.find((folder) => folder.toLowerCase() === from.toLowerCase());
    if (!existing) throw new Error(`${from} no longer exists`);
    if (fs.folders.some((folder) => folder.toLowerCase() === to.toLowerCase() && folder !== existing)) throw new Error(`${to} already exists`);
    const moved: Record<string, { text: string; mtime: number }> = {};
    for (const [path, file] of Object.entries(fs.files)) {
      if (!path.toLowerCase().startsWith(`${existing.toLowerCase()}/`)) continue;
      const target = `${to}/${path.slice(existing.length + 1)}`;
      if (findKey(fs.files, target) && target.toLowerCase() !== path.toLowerCase()) throw new Error(`${target} already exists`);
      moved[target] = { ...file, mtime: Date.now() };
      delete fs.files[path];
    }
    Object.assign(fs.files, moved);
    fs.folders = fs.folders.map((folder) => (folder === existing ? to : folder));
    commit(fs);
  },
  onChanged(cb) {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => e.key === KEY && cb();
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener('storage', onStorage);
    };
  },
  openInObsidian() {},
  showInFolder() {},
};

const desktopBridge: TasksBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { axonixTasks?: TasksBridge }).axonixTasks ?? null) : null;

export const tasksBackend: TasksBridge = desktopBridge ?? browser;
export const isDesktop = desktopBridge !== null;
