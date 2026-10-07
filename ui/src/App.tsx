/**
 * Axonix shell.
 *
 * Home is the entry view; picking a module swaps the surface beneath the window
 * chrome. There is no router — a handful of views and a frame id do not justify
 * one, and a desktop window has no address bar to keep in sync.
 *
 * Finance, Tasks, Notes and Calendar state is provided HERE, above every
 * surface, so Home and the dock read the same live figures as the modules, and
 * time blocks keep syncing whatever is open.
 */
import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import Titlebar from './Titlebar';
import Toasts from './Toasts';
import DataAlert from './DataAlert';
import { AlertHost } from './finance/components/Alert';
import CommandPalette from './CommandPalette';
import Home from './home/Home';
import FinanceApp, { type FinanceIntent, type Frame } from './finance/FinanceApp';
import { FinanceStateProvider } from './finance/FinanceContext';
import FinanceNext from './next/FinanceNext';
import HomeNext from './next/home/HomeNext';
import TasksNext, { type TaskRequest, type TasksView } from './next/tasks/TasksNext';
import CalendarNext from './next/calendar/CalendarNext';
import NotesNext from './next/notes/NotesNext';
import StoreroomNext from './next/storeroom/StoreroomNext';
import SocialNext from './next/social/SocialNext';
import type { NoteRequest } from './notes/NotesFrame';
import SocialApp from './social/SocialApp';
import TasksApp, { type TasksFrame } from './tasks/TasksApp';
import { TasksStateProvider } from './tasks/TasksContext';
import { CalendarProvider } from './calendar/CalendarContext';
import { NotesProvider } from './notes/NotesContext';
import StoreroomApp from './storeroom/StoreroomApp';
import { useStoreroomNotices } from './storeroom/notices';
import { AssistantProvider } from './assistant/AssistantContext';
import { DoorProvider } from './door/DoorContext';
import LiftLayer from './next/lift/Lift';
import { flashPart } from './next/lift/resolve';
import { textOf, type Thing } from './next/lift/things';
import { VIEWS } from './next/finance/views';
import { toast } from 'sonner';
import { WorkspaceProvider } from './next/lift/Workspace';
import Lens from './next/scrub/Lens';
import { ScrubProvider } from './next/scrub/Scrub';

/**
 * `legacy` keeps the first version of each module reachable. The first Calendar
 * and the first Notes were frames of the first Tasks app, so "Legacy Calendar"
 * and "Legacy Notes" open that app on the matching frame.
 */
type View =
  | { app: 'home'; legacy?: boolean }
  | { app: 'finance'; frame: Frame; legacy?: boolean }
  | { app: 'tasks'; frame: TasksFrame | TasksView; legacy?: boolean }
  | { app: 'calendar' }
  | { app: 'notes' }
  | { app: 'social'; legacy?: boolean }
  | { app: 'storeroom'; legacy?: boolean };

export default function App() {
  const [view, setView] = useState<View>({ app: 'home' });
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Words the palette opens with (a thing dropped on the mark). */
  const [paletteSeed, setPaletteSeed] = useState('');
  const [intent, setIntent] = useState<FinanceIntent | null>(null);
  /** An item to open when the Storeroom shows (a toast's "Open"). */
  const [storeRequest, setStoreRequest] = useState<{ id: string; n: number } | null>(null);

  const goHome = useCallback(() => setView({ app: 'home' }), []);
  // Stays in whichever tracker is showing; from anywhere else it opens the new one.
  const goFrame = useCallback((frame: Frame) => setView((v) => ({ app: 'finance', frame, legacy: v.app === 'finance' && v.legacy })), []);
  const goLegacyHome = useCallback(() => setView({ app: 'home', legacy: true }), []);
  const goLegacyFinance = useCallback(() => setView((v) => ({ app: 'finance', frame: v.app === 'finance' ? v.frame : 'overview', legacy: true })), []);
  // From the first Tasks' rail: inside Legacy Tasks every frame stays in it;
  // otherwise Calendar and Notes are the modules of their own.
  const goTasks = useCallback(
    (frame: TasksFrame | TasksView) =>
      setView((v): View => {
        const legacy = v.app === 'tasks' && v.legacy;
        if (!legacy && frame === 'calendar') return { app: 'calendar' };
        if (!legacy && frame === 'notes') return { app: 'notes' };
        return { app: 'tasks', frame, legacy };
      }),
    [],
  );
  const goTasksNext = useCallback((frame: TasksView) => setView({ app: 'tasks', frame }), []);
  const goLegacyTasks = useCallback(() => setView({ app: 'tasks', frame: 'home', legacy: true }), []);
  const goLegacyCalendar = useCallback(() => setView({ app: 'tasks', frame: 'calendar', legacy: true }), []);
  const goLegacyNotes = useCallback(() => setView({ app: 'tasks', frame: 'notes', legacy: true }), []);
  const goLegacySocial = useCallback(() => setView({ app: 'social', legacy: true }), []);
  const goLegacyStoreroom = useCallback(() => setView({ app: 'storeroom', legacy: true }), []);
  /** A note another module asked for (a task's linked note). */
  const [noteRequest, setNoteRequest] = useState<NoteRequest | null>(null);
  const openNote = useCallback((target: string) => {
    setNoteRequest((r) => ({ target, n: (r?.n ?? 0) + 1 }));
    setView({ app: 'notes' });
  }, []);
  /** A task the palette asked for, or the add line. */
  const [taskRequest, setTaskRequest] = useState<TaskRequest | null>(null);
  const askTasks = useCallback((ask: Omit<TaskRequest, 'n'>) => {
    setTaskRequest((r) => ({ ...ask, n: (r?.n ?? 0) + 1 }));
    // Stays on the Tasks view that is showing; from anywhere else it opens the board.
    setView((v) => (v.app === 'tasks' && !v.legacy && v.frame !== 'calendar' && v.frame !== 'notes' ? v : { app: 'tasks', frame: 'board' }));
  }, []);
  const openTask = useCallback((id: string) => askTasks({ id }), [askTasks]);
  const addTask = useCallback(() => askTasks({ add: true }), [askTasks]);
  const openProject = useCallback((project: string) => setView({ app: 'tasks', frame: `p:${project}` }), []);
  const clearIntent = useCallback(() => setIntent(null), []);
  const openStoreItem = useCallback((id: string) => {
    setStoreRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
    // Whichever Storeroom is showing keeps showing; from elsewhere the new one opens.
    setView((v) => (v.app === 'storeroom' ? v : { app: 'storeroom' }));
  }, []);
  // Social's "Save … to Storeroom" answers here, whichever surface is showing.
  useStoreroomNotices(openStoreItem);

  // A scene (a module, a view, a panel arriving) takes its time for the pointer and none for the
  // keyboard: whoever is typing is ahead of the animation. CSS reads this off the root.
  useEffect(() => {
    const root = document.documentElement;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') root.dataset.nxInput = 'key';
    };
    const pointer = () => {
      root.dataset.nxInput = 'pointer';
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', pointer, true);
    };
  }, []);

  /**
   * Module to module: what was there blurs away while the next arrives, and the
   * rail holds still (the browser's view transition; the pictures are in
   * `next.css`, "Calm"). Not for the keyboard, and not into or out of Social: a
   * web page is only ever moved and faded, and its picture cannot be taken.
   */
  const between = useCallback((change: () => void, social: boolean) => {
    const root = document.documentElement;
    const start = (document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } }).startViewTransition;
    // `axonix.next.vt` = `off` in localStorage turns this one move off, to compare with and without it.
    let off = false;
    try {
      off = localStorage.getItem('axonix.next.vt') === 'off';
    } catch {
      /* storage refused: the move stays on */
    }
    if (!start || off || social || root.dataset.nxInput === 'key' || root.dataset.nx !== 'true') {
      change();
      return;
    }
    root.dataset.nxVt = 'module';
    const done = () => {
      delete root.dataset.nxVt;
    };
    try {
      start.call(document, () => flushSync(change)).finished.then(done, done);
    } catch {
      done();
      change();
    }
  }, []);

  const openModule = useCallback(
    (id: string) => {
      if (id === 'home') goHome();
      if (id === 'finance') goFrame('overview');
      if (id === 'tasks') goTasksNext('board');
      // Not a tile in the dock: the other side of Tasks' switch, reached by name from the palette.
      if (id === 'projects') goTasksNext('projects');
      if (id === 'calendar') setView({ app: 'calendar' });
      if (id === 'notes') setView({ app: 'notes' });
      if (id === 'social') setView({ app: 'social' });
      if (id === 'storeroom') setView({ app: 'storeroom' });
    },
    [goHome, goFrame, goTasksNext],
  );
  const openApp = useCallback((id: string) => between(() => openModule(id), id === 'social' || view.app === 'social'), [between, openModule, view.app]);

  const runIntent = useCallback((next: FinanceIntent) => {
    // A search lands on the ledger wherever it was started; the rest open a
    // sheet over whatever frame is showing (Overview when coming from Home).
    if (next.type === 'search') setView({ app: 'finance', frame: 'transactions' });
    else setView((v) => (v.app === 'finance' ? v : { app: 'finance', frame: next.type === 'id' ? 'ids' : 'overview' }));
    setIntent(next);
  }, []);

  // A requested note or task is opened once: leaving the module forgets it, so coming back does not reopen it.
  const inNotes = view.app === 'notes';
  useEffect(() => {
    if (!inNotes) setNoteRequest(null);
  }, [inNotes]);
  const inTasks = view.app === 'tasks';
  useEffect(() => {
    if (!inTasks) setTaskRequest(null);
  }, [inTasks]);

  // Escape returns to Home — unless the palette or a sheet is open, in which
  // case Escape belongs to them. Social handles its own Escape (it closes its
  // layers first), and a note being written never leaves on Escape.
  const writing = view.app === 'notes' || (view.app === 'tasks' && view.frame === 'notes');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A menu or alert that handled Escape has already said so.
      if (e.key !== 'Escape' || e.defaultPrevented || paletteOpen || view.app === 'home' || view.app === 'social' || writing) return;
      if (document.querySelector('dialog[open]')) return;
      goHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, view, writing, goHome]);

  const ask = useCallback(() => {
    setPaletteSeed('');
    setPaletteOpen(true);
  }, []);

  /** A thing dropped on the mark: search opens with its name. */
  const searchFor = useCallback((words: string) => {
    setPaletteSeed(words);
    setPaletteOpen(true);
  }, []);

  /** A day the Calendar should show (an event opened from a link or the Pocket). */
  const [calendarRequest, setCalendarRequest] = useState<{ day: string; n: number } | null>(null);
  /** Opens a thing where it lives: the Pocket, a link, a toast's Open. */
  const openThing = useCallback(
    (thing: Thing) => {
      if (thing.kind === 'txn') runIntent({ type: 'details', target: { type: 'transaction', id: thing.id } });
      else if (thing.kind === 'task') openTask(thing.id);
      else if (thing.kind === 'note') openNote(thing.id);
      else if (thing.kind === 'ref') openStoreItem(thing.id);
      else if (thing.kind === 'account' || thing.kind === 'method') runIntent({ type: 'details', target: { type: thing.kind, id: thing.id } });
      else if (thing.kind === 'category' || thing.kind === 'budget') runIntent({ type: 'search', query: thing.id });
      else if (thing.kind === 'subscription') goFrame('overview');
      else if (thing.kind === 'id') goFrame('ids');
      else if (thing.kind === 'project') openProject(thing.id === 'Inbox' ? '' : thing.id);
      else if (thing.kind === 'tag') setView({ app: 'storeroom' });
      else if (thing.kind === 'part') {
        // A part of a page: go to the page, then show which part.
        const [module, ...rest] = (thing.at ?? thing.id.split('#')[0]).split('/');
        const part = rest.join('/');
        if (module === 'finance') goFrame(VIEWS.some((v) => v.id === part) ? (part as Frame) : 'overview');
        // A part kept from the second Tasks (its Today or Upcoming) is in Projects now.
        else if (module === 'tasks') goTasksNext(part === 'board' || part.startsWith('p:') ? (part as TasksView) : 'projects');
        else openApp(module);
        if (thing.id.includes('#')) window.setTimeout(() => flashPart(thing.id), 500);
      } else if (thing.kind === 'link' || (thing.kind === 'image' && thing.url)) {
        if (/^https:\/\//i.test(thing.url ?? '')) window.open(thing.url, '_blank', 'noopener');
      } else if (thing.kind === 'text') {
        void navigator.clipboard.writeText(textOf(thing)).then(
          () => toast('Copied', { description: thing.title }),
          () => toast('Could not copy that.'),
        );
      } else if (thing.kind === 'file' || thing.kind === 'image') {
        toast(thing.title, { description: thing.path ?? 'Carry it onto a module to use it.' });
      } else {
        if (thing.day) setCalendarRequest((r) => ({ day: thing.day!, n: (r?.n ?? 0) + 1 }));
        setView({ app: 'calendar' });
      }
    },
    [runIntent, openTask, openNote, openStoreItem, goFrame, goTasksNext, openProject, openApp],
  );
  /** A statement dragged onto Finance. */
  const importStatement = useCallback((file: File) => runIntent({ type: 'import', file }), [runIntent]);
  const inCalendar = view.app === 'calendar';
  useEffect(() => {
    if (!inCalendar) setCalendarRequest(null);
  }, [inCalendar]);
  const legacy = 'legacy' in view && Boolean(view.legacy);
  // Said to the assistant with each question: where the owner is.
  const where = view.app === 'home' ? 'Home' : `${view.app[0].toUpperCase()}${view.app.slice(1)}${'frame' in view && view.frame ? ` (${view.frame.startsWith('p:') ? `the project ${view.frame.slice(2) || 'Inbox'}` : view.frame})` : ''}`;

  return (
    <FinanceStateProvider>
      <TasksStateProvider>
        <NotesProvider>
        <CalendarProvider>
        <WorkspaceProvider>
        <ScrubProvider>
        <AssistantProvider where={where}>
        <DoorProvider onOpen={openThing}>
        <LiftLayer onOpen={openThing} onImport={importStatement} onSearch={searchFor}>
          {/* The first Social draws its own title bar. */}
          {!(view.app === 'social' && view.legacy) && <Titlebar />}
          <DataAlert />
          <AlertHost />
          <CommandPalette
            open={paletteOpen}
            seed={paletteSeed}
            onOpenChange={setPaletteOpen}
            onHome={goHome}
            onApp={openApp}
            onOpenTask={openTask}
            onAddTask={addTask}
            onProject={openProject}
            onOpenNote={openNote}
            onFrame={goFrame}
            onIntent={runIntent}
            onLegacyFinance={goLegacyFinance}
            onLegacyHome={goLegacyHome}
            onLegacyTasks={goLegacyTasks}
            onLegacyCalendar={goLegacyCalendar}
            onLegacyNotes={goLegacyNotes}
            onLegacyStoreroom={goLegacyStoreroom}
            onLegacySocial={goLegacySocial}
          />
          {/* While the ruler is off today, every new-shell module reads through the lens. */}
          <Lens off={legacy}>
          <div className="shell">
            {view.app === 'home' && !view.legacy && <HomeNext onOpenApp={openApp} onAsk={ask} />}
            {view.app === 'home' && view.legacy && <Home onOpenApp={openApp} />}
            {view.app === 'finance' && !view.legacy && (
              <FinanceNext
                frame={view.frame}
                onFrame={goFrame}
                onSearch={ask}
                intent={intent}
                onIntentHandled={clearIntent}
                onOpenApp={openApp}
              />
            )}
            {view.app === 'finance' && view.legacy && (
              <FinanceApp
                frame={view.frame}
                onFrame={goFrame}
                onHome={goHome}
                onSearch={ask}
                intent={intent}
                onIntentHandled={clearIntent}
              />
            )}
            {view.app === 'tasks' && !view.legacy && (
              <TasksNext frame={view.frame === 'projects' || view.frame.startsWith('p:') ? (view.frame as TasksView) : 'board'} onFrame={goTasksNext} onOpenApp={openApp} onSearch={ask} onOpenNote={openNote} request={taskRequest} />
            )}
            {view.app === 'tasks' && view.legacy && <TasksApp frame={view.frame === 'projects' || view.frame === 'board' ? 'home' : view.frame} onFrame={goTasks} onHome={goHome} />}
            {view.app === 'calendar' && <CalendarNext onOpenApp={openApp} onSearch={ask} onOpenNote={openNote} request={calendarRequest} />}
            {view.app === 'notes' && <NotesNext request={noteRequest} onOpenApp={openApp} onSearch={ask} />}
            {view.app === 'social' && !view.legacy && <SocialNext onHome={goHome} onOpenApp={openApp} onSearch={ask} />}
            {view.app === 'social' && view.legacy && <SocialApp onHome={goHome} />}
            {view.app === 'storeroom' && !view.legacy && <StoreroomNext request={storeRequest} onOpenApp={openApp} onSearch={ask} onLegacy={goLegacyStoreroom} />}
            {view.app === 'storeroom' && view.legacy && <StoreroomApp onHome={goHome} request={storeRequest} />}
          </div>
          </Lens>
          {/* Agents and the assistant have no surface on screen (owner, 2026-10-07: "remove claude and AI
              integration from the UI, keep backend for now"). Their providers stay mounted above: the door
              still runs a guest's call on this page, with its Undo. `assistant/Ask` and `door/DoorLayer`
              are what to mount again to bring the panels back. */}
          <Toasts />
        </LiftLayer>
        </DoorProvider>
        </AssistantProvider>
        </ScrubProvider>
        </WorkspaceProvider>
        </CalendarProvider>
        </NotesProvider>
      </TasksStateProvider>
    </FinanceStateProvider>
  );
}
