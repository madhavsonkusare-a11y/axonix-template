/**
 * Every note made in Axonix, in memory: the Notes stream, project pages and
 * the rail's collections read from here.
 *
 * Only the vault's `Notes/` folder is read (owner, 2026-09-19: "Notes and
 * projects made in AXONIX only … don't show current vault notes, or folders").
 * Files are re-read when they change on disk, by modification time, so an edit
 * in Obsidian or by an agent shows up in a moment.
 *
 * Collections are saved filters (a kind, a project, a search) — the way to keep
 * a group of notes together without folders. They are a view preference, so
 * they live in this app's storage, not in the vault.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { isConflict, messageOf, vault } from './backend';
import { freeNotePath } from './links';
import { NOTES_DIR, isNotePath, newNoteText, parseNote, setNoteProps, type Note, type NoteKind, type NoteProps } from './notefile';
import { sanitizeName } from '../tasks/taskfile';

export interface NoteFilter {
  kind?: NoteKind;
  /** A project name; '' for notes in no project; undefined for all. */
  project?: string;
  query?: string;
  pinned?: boolean;
}

export interface Collection {
  id: string;
  name: string;
  filter: NoteFilter;
}

export interface NotesValue {
  notes: Note[];
  byPath: Map<string, Note>;
  images: string[];
  loading: boolean;
  error: string | null;
  /** Makes a note and resolves to its path. */
  create: (opts: { title?: string; kind?: NoteKind; project?: string; props?: NoteProps }) => Promise<string | null>;
  /** Moves every Axonix note association from one project name to another. */
  renameProject: (from: string, to: string) => Promise<boolean>;
  /** A write from an open page landed: keep the list in step. */
  saved: (path: string, text: string) => void;
  /** Re-read from disk. */
  refresh: () => Promise<void>;
  /** Drop a path from memory (after a rename or delete elsewhere). */
  forget: (path: string) => void;
  collections: Collection[];
  saveCollection: (name: string, filter: NoteFilter) => Collection;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
}

const NotesCtx = createContext<NotesValue | null>(null);

const COLLECTIONS_KEY = 'axonix:notes:collections';
function loadCollections(): Collection[] {
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY);
    const list = raw ? (JSON.parse(raw) as Collection[]) : [];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string') : [];
  } catch {
    return [];
  }
}

export function matchesNote(n: Note, f: NoteFilter): boolean {
  if (f.pinned && !n.pinned) return false;
  if (f.kind && n.kind !== f.kind) return false;
  if (f.project !== undefined && n.project !== f.project) return false;
  const q = f.query?.trim().toLowerCase();
  if (q && !q.split(/\s+/).every(term => `${n.title} ${n.body} ${n.project} ${n.kind}`.toLowerCase().includes(term))) return false;
  return true;
}

export function NotesProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<Map<string, { text: string; mtime: number }>>(() => new Map());
  const filesRef = useRef(files);
  const refreshSequence = useRef(0);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>(loadCollections);

  const put = useCallback((next: Map<string, { text: string; mtime: number }>) => {
    filesRef.current = next;
    setFiles(next);
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const before = filesRef.current;
    try {
      const tree = await vault.tree();
      const listed = tree.files.filter((f) => isNotePath(f.path));
      const next = new Map<string, { text: string; mtime: number }>();
      await Promise.all(
        listed.map(async (f) => {
          const had = filesRef.current.get(f.path);
          if (had && had.mtime >= f.mtime) {
            next.set(f.path, had);
            return;
          }
          try {
            const r = await vault.read(f.path);
            next.set(f.path, { text: r.text, mtime: r.mtime || f.mtime });
          } catch {
            // Gone between the listing and the read.
          }
        }),
      );
      if (sequence !== refreshSequence.current) return;
      // A save/create/delete that landed during this scan wins over stale disk reads.
      for (const [path, file] of filesRef.current) if (before.get(path) !== file) next.set(path, file);
      for (const path of before.keys()) if (!filesRef.current.has(path)) next.delete(path);
      put(next);
      setImages(tree.images.filter((i) => i.toLowerCase().startsWith(`${NOTES_DIR.toLowerCase()}/`)));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [put]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const soon = useRef<number | null>(null);
  useEffect(
    () =>
      vault.onChanged((paths) => {
        if (paths.length && !paths.some((p) => p.toLowerCase().startsWith(`${NOTES_DIR.toLowerCase()}/`))) return;
        if (soon.current !== null) return;
        soon.current = window.setTimeout(() => {
          soon.current = null;
          void refresh();
        }, 200);
      }),
    [refresh],
  );

  const notes = useMemo(() => [...files.entries()].map(([p, f]) => parseNote(p, f.text, f.mtime)).sort((a, b) => b.mtime - a.mtime), [files]);
  const byPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes]);

  const saved = useCallback(
    (path: string, text: string) => {
      const next = new Map(filesRef.current);
      next.set(path, { text, mtime: Date.now() });
      put(next);
    },
    [put],
  );
  const forget = useCallback(
    (path: string) => {
      if (!filesRef.current.has(path)) return;
      const next = new Map(filesRef.current);
      next.delete(path);
      put(next);
    },
    [put],
  );

  const create = useCallback(
    async ({ title, kind = 'note', project = '', props }: { title?: string; kind?: NoteKind; project?: string; props?: NoteProps }) => {
      const name = sanitizeName(title?.trim() || 'Untitled');
      const path = freeNotePath(NOTES_DIR, name, [...filesRef.current.keys()]);
      const text = newNoteText(kind, project, { title: title?.trim() || 'Untitled', ...props });
      try {
        const r = await vault.write(path, text, null);
        saved(r.path, r.text);
        return r.path;
      } catch (e) {
        toast(isConflict(e) ? 'A note with that name appeared meanwhile. Try again.' : `Couldn’t create the note: ${messageOf(e)}`);
        return null;
      }
    },
    [saved],
  );

  const renameProject = useCallback(
    async (from: string, to: string) => {
      const affected = [...filesRef.current.entries()].filter(([path, file]) => parseNote(path, file.text, file.mtime).project === from);
      try {
        for (const [path, file] of affected) {
          const text = setNoteProps(file.text, { project: to });
          const result = await vault.write(path, text, file.text);
          saved(result.path, result.text);
        }
        const nextCollections = loadCollections().map((collection) => collection.filter.project === from ? { ...collection, filter: { ...collection.filter, project: to } } : collection);
        setCollections(nextCollections);
        localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(nextCollections));
        return true;
      } catch (e) {
        toast(`The project was renamed, but some note links could not follow it: ${messageOf(e)}`);
        void refresh();
        return false;
      }
    },
    [refresh, saved],
  );

  const keep = (list: Collection[]) => {
    setCollections(list);
    try {
      localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(list));
    } catch {
      // Not remembered this time.
    }
  };
  const saveCollection = useCallback((name: string, filter: NoteFilter) => {
    const c: Collection = { id: `c${Date.now().toString(36)}`, name: name.trim() || 'Collection', filter };
    keep([...loadCollections(), c]);
    return c;
  }, []);
  const renameCollection = useCallback((id: string, name: string) => keep(loadCollections().map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c))), []);
  const deleteCollection = useCallback((id: string) => keep(loadCollections().filter((c) => c.id !== id)), []);

  const value = useMemo<NotesValue>(
    () => ({ notes, byPath, images, loading, error, create, renameProject, saved, refresh, forget, collections, saveCollection, renameCollection, deleteCollection }),
    [notes, byPath, images, loading, error, create, renameProject, saved, refresh, forget, collections, saveCollection, renameCollection, deleteCollection],
  );
  return <NotesCtx.Provider value={value}>{children}</NotesCtx.Provider>;
}

export function useNotes(): NotesValue {
  const v = useContext(NotesCtx);
  if (!v) throw new Error('useNotes outside NotesProvider');
  return v;
}

/** For places that may render outside the provider (the task sheet in tests). */
export function useNotesMaybe(): NotesValue | null {
  return useContext(NotesCtx);
}
