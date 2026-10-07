/**
 * Lift: hold anything and it comes off the page as glass.
 *
 * **Anything.** A row that names its thing (`liftAttrs`) lifts as soon as the
 * pointer moves. Everything else on the page lifts when it is held still: a
 * card, a chart, a figure, a heading, a sidebar entry, a panel, an image, the
 * words you have selected, a whole view (`resolve.ts` reads what it is off the
 * page). A file, a link, an image or text dragged in from outside the window
 * is held the same way. While something is held, every place that will take it
 * is outlined, and the place under the pointer says what a drop will do there.
 * Let go over nothing and it goes home.
 *
 * Where a thing can go, and what happens (`data-drop`):
 *
 *   pocket              kept in the dock, to carry into another module. A
 *                       picture from outside is kept in the Storeroom first.
 *   mark                search for it (Ctrl K opens with its name)
 *   mod:tasks           a task about it (linked to it, if it has a home)
 *   mod:notes           a note about it, or holding it
 *   mod:calendar        time blocked today, at the next free half hour
 *   mod:storeroom       kept as a reference (a link, a picture, words)
 *   mod:finance         a statement file is opened for import
 *   day:YYYY-MM-DD      time blocked on that day at the hour under the pointer
 *   date:YYYY-MM-DD     due that day (a task), or a task about it due that day
 *   project:NAME        moved to that project (a task), or a task about it there
 *   another thing       the two are linked (any `liftAttrs` row, or a place
 *                       that names one: `thing:kind:id` with `data-drop-title`).
 *                       Words, a link or a file dropped on a task go into its
 *                       notes instead: a link needs both ends to have a home.
 *
 * Every drop that changes something says so in a toast with Undo. Nothing is
 * changed by picking a thing up or by carrying it.
 *
 * While something is held, a panel stops being modal (`Sheet` hears
 * `axonix:lift-begin`), so a thing can be carried out of a panel to the page
 * or the dock.
 *
 * Lift is off on a first-version screen, while the command bar is open, and
 * while the day being shown is not today (the workspace is then for looking).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, isoOf } from '../../finance/format';
import { useLiquidGlass } from '../../finance/components/Liquid';
import { useNotes } from '../../notes/NotesContext';
import { composeNote, discardNote } from '../../notes/compose';
import { storeroomBackend } from '../../storeroom/backend';
import { acceptedFile, classifyText, urlsIn, type Intake } from '../../storeroom/capture';
import { keepInStoreroom, keepPath, type Kept } from '../../storeroom/keep';
import { useTasks } from '../../tasks/TasksContext';
import { projectLabel } from '../../tasks/derive';
import type { Task, TaskDraft } from '../../tasks/types';
import { DAY_MIN, HOUR, SNAP, clamp, clock, snap } from '../calendar/time';
import { shortDay, useAsOf } from '../scrub/Scrub';
import { findLiftable } from './resolve';
import { KIND_ICON, fileThing, imageThing, isLoose, keyOf, linkThing, parseKey, refThing, taskThing, textOf, textThing, thingOf, type Thing } from './things';
import { useWorkspace } from './Workspace';

/** A named thing with a drag of its own lifts after this long held still. */
const HOLD_MS = 280;
/** Anything else: long enough that a slow click is still a click. */
const HOLD_ANY_MS = 450;
/** The hold shows itself from here on, so a quick click shows nothing. */
const CHARGE_AFTER_MS = 150;
const SLOP = 6;
/** Bank statements Finance can read. */
const STATEMENT = /\.(csv|pdf)$/i;
const TEXT_FILE = /\.(md|markdown|txt)$/i;
const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
/** How many things one drop from outside may carry. */
const OUTSIDE_MAX = 12;
/** Places with their own way of taking a drop: the Storeroom's page, an editor, a field. */
const OWN_DROP = '.nxs-root, dialog, [contenteditable=""], [contenteditable="true"], affine-editor-container, .nxn-doc, input, textarea, webview';

const GHOST_GLASS = {
  material: 'regular' as const,
  borderRadius: 14,
  blur: 14,
  saturation: 1.5,
  tintOpacity: 0.2,
  refractionStrength: 12,
  bezelWidth: 14,
  thickness: 12,
  chromaticAberration: 0.12,
  edgeHighlight: 0.7,
  specularStrength: 0.2,
  elevation: 2,
  quality: 'medium' as const,
};

interface LiftValue {
  /** Opens a thing where it lives. */
  open: (thing: Thing) => void;
}
const Ctx = createContext<LiftValue>({ open: () => {} });
export const useLift = () => useContext(Ctx);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ---------- what a drop means ---------- */

function accepts(drop: string, thing: Thing, fromPocket: boolean, statement = false): boolean {
  const k = thing.kind;
  if (drop === 'pocket') return !fromPocket;
  if (drop === 'mark') return true;
  if (drop === 'mod:tasks') return k !== 'task' && k !== 'day' && k !== 'project' && k !== 'tag';
  if (drop === 'mod:notes') return k !== 'note' && k !== 'image' && (k !== 'file' || TEXT_FILE.test(thing.title));
  if (drop === 'mod:calendar' || drop.startsWith('day:')) return k !== 'day' && k !== 'project' && k !== 'tag';
  if (drop === 'mod:storeroom') return k === 'link' || k === 'image' || k === 'text' || (k === 'file' && PICTURE.test(thing.title));
  if (drop === 'mod:finance') return statement || (k === 'file' && STATEMENT.test(thing.title));
  if (drop.startsWith('date:')) return k !== 'day' && k !== 'project' && k !== 'tag';
  if (drop.startsWith('project:')) return k !== 'day' && k !== 'project' && k !== 'tag';
  if (drop.startsWith('thing:')) {
    if (drop.slice(6) === keyOf(thing)) return false;
    // Words, a link or a file have no home to link from: on a task they go into its notes.
    return isLoose(thing) ? drop.startsWith('thing:task:') : true;
  }
  return false;
}

/** The title of a task made from something else. */
function taskTitle(thing: Thing): string {
  switch (thing.kind) {
    case 'txn':
      return `Follow up on ${thing.title}${thing.amount ? ` (${thing.amount.replace(/^[−-]/, '')})` : ''}`;
    case 'event':
      return `Prepare for ${thing.title}`;
    case 'ref':
      return `Use “${thing.title}”`;
    case 'link':
      return `Read ${thing.title}`;
    case 'file':
    case 'image':
      return `Look at ${thing.title}`;
    case 'part':
      return `Review ${thing.title}`;
    case 'account':
    case 'method':
    case 'category':
    case 'budget':
    case 'subscription':
    case 'id':
      return `Check ${thing.title}`;
    default:
      return clip(thing.title, 120);
  }
}

/** What goes in the task's notes: whatever the title does not already say. */
function taskBody(thing: Thing): string | undefined {
  if (thing.url) return thing.url;
  if (thing.path) return thing.path;
  if (thing.kind === 'text' || thing.kind === 'part') {
    const text = textOf(thing);
    return text.length > thing.title.length + 2 ? text : undefined;
  }
  return undefined;
}

const minuteAt = (el: Element, y: number) => clamp(snap(((y - el.getBoundingClientRect().top) / HOUR) * 60 - SNAP), 0, DAY_MIN - SNAP);

/** The next half hour today that no time block covers; tomorrow morning when the day is nearly over. */
function nextFree(tasks: Task[], length: number): string {
  const now = new Date();
  const today = isoOf(now);
  const taken = tasks
    .filter((t) => t.scheduled?.slice(0, 10) === today && t.state !== 'done')
    .map((t) => {
      const start = Number(t.scheduled!.slice(11, 13)) * 60 + Number(t.scheduled!.slice(14, 16));
      return [start, start + (t.estimate ?? 30)] as const;
    });
  for (let m = Math.ceil((now.getHours() * 60 + now.getMinutes() + 5) / 30) * 30; m + length <= 22 * 60; m += 30) {
    if (!taken.some(([a, b]) => m < b && m + length > a)) return `${today}T${clock(m)}`;
  }
  return `${addDays(today, 1)}T09:00`;
}

const whenLabel = (stamp: string) => {
  const today = isoOf(new Date());
  const day = stamp.slice(0, 10);
  return `${day === today ? 'today' : day === addDays(today, 1) ? 'tomorrow' : shortDay(day)} at ${stamp.slice(11, 16)}`;
};

/* ---------- things from outside the window ---------- */

interface Carried {
  thing: Thing;
  /** The file itself, when a file was dragged in. */
  file?: File;
}

const carriesAnything = (data: DataTransfer | null) => {
  const types = data ? [...data.types] : [];
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
};

/** What is known while it is still in the air: how many, and of what sort. The contents come with the drop. */
function inTheAir(data: DataTransfer): { thing: Thing; statement: boolean; count: number } {
  const types = [...data.types];
  const from = 'From outside Axonix';
  if (types.includes('Files')) {
    const items = [...data.items].filter((i) => i.kind === 'file');
    const n = Math.max(1, items.length);
    const pictures = items.length > 0 && items.every((i) => /^(image|video)\//.test(i.type));
    const statement = items.some((i) => /pdf|csv|comma-separated/.test(i.type));
    return { thing: { kind: pictures ? 'image' : 'file', id: 'outside', title: n === 1 ? (pictures ? 'A picture' : 'A file') : `${n} ${pictures ? 'pictures' : 'files'}`, sub: from }, statement, count: n };
  }
  if (types.includes('text/uri-list')) return { thing: { kind: 'link', id: 'outside', title: 'A link', sub: from }, statement: false, count: 1 };
  return { thing: { kind: 'text', id: 'outside', title: 'Text', sub: from }, statement: false, count: 1 };
}

/** What a drop carried, best form first. */
function fromOutside(data: DataTransfer): Carried[] {
  const files = [...data.files];
  if (files.length) return files.slice(0, OUTSIDE_MAX).map((file) => ({ thing: fileThing(file.name || 'File', storeroomBackend.pathForFile(file), acceptedFile(file)), file }));
  const list = data
    .getData('text/uri-list')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'));
  const web = list.filter((u) => /^https?:\/\//i.test(u));
  if (web.length) return web.slice(0, OUTSIDE_MAX).map((url) => ({ thing: PICTURE.test(url) ? imageThing(url) : linkThing(url) }));
  const text = data.getData('text/plain');
  if (!text.trim()) return [];
  const urls = urlsIn(text);
  if (urls) return urls.slice(0, OUTSIDE_MAX).map((url) => ({ thing: PICTURE.test(url) ? imageThing(url) : linkThing(url) }));
  return [{ thing: textThing(text, 'Dropped in') }];
}

interface Held {
  thing: Thing;
  /** The element it was lifted from. None when it came from outside the window. */
  src: HTMLElement | null;
  fromPocket: boolean;
  outside: boolean;
  /** From outside, and one of the files looks like a bank statement. */
  statement: boolean;
  /** Pointer. */
  px: number;
  py: number;
  /** The ghost, which trails the pointer on a spring. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  height: number;
  target: HTMLElement | null;
  drop: string | null;
  raf: number;
}

export default function LiftLayer({
  onOpen,
  onImport,
  onSearch,
  children,
}: {
  /** Opens a thing where it lives. */
  onOpen: (thing: Thing) => void;
  /** Opens Finance's statement import on a file. */
  onImport?: (file: File) => void;
  /** Opens search with these words in it: a thing dropped on the mark. */
  onSearch?: (words: string) => void;
  children: ReactNode;
}) {
  const tasks = useTasks();
  const notes = useNotes();
  const ws = useWorkspace();
  const asOf = useAsOf();
  const [shown, setShown] = useState<Thing | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const charge = useRef<HTMLElement>(null);
  useLiquidGlass(glass, GHOST_GLASS, shown !== null);

  // The listeners below live for the life of the app; they read what is current through this.
  const live = useRef({ tasks, notes, ws, asOf, onOpen, onImport, onSearch });
  live.current = { tasks, notes, ws, asOf, onOpen, onImport, onSearch };

  /* ---------- what each drop does ---------- */

  /** Makes a task and resolves to it, once the task list has it. */
  const makeTask = useCallback(async (draft: TaskDraft): Promise<{ task: Task | null; change: number } | null> => {
    const before = new Set(live.current.tasks.tasks.map((t) => t.id));
    const change = await live.current.tasks.create(draft);
    if (change === null) return null;
    for (let i = 0; i < 30; i++) {
      const made = live.current.tasks.tasks.find((t) => !before.has(t.id) && t.title === draft.title);
      if (made) return { task: made, change };
      await new Promise((r) => setTimeout(r, 50));
    }
    return { task: null, change };
  }, []);

  /** A task about `thing`, linked to it where it has a home, with Undo and Open. */
  const taskAbout = useCallback(
    async (thing: Thing, extra: Partial<TaskDraft>, said: (task: Task | null) => string) => {
      const made = await makeTask({ title: taskTitle(thing), project: '', body: taskBody(thing), ...extra });
      if (!made) return;
      const link = made.task && !isLoose(thing) ? live.current.ws.link(thing, taskThing(made.task)) : null;
      toast(said(made.task), {
        description: made.task?.title ?? taskTitle(thing),
        action: {
          label: 'Undo',
          onClick: () => {
            live.current.tasks.undo(made.change);
            if (link) live.current.ws.unlink(link.id);
          },
        },
        cancel: made.task ? { label: 'Open', onClick: () => live.current.onOpen(taskThing(made.task!)) } : undefined,
      });
    },
    [makeTask],
  );

  /** Says what came of keeping something in the Storeroom. Resolves to the reference, when there is one. */
  const announce = useCallback((result: Kept, also = '') => {
    const item = result.kept[0] ?? result.again[0];
    if (result.kept.length === 1) toast(`Kept ${item.id}${also}`, { description: item.title, action: { label: 'Open', onClick: () => live.current.onOpen(refThing(item)) } });
    else if (result.kept.length > 1) toast(`Kept ${result.kept.length} references${also}`, { description: result.kept.map((i) => i.id).join(' · ') });
    else if (result.again.length) toast(`Already kept as ${item.id}`, { description: item.title, action: { label: 'Open', onClick: () => live.current.onOpen(refThing(item)) } });
    if (result.failed.length) toast(result.failed.length === 1 ? 'Could not keep that' : `Could not keep ${result.failed.length} of them`, { description: result.failed[0] });
    return item ?? null;
  }, []);

  /** Keeps a loose thing in the Storeroom, in its best form. */
  const keepLoose = useCallback(async (thing: Thing, file?: File): Promise<Kept> => {
    if (file) return keepInStoreroom([{ type: 'file', file }], 'lift');
    if (thing.url) return keepInStoreroom([{ type: 'url', url: thing.url }], 'lift');
    if (thing.path) return keepPath(thing.path, 'lift');
    const list: Intake[] = classifyText(textOf(thing));
    return keepInStoreroom(list, 'lift');
  }, []);

  const perform = useCallback(
    (drop: string, thing: Thing, el: HTMLElement, y: number, file?: File) => {
      const { tasks: T, notes: N, ws: W } = live.current;
      const own = thing.kind === 'task' ? T.byId.get(thing.id) : undefined;
      const loose = isLoose(thing);

      if (drop === 'pocket') {
        // A picture from outside has no home yet: the Storeroom gives it one, and that is what is carried.
        if (file && acceptedFile(file)) {
          void keepLoose(thing, file).then((result) => {
            const item = announce(result, ', and it is in the Pocket');
            if (item) W.keep(refThing(item));
          });
          return;
        }
        if (!W.keep(thing)) toast('Already in the Pocket.');
        return;
      }
      if (drop === 'mark') {
        live.current.onSearch?.(thing.title);
        return;
      }
      if (drop === 'mod:finance') {
        if (file && live.current.onImport) live.current.onImport(file);
        else toast('Drag the statement in from its folder to import it.');
        return;
      }
      if (drop === 'mod:storeroom') {
        void keepLoose(thing, file).then((result) => announce(result));
        return;
      }
      if (drop === 'mod:tasks') {
        void taskAbout(thing, {}, () => 'Task added');
        return;
      }
      if (drop === 'mod:notes') {
        void (async () => {
          const project = own?.project ?? '';
          const title = clip(thing.title, 80);
          let body: string | undefined;
          if (file) body = (await file.text()).slice(0, 400_000);
          else if (thing.kind === 'link') body = thing.text;
          else if (thing.kind === 'text') body = textOf(thing);
          else if (thing.kind === 'part') body = `${textOf(thing)}\n\nFrom ${thing.sub ?? 'Axonix'}, ${shortDay(isoOf(new Date()))}.`;
          const made = await composeNote(N, { title: file ? title.replace(TEXT_FILE, '') : title, project, body });
          const note: Thing = { kind: 'note', id: made.path, title, sub: project || 'Note' };
          const link = loose ? null : W.link(thing, note);
          toast(body ? 'Note made' : 'Note started', {
            description: title,
            action: {
              label: 'Undo',
              onClick: () =>
                void discardNote(live.current.notes, made)
                  .then(() => {
                    if (link) live.current.ws.unlink(link.id);
                  })
                  .catch((e) => toast(`Could not undo: ${e instanceof Error ? e.message : String(e)}`)),
            },
            cancel: { label: 'Open', onClick: () => live.current.onOpen(note) },
          });
        })().catch((e) => toast(`Could not make the note: ${e instanceof Error ? e.message : String(e)}`));
        return;
      }
      if (drop === 'mod:calendar' || drop.startsWith('day:')) {
        const length = own?.estimate ?? 30;
        const scheduled = drop === 'mod:calendar' ? nextFree(T.tasks, length) : `${drop.slice(4)}T${clock(Math.min(minuteAt(el, y), DAY_MIN - length))}`;
        if (own) {
          void T.update(own.id, { scheduled, estimate: length }).then((change) => {
            if (change !== null) toast(`Blocked ${whenLabel(scheduled)}`, { description: own.title, action: { label: 'Undo', onClick: () => live.current.tasks.undo(change) } });
          });
        } else {
          void taskAbout(thing, { scheduled, estimate: 30 }, () => `Blocked ${whenLabel(scheduled)}`);
        }
        return;
      }
      if (drop.startsWith('date:')) {
        const due = drop.slice(5);
        if (own) {
          void T.update(own.id, { due }).then((change) => {
            if (change !== null) toast(`Due ${shortDay(due)}`, { description: own.title, action: { label: 'Undo', onClick: () => live.current.tasks.undo(change) } });
          });
        } else {
          void taskAbout(thing, { due }, () => `Task added, due ${shortDay(due)}`);
        }
        return;
      }
      if (drop.startsWith('project:')) {
        const project = drop.slice(8);
        if (own) {
          if (own.project === project) return;
          void T.update(own.id, { project }).then((change) => {
            if (change !== null) toast(`Moved to ${projectLabel(project)}`, { description: own.title, action: { label: 'Undo', onClick: () => live.current.tasks.undo(change) } });
          });
        } else {
          void taskAbout(thing, { project }, () => `Task added to ${projectLabel(project)}`);
        }
        return;
      }
      if (drop.startsWith('thing:')) {
        // A row says what it is; a place that only names a thing (an open note) gives its key and a title.
        const named = parseKey(drop.slice(6));
        const other = thingOf(el) ?? (named ? { ...named, title: el.dataset.dropTitle ?? 'this' } : null);
        if (!other) return;
        if (loose) {
          // Into the task's notes, under what is already there.
          const task = T.byId.get(T.resolveId(other.id));
          if (!task) return;
          const add = thing.url ?? thing.path ?? textOf(thing);
          const body = `${task.body.replace(/\s+$/, '')}${task.body.trim() ? '\n\n' : ''}${add}\n`;
          void T.update(task.id, { body }).then((change) => {
            if (change !== null) toast('Added to the task’s notes', { description: task.title, action: { label: 'Undo', onClick: () => live.current.tasks.undo(change) }, cancel: { label: 'Open', onClick: () => live.current.onOpen(taskThing(task)) } });
          });
          return;
        }
        const link = W.link(thing, other);
        if (!link) {
          toast('Those two are already linked.');
          return;
        }
        toast('Linked', { description: `${thing.title} ↔ ${other.title}`, action: { label: 'Undo', onClick: () => live.current.ws.unlink(link.id) } });
      }
    },
    [taskAbout, keepLoose, announce],
  );

  /** What the pill under the lifted thing says, for the place under the pointer. */
  const say = useCallback((drop: string, thing: Thing, el: HTMLElement, y: number, outsidePicture: boolean): string => {
    const isTask = thing.kind === 'task';
    const loose = isLoose(thing);
    if (drop === 'pocket') return outsidePicture ? 'Keep in the Storeroom and the Pocket' : 'Keep in the Pocket';
    if (drop === 'mark') return 'Search for this';
    if (drop === 'mod:tasks') return loose || thing.kind === 'part' ? 'Make a task from this' : 'Make a task';
    if (drop === 'mod:notes') return thing.kind === 'text' || thing.kind === 'file' || thing.kind === 'part' ? 'Make a note of this' : 'Start a note about this';
    if (drop === 'mod:storeroom') return 'Keep in the Storeroom';
    if (drop === 'mod:finance') return 'Import this statement';
    if (drop === 'mod:calendar') {
      const own = isTask ? live.current.tasks.byId.get(thing.id) : undefined;
      return `Block time ${whenLabel(nextFree(live.current.tasks.tasks, own?.estimate ?? 30))}`;
    }
    if (drop.startsWith('day:')) return `Block ${shortDay(drop.slice(4))} ${clock(minuteAt(el, y))}`;
    if (drop.startsWith('date:')) return isTask ? `Due ${shortDay(drop.slice(5))}` : `Make a task due ${shortDay(drop.slice(5))}`;
    if (drop.startsWith('project:')) return isTask ? `Move to ${projectLabel(drop.slice(8))}` : `Make a task in ${projectLabel(drop.slice(8))}`;
    if (drop.startsWith('thing:')) {
      const name = el.dataset.liftTitle ?? el.dataset.dropTitle ?? 'this';
      return loose ? `Add to the notes of “${clip(name, 36)}”` : `Link to ${clip(name, 44)}`;
    }
    return '';
  }, []);

  /* ---------- the gesture ---------- */

  useEffect(() => {
    let press: { el: HTMLElement; thing: Thing; x: number; y: number; timer: number; show: number; quick: boolean; named: boolean } | null = null;
    let held: Held | null = null;
    let justLifted = false;
    let selfCancel = false;
    /** A drag that began inside Axonix (a block in a note, a reference's file going out) is not ours. */
    let ownDrag = false;
    let watchdog = 0;
    const html = document.documentElement;

    const allowed = () => html.dataset.nx === 'true' && live.current.asOf.live && !document.querySelector('.palette');

    const findTarget = (x: number, y: number): { el: HTMLElement; drop: string } | null => {
      if (!held) return null;
      // A toast passing over the dock on its way in or out is not what the pointer is on.
      const under = document.elementsFromPoint(x, y).find((el) => !el.closest('[data-sonner-toaster]')) ?? null;
      for (let el = under as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        const data = el.dataset;
        if (!data) continue;
        const drop = data.drop;
        if (drop && accepts(drop, held.thing, held.fromPocket, held.statement)) return { el, drop };
        // Any other named thing takes a drop. Pocket chips do not: the Pocket itself is the place there.
        if (data.lift && el !== held.src && data.liftFrom === undefined) {
          const implicit = `thing:${data.lift}`;
          if (accepts(implicit, held.thing, held.fromPocket)) return { el, drop: implicit };
        }
      }
      // Dropped from outside onto a page: the page's own module takes it, as its tile would.
      if (held.outside && under && !under.closest(OWN_DROP)) {
        const sheet = under.closest<HTMLElement>('.nx-sheet');
        const module = sheet?.closest<HTMLElement>('.nx')?.dataset.module;
        const drop = module ? `mod:${module}` : '';
        if (sheet && drop && accepts(drop, held.thing, false, held.statement)) return { el: sheet, drop };
      }
      return null;
    };

    const retarget = () => {
      if (!held) return;
      const hit = findTarget(held.px, held.py);
      if (hit?.el !== held.target) {
        if (held.target) delete held.target.dataset.dropHot;
        if (hit) hit.el.dataset.dropHot = '';
        held.target = hit?.el ?? null;
      }
      held.drop = hit?.drop ?? null;
      const g = ghost.current;
      if (g && hit) g.dataset.target = '';
      else if (g) delete g.dataset.target;
      if (hit && hint.current) hint.current.textContent = say(hit.drop, held.thing, hit.el, held.py, held.outside && held.thing.kind === 'image');
    };

    const loop = () => {
      if (!held || !ghost.current) return;
      const tx = clamp(held.px + 14, 8, innerWidth - 312);
      const ty = held.py - held.height - 6 < 8 ? held.py + 22 : held.py - held.height - 6;
      held.vx = (held.vx + (tx - held.x) * 0.2) * 0.64;
      held.vy = (held.vy + (ty - held.y) * 0.2) * 0.64;
      held.x += held.vx;
      held.y += held.vy;
      // It leans with its speed, a few degrees at most, and rights itself at rest.
      ghost.current.style.transform = `translate3d(${held.x}px, ${held.y}px, 0) rotate(${clamp(held.vx * 0.35, -5, 5)}deg)`;
      held.raf = requestAnimationFrame(loop);
    };

    /** Shows the ghost for `thing` at a starting place and marks where it can go. */
    const hold = (thing: Thing, start: { x: number; y: number }, px: number, py: number, from: { src: HTMLElement | null; fromPocket: boolean; outside: boolean; statement: boolean }) => {
      flushSync(() => setShown(thing));
      const g = ghost.current;
      if (!g) return false;
      held = { thing, ...from, px, py, x: start.x, y: start.y, vx: 0, vy: 0, height: g.offsetHeight, target: null, drop: null, raf: 0 };
      g.getAnimations().forEach((a) => a.cancel());
      g.style.transform = `translate3d(${held.x}px, ${held.y}px, 0)`;
      g.dataset.up = '';
      html.dataset.lifting = from.outside ? 'outside' : thing.kind;
      document.querySelectorAll<HTMLElement>('[data-drop]').forEach((t) => {
        if (accepts(t.dataset.drop!, thing, from.fromPocket, from.statement)) t.dataset.dropOk = '';
      });
      held.raf = requestAnimationFrame(loop);
      retarget();
      return true;
    };

    const begin = (p: NonNullable<typeof press>, x: number, y: number) => {
      if (!allowed() || !p.el.isConnected) return;
      // Whatever else was listening to this press lets go: the board's drag, a time block's move.
      selfCancel = true;
      document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
      selfCancel = false;
      // A panel steps aside, so the page and the dock can be reached.
      window.dispatchEvent(new CustomEvent('axonix:lift-begin'));
      window.getSelection()?.removeAllRanges();
      const r = p.el.getBoundingClientRect();
      // It leaves from where it was pressed, not from the corner of a large card.
      const start = r.width > 340 || r.height > 120 ? { x: x - 20, y: y - 20 } : { x: r.left, y: r.top };
      if (!hold(p.thing, start, x, y, { src: p.el, fromPocket: p.el.dataset.liftFrom === 'pocket', outside: false, statement: false })) return;
      delete p.el.dataset.pressing;
      p.el.dataset.imprint = '';
    };

    const clear = () => {
      if (!held) return;
      cancelAnimationFrame(held.raf);
      window.clearTimeout(watchdog);
      delete html.dataset.lifting;
      if (held.src) delete held.src.dataset.imprint;
      document.querySelectorAll<HTMLElement>('[data-drop-ok], [data-drop-hot]').forEach((t) => {
        delete t.dataset.dropOk;
        delete t.dataset.dropHot;
      });
      window.dispatchEvent(new CustomEvent('axonix:lift-end'));
    };

    /** The ghost leaves: back to where it came from, into the place it was dropped, or simply away. */
    const fly = (to: DOMRect | null, home: boolean) => {
      const g = ghost.current;
      if (!g) return setShown(null);
      delete g.dataset.target;
      const from = g.style.transform || 'none';
      const finish = () => {
        delete g.dataset.up;
        setShown(null);
      };
      if (!to) {
        g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'linear', fill: 'forwards' }).onfinish = finish;
        return;
      }
      const tx = home ? to.left : to.left + to.width / 2 - 60;
      const ty = home ? to.top : to.top + to.height / 2 - 14;
      g.animate(
        [
          { transform: from, opacity: 1 },
          { transform: `translate3d(${tx}px, ${ty}px, 0) scale(${home ? 1 : 0.4})`, opacity: home ? 0.5 : 0 },
        ],
        { duration: home ? 260 : 320, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', fill: 'forwards' },
      ).onfinish = finish;
    };

    const end = (cancelled: boolean) => {
      if (!held) return;
      const h = held;
      clear();
      held = null;
      justLifted = true;
      window.setTimeout(() => (justLifted = false), 60);
      if (cancelled || !h.target || !h.drop) {
        // Home is the row it left. A large card, or a thing from outside, has no small place to return to.
        const r = h.src?.isConnected ? h.src.getBoundingClientRect() : null;
        fly(r && r.width <= 340 && r.height <= 120 ? r : null, true);
        return;
      }
      const rect = h.target.getBoundingClientRect();
      perform(h.drop, h.thing, h.target, h.py);
      // Carried out of the Pocket and put somewhere: it has arrived.
      if (h.fromPocket && h.drop !== 'mark') live.current.ws.release(h.thing);
      fly(h.target.matches('.nx-sheet') ? new DOMRect(h.px - 60, h.py - 14, 120, 28) : rect, false);
    };

    const unpress = () => {
      if (!press) return;
      window.clearTimeout(press.timer);
      window.clearTimeout(press.show);
      delete press.el.dataset.pressing;
      if (charge.current) delete charge.current.dataset.on;
      press = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary || held || !allowed()) return;
      const found = findLiftable(e.target, e.clientX, e.clientY);
      if (!found) return;
      // On a scrollbar the press is the scroller's.
      const t = e.target;
      if (t instanceof HTMLElement && t.clientWidth > 0 && (t.scrollHeight > t.clientHeight || t.scrollWidth > t.clientWidth) && (e.offsetX > t.clientWidth || e.offsetY > t.clientHeight)) return;
      const quick = found.quick && e.pointerType === 'mouse';
      const p = { el: found.el, thing: found.thing, x: e.clientX, y: e.clientY, quick, named: found.named, timer: 0, show: 0 };
      const wait = found.slow ? HOLD_ANY_MS : HOLD_MS;
      p.timer = window.setTimeout(() => {
        if (press !== p) return;
        unpress();
        begin(p, p.x, p.y);
      }, wait);
      if (quick) found.el.dataset.pressing = '';
      else {
        // Read off the page, it shows the hold at the pointer; the element itself is left alone.
        p.show = window.setTimeout(() => {
          const c = charge.current;
          if (press !== p || !c) return;
          c.style.transform = `translate3d(${p.x - 14}px, ${p.y + 16}px, 0)`;
          c.style.setProperty('--charge', `${wait - CHARGE_AFTER_MS}ms`);
          c.dataset.on = '';
        }, CHARGE_AFTER_MS);
      }
      press = p;
    };
    const onMove = (e: PointerEvent) => {
      if (held) {
        if (held.outside) return;
        held.px = e.clientX;
        held.py = e.clientY;
        retarget();
        return;
      }
      if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) <= SLOP) return;
      const p = press;
      unpress();
      // A mouse that presses a row and moves is lifting it. Anything else that moves is doing something of its own.
      if (p.quick) begin(p, e.clientX, e.clientY);
    };
    const onUp = () => {
      unpress();
      if (!held?.outside) end(false);
    };
    const onCancel = () => {
      if (selfCancel) return;
      unpress();
      if (!held?.outside) end(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (held && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        end(true);
        return;
      }
      // L keeps the focused thing in the Pocket.
      const at = document.activeElement;
      if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey && at instanceof HTMLElement && at.dataset.lift && at.dataset.liftFrom === undefined && allowed()) {
        const thing = thingOf(at);
        if (!thing) return;
        e.preventDefault();
        e.stopPropagation();
        if (live.current.ws.keep(thing)) toast('Kept in the Pocket', { description: thing.title });
      }
    };
    // The click a release makes is not a press on what is underneath.
    const onClick = (e: MouseEvent) => {
      if (!justLifted) return;
      e.preventDefault();
      e.stopPropagation();
    };

    /* ---- from outside the window ---- */

    const onDragStart = (e: DragEvent) => {
      // A held thing is ours: the browser's own drag (a reference's file) stays out of it.
      if (held) e.preventDefault();
      else ownDrag = true;
    };
    const onDragEnd = () => {
      ownDrag = false;
    };
    const onDragOver = (e: DragEvent) => {
      const data = e.dataTransfer;
      // With a panel open, the drop is the panel's (a statement onto the import sheet).
      if (ownDrag || !data || !carriesAnything(data) || !allowed() || (!held && document.querySelector('dialog[open]'))) return;
      if (!held) {
        unpress();
        const air = inTheAir(data);
        if (!hold(air.thing, { x: e.clientX + 14, y: e.clientY - 60 }, e.clientX, e.clientY, { src: null, fromPocket: false, outside: true, statement: air.statement })) return;
      }
      if (!held?.outside) return;
      held.px = e.clientX;
      held.py = e.clientY;
      retarget();
      // The drag stops arriving when it leaves the window or is let go elsewhere.
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => end(true), 400);
      if (held.target) {
        e.preventDefault();
        data.dropEffect = 'copy';
      } else if (!(e.target instanceof Element && e.target.closest(OWN_DROP))) {
        // Nothing here takes it; without this the window itself would open the file.
        e.preventDefault();
        data.dropEffect = 'none';
      }
    };
    const onDrop = (e: DragEvent) => {
      ownDrag = false;
      if (!held?.outside) return;
      // Where it is let go is what counts, whatever was under it a moment before.
      held.px = e.clientX;
      held.py = e.clientY;
      retarget();
      const h = held;
      const data = e.dataTransfer;
      if (!h.target || !h.drop || !data) {
        if (!(e.target instanceof Element && e.target.closest(OWN_DROP))) e.preventDefault();
        clear();
        held = null;
        fly(null, true);
        return;
      }
      // Marked as taken: a page with its own way of taking a drop (the Storeroom) leaves it alone.
      e.preventDefault();
      const carried = fromOutside(data);
      const rect = h.target.matches('.nx-sheet') ? new DOMRect(h.px - 60, h.py - 14, 120, 28) : h.target.getBoundingClientRect();
      const { target, drop, py, statement } = h;
      clear();
      held = null;
      for (const c of carried) {
        // Each is weighed on its own now that it can be seen: three files may want three things.
        if (accepts(drop, c.thing, false, statement && Boolean(c.file) && STATEMENT.test(c.file!.name))) perform(drop, c.thing, target, py, c.file);
        else toast(`${clip(c.thing.title, 40)} cannot go there.`);
      }
      if (!carried.length) toast('That drop carried nothing Axonix can read.');
      fly(rect, false);
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('dragstart', onDragStart, true);
    window.addEventListener('dragend', onDragEnd, true);
    window.addEventListener('dragenter', onDragOver, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('dragstart', onDragStart, true);
      window.removeEventListener('dragend', onDragEnd, true);
      window.removeEventListener('dragenter', onDragOver, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
      unpress();
      clear();
    };
  }, [perform, say]);

  const value = useMemo<LiftValue>(() => ({ open: (thing) => live.current.onOpen(thing) }), []);
  const Icon = shown ? KIND_ICON[shown.kind] : null;

  return (
    <Ctx.Provider value={value}>
      {children}
      <i ref={charge} className="nx-charge" aria-hidden="true" />
      <div ref={ghost} className="nx-ghost" hidden={!shown} aria-hidden="true">
        <div className="nx-ghost__card">
          <span ref={glass} className="nx-ghost__glass" />
          <span className="nx-ghost__row">
            <span className="nx-ghost__tile">{shown?.kind === 'image' && shown.url ? <img src={shown.url} alt="" draggable={false} /> : Icon && <Icon size={15} strokeWidth={1.7} />}</span>
            <span className="nx-ghost__text">
              <b>{shown?.title}</b>
              {shown?.sub && <span>{shown.sub}</span>}
            </span>
            {shown?.amount && <span className={shown.pos ? 'nx-ghost__amount fin-num nxf-pos' : 'nx-ghost__amount fin-num'}>{shown.amount}</span>}
          </span>
        </div>
        <div className="nx-ghost__hint">
          <ArrowRight size={13} strokeWidth={2} />
          <span ref={hint} />
        </div>
      </div>
    </Ctx.Provider>
  );
}
