/**
 * Tasks — the file service behind the board (main process).
 *
 * Tasks are markdown files in the vault's `Tasks/` folder: one file per task,
 * one sub-folder per project. The page parses and edits them; this module only
 * lists, reads and moves files, and it refuses anything outside that folder.
 *
 * The files are the owner's data, so:
 *   - every write names the text it expects to replace, and is refused if the
 *     file changed since (an edit in Obsidian is never overwritten blind);
 *   - writes are atomic (temp file + rename);
 *   - nothing is ever deleted: "delete" moves the file to `Tasks/.trash/`,
 *     which Obsidian hides and Undo restores from;
 *   - the folder is copied to `%LOCALAPPDATA%\Axonix\backups\tasks-…-startup\`
 *     the first time the page reads it each run (newest 20 kept).
 */
import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const STARTUP_BACKUPS_KEPT = 20;
const TRASH = '.trash';

interface Options {
  vault: string;
  backupsDir: string;
  isHost: (sender: WebContents) => boolean;
  send: (channel: string, payload: unknown) => void;
}

interface RawFile {
  path: string;
  text: string;
  mtime: number;
}

export function registerTasks({ vault, backupsDir, isHost, send }: Options) {
  const root = path.join(vault, 'Tasks');
  const rootLower = path.resolve(root).toLowerCase();
  let backedUp = false;

  /* ---------- paths ---------- */

  const BAD_CHARS = /[<>:"|?*\u0000-\u001f\\]/;
  const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

  /** A relative path inside Tasks/, as segments; throws for anything else. */
  function segmentsOf(rel: unknown, { file, allowTrash = false }: { file: boolean; allowTrash?: boolean }): string[] {
    if (typeof rel !== 'string' || !rel || rel.length > 400) throw new Error('invalid path');
    const parts = rel.split('/');
    if (parts.length > 2 || parts.some((p) => !p || p === '.' || p === '..' || BAD_CHARS.test(p) || RESERVED.test(p) || /[. ]$/.test(p))) {
      throw new Error(`invalid path: ${rel}`);
    }
    if (parts.some((p, i) => p.startsWith('.') && !(allowTrash && i === 0 && p === TRASH))) throw new Error(`invalid path: ${rel}`);
    if (file && !/\.md$/i.test(parts[parts.length - 1])) throw new Error(`not a markdown file: ${rel}`);
    return parts;
  }

  function abs(parts: string[]): string {
    const full = path.resolve(root, ...parts);
    if (!full.toLowerCase().startsWith(`${rootLower}${path.sep}`)) throw new Error('path escapes the Tasks folder');
    return full;
  }

  const fileAt = (rel: unknown, allowTrash = false) => abs(segmentsOf(rel, { file: true, allowTrash }));

  function readFile(full: string, rel: string): RawFile {
    const stat = fs.statSync(full);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`${rel} is too large to open here`);
    return { path: rel, text: fs.readFileSync(full, 'utf8'), mtime: stat.mtimeMs };
  }

  function current(full: string): string | null {
    try {
      return fs.readFileSync(full, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  function writeAtomic(full: string, text: string) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.axonix-tmp`);
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, full);
  }

  /* ---------- watching ---------- */

  let watcher: fs.FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;

  function watch() {
    if (watcher || !fs.existsSync(root)) return;
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, name) => {
        if (name && String(name).endsWith('.axonix-tmp')) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => send('tasks:changed', null), 150);
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  }

  /* ---------- backups ---------- */

  function backupOnce() {
    if (backedUp) return;
    backedUp = true;
    try {
      if (!fs.existsSync(root)) return;
      const secs = Math.floor(Date.now() / 1000);
      const dest = path.join(backupsDir, `tasks-${secs}-startup`);
      let copied = 0;
      for (const f of listFiles()) {
        const to = path.join(dest, ...f.path.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(root, ...f.path.split('/')), to);
        copied++;
      }
      if (!copied) return;
      const old = fs
        .readdirSync(backupsDir)
        .filter((n) => /^tasks-\d+-startup$/.test(n))
        .sort();
      for (const name of old.slice(0, Math.max(0, old.length - STARTUP_BACKUPS_KEPT))) {
        fs.rmSync(path.join(backupsDir, name), { recursive: true, force: true });
      }
    } catch (e) {
      console.error('Failed to back up the Tasks folder:', e);
    }
  }

  /* ---------- listing ---------- */

  const visible = (name: string) => !name.startsWith('.') && !BAD_CHARS.test(name);
  /** `attachments/` holds images pasted into task notes; it is not a project. */
  const isProject = (name: string) => visible(name) && name.toLowerCase() !== 'attachments';

  function listFolders(): string[] {
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isProject(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  }

  function listFiles(): RawFile[] {
    if (!fs.existsSync(root)) return [];
    const out: RawFile[] = [];
    const add = (dir: string, prefix: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!d.isFile() || !visible(d.name) || !/\.md$/i.test(d.name)) continue;
        const rel = `${prefix}${d.name}`;
        try {
          out.push(readFile(path.join(dir, d.name), rel));
        } catch {
          // A file that cannot be read (locked, too large) is left out, not failed on.
        }
      }
    };
    add(root, '');
    for (const folder of listFolders()) add(path.join(root, folder), `${folder}/`);
    return out;
  }

  /* ---------- handlers ---------- */

  const guard = (event: IpcMainInvokeEvent) => {
    if (!isHost(event.sender)) throw new Error('not allowed');
  };

  ipcMain.handle('tasks:list', (event) => {
    guard(event);
    backupOnce();
    watch();
    return { root, folders: listFolders(), files: listFiles() };
  });

  ipcMain.handle('tasks:write', (event, rel: unknown, text: unknown, expected: unknown) => {
    guard(event);
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('invalid text');
    if (expected !== null && typeof expected !== 'string') throw new Error('invalid expectation');
    const full = fileAt(rel);
    const now = current(full);
    if (expected === null ? now !== null : now !== expected) throw new Error(`conflict: ${String(rel)} changed since it was read`);
    writeAtomic(full, text);
    watch();
    return readFile(full, rel as string);
  });

  ipcMain.handle('tasks:rename', (event, from: unknown, to: unknown, expected: unknown) => {
    guard(event);
    if (typeof expected !== 'string') throw new Error('invalid expectation');
    const src = fileAt(from);
    const dest = fileAt(to);
    if (current(src) !== expected) throw new Error(`conflict: ${String(from)} changed since it was read`);
    const sameFile = src.toLowerCase() === dest.toLowerCase();
    if (!sameFile && fs.existsSync(dest)) throw new Error(`conflict: ${String(to)} already exists`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return readFile(dest, to as string);
  });

  ipcMain.handle('tasks:trash', (event, rel: unknown, expected: unknown) => {
    guard(event);
    const src = fileAt(rel);
    if (typeof expected !== 'string' || current(src) !== expected) throw new Error(`conflict: ${String(rel)} changed since it was read`);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${stamp} ${(rel as string).replace(/\//g, ' - ')}`;
    const trashRel = `${TRASH}/${name}`;
    const dest = fileAt(trashRel, true);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return trashRel;
  });

  ipcMain.handle('tasks:restore', (event, trashRel: unknown, to: unknown) => {
    guard(event);
    const parts = segmentsOf(trashRel, { file: true, allowTrash: true });
    if (parts.length !== 2 || parts[0] !== TRASH) throw new Error('not a trashed file');
    const src = abs(parts);
    const dest = fileAt(to);
    if (!fs.existsSync(src)) throw new Error('That file is no longer in the trash.');
    if (fs.existsSync(dest)) throw new Error(`conflict: ${String(to)} already exists`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return readFile(dest, to as string);
  });

  ipcMain.handle('tasks:mkdir', (event, folder: unknown) => {
    guard(event);
    const parts = segmentsOf(folder, { file: false });
    if (parts.length !== 1) throw new Error('a project is one folder');
    fs.mkdirSync(abs(parts), { recursive: true });
    watch();
    return true;
  });

  ipcMain.handle('tasks:rename-project', (event, from: unknown, to: unknown) => {
    guard(event);
    const fromParts = segmentsOf(from, { file: false });
    const toParts = segmentsOf(to, { file: false });
    if (fromParts.length !== 1 || toParts.length !== 1) throw new Error('a project is one folder');
    const src = abs(fromParts);
    const dest = abs(toParts);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error(`${String(from)} no longer exists`);
    const sameName = src.toLowerCase() === dest.toLowerCase();
    if (!sameName && fs.existsSync(dest)) throw new Error(`${String(to)} already exists`);
    if (src === dest) return true;
    if (sameName) {
      const temp = path.join(root, `.axonix-rename-${Date.now()}`);
      fs.renameSync(src, temp);
      try {
        fs.renameSync(temp, dest);
      } catch (error) {
        fs.renameSync(temp, src);
        throw error;
      }
    } else fs.renameSync(src, dest);
    watch();
    return true;
  });

  ipcMain.on('tasks:open-in-obsidian', (event, rel: unknown) => {
    if (!isHost(event.sender)) return;
    try {
      fileAt(rel);
      const url = `obsidian://open?vault=${encodeURIComponent(path.basename(vault))}&file=${encodeURIComponent(`Tasks/${rel as string}`)}`;
      void shell.openExternal(url);
    } catch {
      // Not a task path: nothing to open.
    }
  });

  ipcMain.on('tasks:show-in-folder', (event, rel: unknown) => {
    if (!isHost(event.sender)) return;
    try {
      if (typeof rel === 'string' && rel) shell.showItemInFolder(fileAt(rel));
      else if (fs.existsSync(root)) void shell.openPath(root);
    } catch {
      // Not a task path: nothing to show.
    }
  });
}
