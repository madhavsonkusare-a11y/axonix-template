/**
 * Tasks state: the files, the tasks read from them, and every change.
 *
 * Mounted above the launcher (in `App`), like Finance, so the Home tile shows
 * live figures.
 *
 * Changes are optimistic — the board moves at once — and written one at a
 * time, in order, each naming the text it replaces. If a file changed on disk
 * in the meantime (an edit in Obsidian), the folder is read again and the
 * change re-applied to the new text once; if that fails too, the change is
 * rolled back and the page says so. Undo walks back through recent changes by
 * restoring the files as they were, never by deleting anything: undoing a new
 * task moves its file to the trash.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { isConflict, tasksBackend } from './backend';
import { applyPatch, newTaskId, newTaskText, parseTask, pathFor, sanitizeName, stampNow } from './taskfile';
import { byOrder } from './derive';
import type { RawFile, Task, TaskDraft, TaskPatch } from './types';

export type SaveStatus = { state: 'idle' } | { state: 'saved'; at: Date } | { state: 'error'; message: string };

/** One file before and after a change. `trashed` is where a file went when it was moved to the trash. */
interface Effect {
  before: { path: string; text: string } | null;
  after: { path: string; text: string } | null;
  trashed?: string;
}

interface Change {
  id: number;
  effects: Effect[];
}

export interface TasksValue {
  loading: boolean;
  loadError: string | null;
  root: string;
  tasks: Task[];
  byId: Map<string, Task>;
  /** Project folders, sorted, including empty ones. Never includes the Inbox (''). */
  projects: string[];
  save: SaveStatus;
  retry: () => void;
  /** Resolves to the change number (for Undo), or null when nothing was saved. */
  create: (draft: TaskDraft) => Promise<number | null>;
  update: (id: string, patch: TaskPatch) => Promise<number | null>;
  /** Several tasks at once, as one change (one Undo). */
  updateMany: (changes: { id: string; patch: TaskPatch }[]) => Promise<number | null>;
  /** Changes made elsewhere (Google Calendar moved a block): written like any other, but not offered for Undo. */
  applyRemote: (changes: { id: string; patch: TaskPatch }[]) => Promise<number | null>;
  trash: (id: string) => Promise<number | null>;
  /** Moves several tasks to the trash as one change, so one Undo brings them all back. */
  trashMany: (ids: string[]) => Promise<number | null>;
  createProject: (name: string) => Promise<boolean>;
  /** Renames the project folder and every task inside it. Resolves to the sanitized name. */
  renameProject: (from: string, to: string) => Promise<string | null>;
  /** A task's id now: files that had none get one on their first change. */
  resolveId: (id: string) => string;
  /** Undo change `change`, or the latest one. Only the latest can be undone. */
  undo: (change?: number) => void;
  lastChange: number | null;
  openInObsidian: (id: string) => void;
  showInFolder: (id?: string) => void;
}

/** Exported so Scrub can show the same tasks as of another day (next/scrub/Lens.tsx). */
export const TasksContext = createContext<TasksValue | null>(null);

const messageOf = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export function TasksStateProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<Map<string, RawFile>>(() => new Map());
  const [folders, setFolders] = useState<string[]>([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveStatus>({ state: 'idle' });
  const [lastChange, setLastChange] = useState<number | null>(null);

  const filesRef = useRef(files);
  const setFilesBoth = useCallback((next: Map<string, RawFile>) => {
    filesRef.current = next;
    setFiles(next);
  }, []);

  // Every write, refresh and undo runs through this chain, one at a time.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(job, job);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  const history = useRef<Change[]>([]);
  const counter = useRef(0);
  // A file with no id is known by its path until its first change gives it one.
  const aliases = useRef(new Map<string, string>());
  const resolveId = useCallback((id: string) => aliases.current.get(id) ?? id, []);

  /* ---------- reading ---------- */

  const refresh = useCallback(async () => {
    const listing = await tasksBackend.list();
    setRoot(listing.root);
    setFolders(listing.folders);
    setFilesBoth(new Map(listing.files.map((f) => [f.path, f])));
  }, [setFilesBoth]);

  useEffect(() => {
    let live = true;
    enqueue(refresh)
      .catch((e) => live && setLoadError(messageOf(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [enqueue, refresh]);

  // The folder changed on disk: read it again once pending writes are done, so
  // an edit made in Obsidian shows up here within a moment.
  const refreshSoon = useRef<number | null>(null);
  useEffect(
    () =>
      tasksBackend.onChanged(() => {
        if (refreshSoon.current !== null) return;
        refreshSoon.current = window.setTimeout(() => {
          refreshSoon.current = null;
          void enqueue(refresh).catch(() => undefined);
        }, 60);
      }),
    [enqueue, refresh],
  );

  const tasks = useMemo(() => [...files.values()].map(parseTask).sort(byOrder), [files]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const projects = useMemo(() => {
    const set = new Set(folders);
    for (const t of tasks) if (t.project) set.add(t.project);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [folders, tasks]);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  /* ---------- writing ---------- */

  /** Optimistically replace files in memory. */
  const apply = useCallback(
    (effects: Effect[], direction: 'forward' | 'back') => {
      const next = new Map(filesRef.current);
      for (const e of effects) {
        const from = direction === 'forward' ? e.before : e.after;
        const to = direction === 'forward' ? e.after : e.before;
        if (from) next.delete(from.path);
        if (to) next.set(to.path, { path: to.path, text: to.text, mtime: Date.now() });
      }
      setFilesBoth(next);
    },
    [setFilesBoth],
  );

  /** Put effects on disk. Throws on the first failure. */
  const persist = useCallback(async (effects: Effect[]) => {
    for (const e of effects) {
      if (e.before && e.after) {
        if (e.before.path !== e.after.path) {
          await tasksBackend.rename(e.before.path, e.after.path, e.before.text);
          if (e.after.text !== e.before.text) await tasksBackend.write(e.after.path, e.after.text, e.before.text);
        } else if (e.after.text !== e.before.text) {
          await tasksBackend.write(e.after.path, e.after.text, e.before.text);
        }
      } else if (e.after) {
        await tasksBackend.write(e.after.path, e.after.text, null);
      } else if (e.before) {
        e.trashed = await tasksBackend.trash(e.before.path, e.before.text);
      }
    }
  }, []);

  const failed = useCallback((e: unknown) => {
    const conflict = isConflict(e);
    setSave({
      state: 'error',
      message: conflict ? 'A task file changed on disk while this change was being saved, so it was not applied.' : messageOf(e),
    });
  }, []);

  /**
   * Run a change: `plan` turns the current files into effects. It runs once
   * against memory (the optimistic view) and, if the disk disagrees, once more
   * against a fresh read.
   */
  const run = useCallback(
    (plan: (current: Task[]) => Effect[] | null, record = true): Promise<number | null> => {
      if (loadError) {
        toast('The Tasks folder could not be read, so nothing is saved this session.');
        return Promise.resolve(null);
      }
      let effects: Effect[] | null;
      try {
        // Planned against the files as they are this instant (optimistic), not
        // the last render: two changes in one tick must see each other.
        effects = plan([...filesRef.current.values()].map(parseTask));
      } catch (e) {
        toast(messageOf(e));
        return Promise.resolve(null);
      }
      if (!effects || !effects.length) return Promise.resolve(null);
      apply(effects, 'forward');
      const change = ++counter.current;

      return enqueue(async () => {
        try {
          await persist(effects!);
        } catch (e) {
          if (!isConflict(e)) {
            apply(effects!, 'back');
            await refresh().catch(() => undefined);
            failed(e);
            return null;
          }
          // Read the folder again and re-apply the change to what is there now.
          await refresh();
          const again = plan([...filesRef.current.values()].map(parseTask));
          if (!again || !again.length) {
            failed(e);
            return null;
          }
          apply(again, 'forward');
          try {
            await persist(again);
            effects = again;
          } catch (e2) {
            await refresh().catch(() => undefined);
            failed(e2);
            return null;
          }
        }
        setSave({ state: 'saved', at: new Date() });
        if (record) {
          history.current = [...history.current.slice(-19), { id: change, effects: effects! }];
          setLastChange(change);
        }
        return change;
      });
    },
    [apply, enqueue, failed, loadError, persist, refresh],
  );

  const takenPaths = () => filesRef.current.keys();

  /** The effect of patching one task, against `current`. */
  const effectFor = useCallback((current: Task[], id: string, patch: TaskPatch, now: string, extraTaken: string[] = []): Effect | null => {
    const task = current.find((t) => t.id === id);
    if (!task) throw new Error('That task is no longer in the Tasks folder.');
    if (task.broken) throw new Error(`${task.title}: ${task.broken} Fix it in Obsidian first.`);
    const file = filesRef.current.get(task.path);
    if (!file) throw new Error('That task is no longer in the Tasks folder.');

    const full: TaskPatch = { ...patch };
    if (patch.state && patch.state !== task.state) {
      if (patch.state === 'doing' && !task.started) full.started = now;
      if (patch.state === 'done') full.done = now;
      if (task.state === 'done' && patch.state !== 'done') full.done = null;
    }

    const title = patch.title?.trim() || task.title;
    const project = patch.project ?? task.project;
    const renamed = title !== task.title || project !== task.project;
    const path = renamed ? pathFor(project, title, [...takenPaths(), ...extraTaken], task.path) : task.path;
    const titleField = renamed ? (sanitizeName(title) !== title ? title : null) : undefined;
    const { title: _t, project: _p, ...fields } = full;
    let newId: string | undefined;
    if (task.id.startsWith('path:')) {
      newId = aliases.current.get(task.id) ?? newTaskId();
      aliases.current.set(task.id, newId);
    }
    const text = applyPatch(file.text, fields, { id: newId, title: titleField });
    if (path === task.path && text === file.text) return null;
    return { before: { path: task.path, text: file.text }, after: { path, text } };
  }, []);

  const planMany = useCallback(
    (changes: { id: string; patch: TaskPatch }[]) =>
      (current: Task[]) => {
        const now = stampNow();
        const effects: Effect[] = [];
        const planned: string[] = [];
        for (const c of changes) {
          const e = effectFor(current, c.id, c.patch, now, planned);
          if (e) {
            effects.push(e);
            if (e.after) planned.push(e.after.path);
          }
        }
        return effects;
      },
    [effectFor],
  );
  const updateMany = useCallback((changes: { id: string; patch: TaskPatch }[]) => run(planMany(changes)), [planMany, run]);
  const applyRemote = useCallback((changes: { id: string; patch: TaskPatch }[]) => run(planMany(changes), false), [planMany, run]);

  const update = useCallback((id: string, patch: TaskPatch) => updateMany([{ id, patch }]), [updateMany]);

  const create = useCallback(
    (draft: TaskDraft) =>
      run((current) => {
        const title = draft.title.trim();
        if (!title) throw new Error('Type a title first.');
        const state = draft.state ?? 'todo';
        // New tasks go to the top of their column.
        const column = current.filter((t) => t.state === state && t.order !== undefined);
        const top = column.length ? Math.min(...column.map((t) => t.order!)) : 1024;
        const id = newTaskId();
        const path = pathFor(draft.project ?? '', title, takenPaths());
        const text = applyPatch(newTaskText({ ...draft, title, state }, id), { order: top - 1024 });
        return [{ before: null, after: { path, text } }];
      }),
    [run],
  );

  const trash = useCallback(
    (id: string) =>
      run((current) => {
        const task = current.find((t) => t.id === id);
        const file = task && filesRef.current.get(task.path);
        if (!task || !file) throw new Error('That task is no longer in the Tasks folder.');
        return [{ before: { path: task.path, text: file.text }, after: null }];
      }),
    [run],
  );

  const trashMany = useCallback(
    (ids: string[]) =>
      run((current) => {
        const effects = ids.flatMap((id) => {
          const task = current.find((t) => t.id === id);
          const file = task && filesRef.current.get(task.path);
          return task && file ? [{ before: { path: task.path, text: file.text }, after: null }] : [];
        });
        if (!effects.length) throw new Error('Those tasks are no longer in the Tasks folder.');
        return effects;
      }),
    [run],
  );

  const createProject = useCallback(
    async (name: string) => {
      const clean = sanitizeName(name);
      if (projects.some((p) => p.toLowerCase() === clean.toLowerCase())) return true;
      try {
        await enqueue(() => tasksBackend.mkdir(clean));
        setFolders((f) => [...f, clean]);
        return true;
      } catch (e) {
        toast(`Couldn’t create the project: ${messageOf(e)}`);
        return false;
      }
    },
    [enqueue, projects],
  );

  const renameProject = useCallback(
    async (from: string, to: string) => {
      if (!to.trim()) {
        toast('Type a project name first.');
        return null;
      }
      const clean = sanitizeName(to);
      if (clean === from) return clean;
      if (projects.some((project) => project !== from && project.toLowerCase() === clean.toLowerCase())) {
        toast('A project with that name already exists.');
        return null;
      }
      try {
        await enqueue(() => tasksBackend.renameProject(from, clean));
        await refresh();
        return clean;
      } catch (e) {
        toast(`Couldn’t rename the project: ${messageOf(e)}`);
        return null;
      }
    },
    [enqueue, projects, refresh],
  );

  /* ---------- undo ---------- */

  const undo = useCallback(
    (change?: number) => {
      const last = history.current[history.current.length - 1];
      if (!last || (change !== undefined && change !== last.id)) {
        toast(change !== undefined ? 'That can’t be undone any more — something else changed after it.' : 'Nothing to undo.');
        return;
      }
      history.current = history.current.slice(0, -1);
      setLastChange(history.current[history.current.length - 1]?.id ?? null);
      const effects = last.effects;
      apply(effects, 'back');
      void enqueue(async () => {
        try {
          for (const e of [...effects].reverse()) {
            if (e.before && e.after) {
              if (e.before.path !== e.after.path) {
                await tasksBackend.rename(e.after.path, e.before.path, e.after.text);
                if (e.after.text !== e.before.text) await tasksBackend.write(e.before.path, e.before.text, e.after.text);
              } else if (e.after.text !== e.before.text) {
                await tasksBackend.write(e.before.path, e.before.text, e.after.text);
              }
            } else if (e.after) {
              // Undoing a new task: it goes to the trash, never away.
              await tasksBackend.trash(e.after.path, e.after.text);
            } else if (e.before && e.trashed) {
              await tasksBackend.restore(e.trashed, e.before.path);
            }
          }
          setSave({ state: 'saved', at: new Date() });
        } catch (e) {
          await refresh().catch(() => undefined);
          toast(isConflict(e) ? 'Couldn’t undo: the file changed on disk since.' : `Couldn’t undo: ${messageOf(e)}`);
        }
      });
    },
    [apply, enqueue, refresh],
  );

  const retry = useCallback(() => {
    void enqueue(refresh)
      .then(() => setSave({ state: 'idle' }))
      .catch((e) => failed(e));
  }, [enqueue, failed, refresh]);

  const openInObsidian = useCallback((id: string) => {
    const t = tasksRef.current.find((x) => x.id === id);
    if (t) tasksBackend.openInObsidian(t.path);
  }, []);
  const showInFolder = useCallback((id?: string) => {
    const t = id ? tasksRef.current.find((x) => x.id === id) : undefined;
    tasksBackend.showInFolder(t?.path);
  }, []);

  const value = useMemo<TasksValue>(
    () => ({
      loading,
      loadError,
      root,
      tasks,
      byId,
      projects,
      save,
      retry,
      create,
      update,
      updateMany,
      applyRemote,
      trash,
      trashMany,
      createProject,
      renameProject,
      resolveId,
      undo,
      lastChange,
      openInObsidian,
      showInFolder,
    }),
    [loading, loadError, root, tasks, byId, projects, save, retry, create, update, updateMany, applyRemote, trash, trashMany, createProject, renameProject, resolveId, undo, lastChange, openInObsidian, showInFolder],
  );
  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksValue {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error('useTasks must be used within TasksStateProvider');
  return ctx;
}
