/**
 * Notes — the vault file service behind the markdown editor (main process).
 *
 * The same contract as the Tasks service (`tasks.ts`), for any note in the
 * vault: list, read, write only if the file still holds the text the page read,
 * rename, "delete" into the vault's `.trash/` (Obsidian's own trash folder),
 * pasted images into an `attachments/` folder beside the note, backlinks, and
 * a watcher.
 *
 * Out of bounds, always: anything outside the vault, dot-folders (`.obsidian`,
 * `.git`, `.trash` except to restore), build and package folders, and every
 * path Obsidian is told to ignore (`.obsidian/app.json` → `userIgnoreFilters`,
 * which is how the AXONIX repo inside the vault stays untouchable).
 *
 * Images are served to the page read-only through `vault://local/<path>`.
 */
import { ipcMain, net, protocol, shell, type CustomScheme, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_NOTE_BYTES = 4 * 1024 * 1024;
const MAX_BLOCK_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20_000;
const TRASH = '.trash';
const SKIP = new Set(['node_modules', '.pnpm-store', 'target', '__pycache__', 'venv', '.venv']);
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };

interface Options {
  vault: string;
  isHost: (sender: WebContents) => boolean;
  send: (channel: string, payload: unknown) => void;
}

interface RawFile {
  path: string;
  text: string;
  mtime: number;
}

/**
 * Call before `app.whenReady()`: the image scheme must be privileged up front.
 * Electron takes one list for the whole app, so other modules' schemes
 * (the Storeroom's) are registered here too.
 */
export function registerVaultScheme(extra: CustomScheme[] = []) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true } }, ...extra]);
}

export function registerVault({ vault, isHost, send }: Options) {
  const root = path.resolve(vault);
  const rootLower = root.toLowerCase();
  const vaultName = path.basename(root);

  /* ---------- what is off limits ---------- */

  const BAD_CHARS = /[<>:"|?*\u0000-\u001f\\]/;
  const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

  let ignore: { at: number; prefixes: string[]; patterns: RegExp[] } = { at: 0, prefixes: [], patterns: [] };
  /** Obsidian's "Excluded files", re-read at most every 5 s. */
  function ignored(rel: string): boolean {
    if (Date.now() - ignore.at > 5000) {
      ignore = { at: Date.now(), prefixes: [], patterns: [] };
      try {
        const app = JSON.parse(fs.readFileSync(path.join(root, '.obsidian', 'app.json'), 'utf8')) as { userIgnoreFilters?: unknown };
        for (const f of Array.isArray(app.userIgnoreFilters) ? app.userIgnoreFilters : []) {
          if (typeof f !== 'string' || !f) continue;
          const re = /^\/(.+)\/([a-z]*)$/.exec(f);
          if (re) {
            try {
              ignore.patterns.push(new RegExp(re[1], re[2]));
            } catch {
              // An unreadable pattern ignores nothing.
            }
          } else ignore.prefixes.push(f.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase());
        }
      } catch {
        // No app.json: nothing extra is ignored.
      }
    }
    const low = rel.toLowerCase();
    return ignore.prefixes.some((p) => low === p || low.startsWith(`${p}/`)) || ignore.patterns.some((r) => r.test(rel));
  }

  const hiddenSegment = (p: string) => p.startsWith('.') || SKIP.has(p) || /^dist(-|$)/i.test(p);

  function partsOf(rel: unknown, { allowTrash = false, ext = /\.md$/i }: { allowTrash?: boolean; ext?: RegExp | null } = {}): string[] {
    if (typeof rel !== 'string' || !rel || rel.length > 600) throw new Error('invalid path');
    const parts = rel.split('/');
    if (parts.some((p) => !p || p === '.' || p === '..' || BAD_CHARS.test(p) || RESERVED.test(p) || /[. ]$/.test(p))) throw new Error(`invalid path: ${rel}`);
    if (parts.some((p, i) => hiddenSegment(p) && !(allowTrash && i === 0 && p === TRASH))) throw new Error(`not allowed: ${rel}`);
    if (!(allowTrash && parts[0] === TRASH) && ignored(rel)) throw new Error(`excluded in Obsidian: ${rel}`);
    if (ext && !ext.test(parts[parts.length - 1])) throw new Error(`wrong kind of file: ${rel}`);
    return parts;
  }

  function abs(parts: string[]): string {
    const full = path.resolve(root, ...parts);
    if (!full.toLowerCase().startsWith(`${rootLower}${path.sep}`)) throw new Error('path escapes the vault');
    return full;
  }

  const noteAt = (rel: unknown, allowTrash = false) => abs(partsOf(rel, { allowTrash }));
  const BLOCK_EXT = /\.axonix\.json$/i;
  const blockPath = (rel: unknown) => {
    const note = partsOf(rel);
    const file = note.pop()!;
    return abs([...note, file.replace(/\.md$/i, '.axonix.json')]);
  };

  function current(full: string): string | null {
    try {
      return fs.readFileSync(full, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  function readNote(full: string, rel: string): RawFile {
    const stat = fs.statSync(full);
    if (stat.size > MAX_NOTE_BYTES) throw new Error(`${rel} is too large to open here`);
    return { path: rel, text: fs.readFileSync(full, 'utf8'), mtime: stat.mtimeMs };
  }

  function writeAtomic(full: string, data: string | Buffer) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.axonix-tmp`);
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, full);
  }

  /* ---------- listing ---------- */

  function walk(): { folders: string[]; files: { path: string; mtime: number; size: number }[]; images: string[] } {
    const folders: string[] = [];
    const files: { path: string; mtime: number; size: number }[] = [];
    const images: string[] = [];
    const visit = (dir: string, prefix: string, depth: number) => {
      if (depth > 12 || files.length >= MAX_FILES) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of entries) {
        if (hiddenSegment(d.name) || BAD_CHARS.test(d.name)) continue;
        const rel = `${prefix}${d.name}`;
        if (ignored(rel)) continue;
        if (d.isDirectory()) {
          folders.push(rel);
          visit(path.join(dir, d.name), `${rel}/`, depth + 1);
        } else if (d.isFile() && /\.md$/i.test(d.name)) {
          try {
            const st = fs.statSync(path.join(dir, d.name));
            files.push({ path: rel, mtime: st.mtimeMs, size: st.size });
          } catch {
            // Gone between listing and stat.
          }
        } else if (d.isFile() && IMAGE.test(d.name) && images.length < MAX_FILES) {
          images.push(rel);
        }
      }
    };
    visit(root, '', 0);
    return { folders, files, images };
  }

  /* ---------- watching ---------- */

  let watcher: fs.FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let changed = new Set<string>();

  function watch() {
    if (watcher || !fs.existsSync(root)) return;
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, name) => {
        if (!name) return;
        const rel = String(name).replace(/\\/g, '/');
        if (rel.split('/').some(hiddenSegment) || rel.endsWith('.axonix-tmp') || ignored(rel)) return;
        changed.add(rel);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const paths = [...changed];
          changed = new Set();
          send('vault:changed', paths);
        }, 200);
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  }

  /* ---------- images, read-only ---------- */

  protocol.handle('vault', async (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const full = abs(partsOf(rel, { ext: IMAGE }));
      const stat = fs.statSync(full);
      if (stat.size > MAX_IMAGE_BYTES) return new Response('too large', { status: 413 });
      const res = await net.fetch(pathToFileURL(full).href);
      const ext = full.slice(full.lastIndexOf('.') + 1).toLowerCase();
      return new Response(res.body, { headers: { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  /* ---------- handlers ---------- */

  const guard = (event: IpcMainInvokeEvent) => {
    if (!isHost(event.sender)) throw new Error('not allowed');
  };

  ipcMain.handle('vault:tree', (event) => {
    guard(event);
    watch();
    const { folders, files, images } = walk();
    return { root, vaultName, folders, files, images };
  });

  ipcMain.handle('vault:read', (event, rel: unknown) => {
    guard(event);
    return readNote(noteAt(rel), rel as string);
  });

  ipcMain.handle('vault:write', (event, rel: unknown, text: unknown, expected: unknown) => {
    guard(event);
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_NOTE_BYTES) throw new Error('invalid text');
    if (expected !== null && typeof expected !== 'string') throw new Error('invalid expectation');
    const full = noteAt(rel);
    const now = current(full);
    if (expected === null ? now !== null : now !== expected) throw new Error(`conflict: ${String(rel)} changed since it was read`);
    writeAtomic(full, text);
    return readNote(full, rel as string);
  });

  // Rich BlockSuite documents are Axonix-owned sidecars. The markdown note is
  // still kept as a readable plain-text projection for Obsidian and search.
  ipcMain.handle('vault:document-save', (event, rel: unknown, text: unknown, blocks: unknown, expected: unknown, expectedBlocks: unknown) => {
    guard(event);
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_NOTE_BYTES || typeof expected !== 'string') throw new Error('invalid note');
    if (blocks !== null && (typeof blocks !== 'string' || Buffer.byteLength(blocks) > MAX_BLOCK_BYTES)) throw new Error('rich note exceeds the 16 MB limit');
    if (expectedBlocks !== null && typeof expectedBlocks !== 'string') throw new Error('invalid expectation');
    const file = noteAt(rel); const richFile = blockPath(rel);
    const previous = current(richFile);
    // Check both versions before touching either file. Main-process handlers are synchronous.
    if (current(file) !== expected || previous !== expectedBlocks) throw new Error('conflict: this note changed elsewhere');
    if (blocks !== null) writeAtomic(richFile, blocks);
    try { writeAtomic(file, text); }
    catch (error) {
      if (blocks !== null) { if (previous === null) fs.unlinkSync(richFile); else writeAtomic(richFile, previous); }
      throw error;
    }
    return readNote(file, rel as string);
  });

  ipcMain.handle('vault:notes-trash-list', (event) => {
    guard(event);
    const dir = path.join(root, TRASH);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).flatMap(name => {
      const match = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z) Notes - (.+\.md)$/.exec(name);
      if (!match) return [];
      try {
        const rel = `${TRASH}/${name}`;
        const originalPath = `Notes/${match[2]}`;
        noteAt(originalPath);
        const f = readNote(noteAt(rel, true), rel);
        return [{ ...f, originalPath, deletedAt: f.mtime }];
      } catch { return []; }
    });
  });
  ipcMain.handle('vault:blocks-read', (event, rel: unknown) => {
    guard(event);
    const full = blockPath(rel);
    const text = current(full);
    if (text === null) return null;
    const stat = fs.statSync(full);
    if (stat.size > MAX_BLOCK_BYTES) throw new Error('rich note is too large to open here');
    return { text, mtime: stat.mtimeMs };
  });

  ipcMain.handle('vault:blocks-write', (event, rel: unknown, text: unknown, expected: unknown) => {
    guard(event);
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BLOCK_BYTES) throw new Error('invalid rich note');
    if (expected !== null && typeof expected !== 'string') throw new Error('invalid expectation');
    const full = blockPath(rel);
    const now = current(full);
    if (expected === null ? now !== null : now !== expected) throw new Error(`conflict: rich note for ${String(rel)} changed since it was read`);
    writeAtomic(full, text);
    return { text, mtime: fs.statSync(full).mtimeMs };
  });

  ipcMain.handle('vault:blocks-rename', (event, from: unknown, to: unknown) => {
    guard(event);
    const src = blockPath(from);
    const dest = blockPath(to);
    if (!fs.existsSync(src)) return false;
    if (src.toLowerCase() !== dest.toLowerCase() && fs.existsSync(dest)) throw new Error(`conflict: rich note for ${String(to)} already exists`);
    fs.renameSync(src, dest);
    return true;
  });

  ipcMain.handle('vault:blocks-trash', (event, rel: unknown) => {
    guard(event);
    const src = blockPath(rel);
    if (!fs.existsSync(src)) return false;
    const noteParts = partsOf(rel);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = noteParts.join(' - ').replace(/\.md$/i, '.axonix.json');
    const dest = abs(partsOf(`${TRASH}/${stamp} ${file}`, { allowTrash: true, ext: BLOCK_EXT }));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return true;
  });

  ipcMain.handle('vault:rename', (event, from: unknown, to: unknown, expected: unknown) => {
    guard(event);
    const src = noteAt(from);
    const dest = noteAt(to);
    if (typeof expected !== 'string' || current(src) !== expected) throw new Error(`conflict: ${String(from)} changed since it was read`);
    if (src.toLowerCase() !== dest.toLowerCase() && fs.existsSync(dest)) throw new Error(`conflict: ${String(to)} already exists`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return readNote(dest, to as string);
  });

  ipcMain.handle('vault:trash', (event, rel: unknown, expected: unknown) => {
    guard(event);
    const src = noteAt(rel);
    if (typeof expected !== 'string' || current(src) !== expected) throw new Error(`conflict: ${String(rel)} changed since it was read`);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashRel = `${TRASH}/${stamp} ${(rel as string).replace(/\//g, ' - ')}`;
    const dest = abs(partsOf(trashRel, { allowTrash: true }));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const richSrc = blockPath(rel);
    const richDest = dest.replace(/\.md$/i, '.axonix.json');
    const hasRich = fs.existsSync(richSrc);
    if (hasRich) fs.renameSync(richSrc, richDest);
    try { fs.renameSync(src, dest); }
    catch (error) { if (hasRich) fs.renameSync(richDest, richSrc); throw error; }
    return trashRel;
  });

  ipcMain.handle('vault:restore', (event, trashRel: unknown, to: unknown) => {
    guard(event);
    const parts = partsOf(trashRel, { allowTrash: true });
    if (parts.length !== 2 || parts[0] !== TRASH) throw new Error('not a trashed note');
    const src = abs(parts);
    const dest = noteAt(to);
    if (!fs.existsSync(src)) throw new Error('That note is no longer in the trash.');
    if (fs.existsSync(dest)) throw new Error(`conflict: ${String(to)} already exists`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const richSrc = src.replace(/\.md$/i, '.axonix.json');
    const richDest = blockPath(to);
    const hasRich = fs.existsSync(richSrc);
    if (hasRich && fs.existsSync(richDest)) throw new Error('conflict: a rich note already exists here');
    if (hasRich) fs.renameSync(richSrc, richDest);
    try { fs.renameSync(src, dest); }
    catch (error) { if (hasRich) fs.renameSync(richDest, richSrc); throw error; }
    return readNote(dest, to as string);
  });

  /** A pasted or dropped image, saved to `attachments/` beside the note. Resolves to its vault path. */
  ipcMain.handle('vault:attach', (event, noteRel: unknown, name: unknown, base64: unknown) => {
    guard(event);
    const noteParts = partsOf(noteRel);
    if (typeof name !== 'string' || typeof base64 !== 'string') throw new Error('invalid attachment');
    const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim() || 'Pasted image.png';
    if (!IMAGE.test(clean)) throw new Error('only images can be attached here');
    const data = Buffer.from(base64, 'base64');
    if (!data.length || data.length > MAX_IMAGE_BYTES) throw new Error('image too large');
    const folder = [...noteParts.slice(0, -1), 'attachments'];
    const dot = clean.lastIndexOf('.');
    const [stem, ext] = [clean.slice(0, dot), clean.slice(dot)];
    let rel = [...folder, clean].join('/');
    for (let n = 2; fs.existsSync(abs(partsOf(rel, { ext: IMAGE }))); n++) rel = [...folder, `${stem} ${n}${ext}`].join('/');
    writeAtomic(abs(partsOf(rel, { ext: IMAGE })), data);
    return rel;
  });

  /** Notes that link here: `[[name]]`, `[[name|alias]]`, `[[name#heading]]`, or a markdown link to the file. */
  ipcMain.handle('vault:backlinks', (event, rel: unknown) => {
    guard(event);
    partsOf(rel);
    const target = (rel as string).replace(/\.md$/i, '');
    const name = target.slice(target.lastIndexOf('/') + 1).toLowerCase();
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wiki = new RegExp(`\\[\\[(?:${esc(target)}|${esc(name)})(?:[#|][^\\]]*)?\\]\\]`, 'i');
    const md = new RegExp(`\\]\\((?:[^)]*/)?${esc(encodeURI(name))}\\.md\\)`, 'i');
    const out: { path: string; line: string }[] = [];
    for (const f of walk().files) {
      if (f.path === rel || f.size > MAX_NOTE_BYTES) continue;
      let text: string;
      try {
        text = fs.readFileSync(path.join(root, ...f.path.split('/')), 'utf8');
      } catch {
        continue;
      }
      const line = text.split(/\r?\n/).find((l) => wiki.test(l) || md.test(l));
      if (line !== undefined) out.push({ path: f.path, line: line.trim().slice(0, 240) });
      if (out.length >= 200) break;
    }
    return out;
  });

  // A link in a note: web and mail links open in the default browser or mail app; nothing else.
  ipcMain.on('vault:open-url', (event, raw: unknown) => {
    if (!isHost(event.sender) || typeof raw !== 'string') return;
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') void shell.openExternal(url.href);
    } catch {
      // Not a URL.
    }
  });

  ipcMain.on('vault:open-in-obsidian', (event, rel: unknown) => {
    if (!isHost(event.sender)) return;
    try {
      noteAt(rel);
      void shell.openExternal(`obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(rel as string)}`);
    } catch {
      // Not a note: nothing to open.
    }
  });

  ipcMain.on('vault:show-in-folder', (event, rel: unknown) => {
    if (!isHost(event.sender)) return;
    try {
      shell.showItemInFolder(noteAt(rel));
    } catch {
      // Not a note: nothing to show.
    }
  });
}
