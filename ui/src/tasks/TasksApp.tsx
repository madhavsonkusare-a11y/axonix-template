/**
 * Tasks — rail, top bar, the current frame, and the task sheet.
 *
 * Built on the Finance shell (rail, glass lens, top bar, sheets) in the Tasks
 * tile's light blue. Home is the dashboard over the board; each project has its
 * own board. Calendar and Notes are the next phases and say so.
 *
 * Keys: Ctrl+N adds (Shift+Enter there opens the full composer), Ctrl+Z
 * undoes, `/` filters, Escape goes back Home.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, FolderPlus, Globe, Inbox, LayoutDashboard, NotebookText, Search, type LucideIcon } from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import { Mark } from '../finance/components/Glyphs';
import { LiquidLens, LiquidSegment, useLiquidIndicator } from '../finance/components/Liquid';
import { PopUpButton } from '../finance/components/Menu';
import { useTasks } from './TasksContext';
import { NO_FILTER, isLate, isOpen, matches, todaySummary, todayIso, type DueFilter, type PriorityFilter, type TaskFilter } from './derive';
import Board, { type Grouping } from './components/Board';
import Dashboard from './components/Dashboard';
import TaskSheet from './components/TaskSheet';
import Composer, { type ComposerSeed } from './components/Composer';
import ResearchSheet from './masters/ResearchSheet';
import { QuickAdd, type QuickAddHandle } from './components/QuickAdd';
import { ProjectDot } from './components/bits';
import { sanitizeName } from './taskfile';
import NotesFrame, { type NoteRequest } from '../notes/NotesFrame';
import CalendarFrame from '../calendar/CalendarFrame';
import ProjectWorkspace, { ProjectMark, projectIcon } from './components/ProjectWorkspace';

export type TasksFrame = 'home' | 'calendar' | 'notes' | `p:${string}`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The time, to the minute: the agenda's now-line and "today" move on their own. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

export default function TasksApp({ frame, onFrame, onHome, note }: { frame: TasksFrame; onFrame: (f: TasksFrame) => void; onHome: () => void; /** A note to open, asked for from outside this app (the new Tasks). */ note?: NoteRequest | null }) {
  const { tasks, projects, loading, loadError, undo } = useTasks();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);
  const [grouping, setGrouping] = useState<Grouping>('none');
  const [noteRequest, setNoteRequest] = useState<NoteRequest | null>(note ?? null);
  useEffect(() => {
    if (note) setNoteRequest(note);
  }, [note]);
  const [compose, setCompose] = useState<ComposerSeed | null>(null);
  const [research, setResearch] = useState(false);
  const quick = useRef<QuickAddHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const now = useNow();
  const today = todayIso();

  const project = frame.startsWith('p:') ? frame.slice(2) : undefined;

  // A project folder that went away (renamed in Explorer) sends you Home.
  useEffect(() => {
    if (project && !loading && project !== '' && !projects.includes(project)) onFrame('home');
  }, [project, projects, loading, onFrame]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (frame === 'notes' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        quick.current?.focus();
      } else if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !typing(e.target)) {
        e.preventDefault();
        undo();
      } else if (e.key === '/' && !ctrl && !typing(e.target) && search.current) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, frame]);

  const open = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback(() => setOpenId(null), []);
  const goProject = useCallback((p: string) => onFrame(`p:${p}`), [onFrame]);
  const openNote = useCallback(
    (target: string) => {
      setOpenId(null);
      setNoteRequest((r) => ({ target, n: (r?.n ?? 0) + 1 }));
      onFrame('notes');
    },
    [onFrame],
  );

  const expand = useCallback((seed: Omit<ComposerSeed, 'n'>) => setCompose((c) => ({ ...seed, n: (c?.n ?? 0) + 1 })), []);
  const closeComposer = useCallback(() => setCompose(null), []);

  const effective = useMemo<TaskFilter>(() => (project !== undefined ? { ...filter, project } : filter), [filter, project]);
  const shown = useMemo(() => tasks.filter((t) => matches(t, effective, today)), [tasks, effective, today]);
  const board = (
    <section className="tsk-boardsec" aria-label="Board">
      <BoardBar filter={filter} onFilter={setFilter} grouping={grouping} onGrouping={setGrouping} projectFixed={project !== undefined} count={shown.filter(isOpen).length} searchRef={search} />
      {!loading && <Board tasks={shown} grouping={project !== undefined && grouping === 'project' ? 'none' : grouping} showProject={project === undefined} today={today} project={project} onOpen={open} />}
    </section>
  );

  return (
    <div className={frame === 'notes' ? 'fin tsk tsk--notes' : 'fin tsk'}>
      {frame !== 'notes' && <Rail frame={frame} onFrame={onFrame} onHome={onHome} />}
      <div className="fin-main">
        <div className="fin-grain fin-main__grain" aria-hidden="true" />
        {frame !== 'notes' && <div className="fin-topbar tsk-topbar">
          <QuickAdd ref={quick} project={project} onExpand={expand} />
          <div className="fin-topbar__right">
            <button type="button" className="fin-icon-btn fin-icon-btn--lg" onClick={() => setResearch(true)} aria-label="Research sources" title="Research sources">
              <Globe size={15} strokeWidth={1.7} />
            </button>
          </div>
        </div>}
        <div className={frame === 'notes' || frame === 'calendar' ? 'fin-main__scroll tsk-scroll--fixed' : 'fin-main__scroll'} key={frame}>
          <ErrorBoundary label={`tasks ${frame}`}>
            {frame === 'calendar' && <CalendarFrame onOpenTask={open} />}
            {frame === 'notes' && <NotesFrame request={noteRequest} onExit={onHome} />}
            {(frame === 'home' || project !== undefined) && (
              <div className="tsk-page">
                {loadError && (
                  <p className="fin-error" role="alert">
                    Tasks could not be loaded, so nothing will be saved this session. ({loadError})
                  </p>
                )}
                {frame === 'home' ? (
                  <>
                    <HomeHead now={now} />
                    <Dashboard tasks={tasks} projects={projects} today={today} now={now} onOpen={open} onProject={goProject} />
                    {board}
                  </>
                ) : (
                  project === '' ? <><InboxHead tasks={shown} />{board}</> : <ProjectWorkspace key={project} project={project!} tasks={tasks} board={board} onOpenTask={open} onOpenNote={openNote} onRenamed={(name) => onFrame(`p:${name}`)} />
                )}
              </div>
            )}
          </ErrorBoundary>
        </div>
      </div>
      <TaskSheet id={openId} onClose={close} onOpenNote={openNote} />
      <Composer seed={compose} onClose={closeComposer} onOpenNote={openNote} />
      <ResearchSheet open={research} onClose={() => setResearch(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* heads                                                               */
/* ------------------------------------------------------------------ */

function HomeHead({ now }: { now: Date }) {
  const { tasks } = useTasks();
  const today = todayIso();
  const s = todaySummary(tasks, today);
  const parts = [`${s.dueToday} due today`, s.late ? `${s.late} late` : null, `${s.doneToday.length} done`].filter(Boolean);
  return (
    <div className="fin-page__head">
      <div className="fin-page__lead">
        <h2>
          {WEEKDAYS[now.getDay()]} {now.getDate()} {MONTHS[now.getMonth()]}
        </h2>
        <p>{tasks.length ? parts.join(' · ') : 'Add the first task when you are ready.'}</p>
      </div>
    </div>
  );
}

function InboxHead({ tasks }: { tasks: ReturnType<typeof useTasks>['tasks'] }) {
  const open = tasks.filter(isOpen).length;
  return <div className="fin-page__head"><div className="fin-page__lead"><h2>Inbox</h2><p>{open ? `${open} task${open === 1 ? '' : 's'} without a project.` : 'Tasks without a project land here.'}</p></div></div>;
}

/* ------------------------------------------------------------------ */
/* the board's bar: filter, group                                      */
/* ------------------------------------------------------------------ */

function BoardBar({
  filter,
  onFilter,
  grouping,
  onGrouping,
  projectFixed,
  count,
  searchRef,
}: {
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  grouping: Grouping;
  onGrouping: (g: Grouping) => void;
  projectFixed: boolean;
  count: number;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { projects } = useTasks();
  const set = (patch: Partial<TaskFilter>) => onFilter({ ...filter, ...patch });
  const filtered = filter.query || (!projectFixed && filter.project !== '*') || filter.due !== 'any' || filter.priority !== 'any';
  const projectValue = filter.project === '*' ? 'all' : `p:${filter.project}`;

  return (
    <div className="tsk-boardbar">
      <h3 className="tsk-boardbar__title">
        Board <span className="fin-num">{count}</span>
      </h3>
      <label className="tsk-search">
        <Search size={13} strokeWidth={1.9} aria-hidden="true" />
        <input
          ref={searchRef}
          value={filter.query}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              if (filter.query) set({ query: '' });
              else e.currentTarget.blur();
            }
          }}
          placeholder="Filter"
          aria-label="Filter tasks"
          spellCheck={false}
        />
        {!filter.query && <span className="fin-key">/</span>}
      </label>
      {!projectFixed && (
        <PopUpButton
          label="Project"
          value={projectValue}
          onChange={(v) => set({ project: v === 'all' ? '*' : v.slice(2) })}
          options={[
            { value: 'all', label: 'All projects' },
            { value: 'p:', label: 'Inbox', icon: <ProjectDot name="" /> },
            ...projects.map((p) => ({ value: `p:${p}`, label: p, icon: <ProjectDot name={p} /> })),
          ]}
        />
      )}
      <PopUpButton<DueFilter>
        label="Due"
        value={filter.due}
        onChange={(due) => set({ due })}
        options={[
          { value: 'any', label: 'Any date' },
          { value: 'late', label: 'Late' },
          { value: 'today', label: 'Due today' },
          { value: 'week', label: 'This week' },
          { value: 'none', label: 'No date' },
        ]}
      />
      <PopUpButton<PriorityFilter>
        label="Priority"
        value={filter.priority}
        onChange={(priority) => set({ priority })}
        options={[
          { value: 'any', label: 'Any priority' },
          { value: '1', label: 'Urgent' },
          { value: '2', label: 'High' },
          { value: '3', label: 'Medium' },
          { value: '4', label: 'Low' },
          { value: 'none', label: 'No priority' },
        ]}
      />
      {filtered && (
        <button type="button" className="fin-link tsk-boardbar__clear" onClick={() => onFilter({ ...NO_FILTER, project: projectFixed ? filter.project : '*' })}>
          Clear
        </button>
      )}
      <span className="tsk-boardbar__group">
        <span className="tsk-boardbar__label">Group</span>
        <LiquidSegment<Grouping>
        label="Group the board"
        mono={false}
        value={projectFixed && grouping === 'project' ? 'none' : grouping}
        onChange={onGrouping}
        options={[
          { value: 'none', label: 'None' },
          ...(projectFixed ? [] : [{ value: 'project' as const, label: 'Project' }]),
          { value: 'priority', label: 'Priority' },
        ]}
        />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the rail                                                            */
/* ------------------------------------------------------------------ */

interface RailItem {
  key: TasksFrame;
  label: string;
  icon?: LucideIcon;
  dot?: string;
  count?: number;
  late?: number;
  soon?: boolean;
}

function Rail({ frame, onFrame, onHome }: { frame: TasksFrame; onFrame: (f: TasksFrame) => void; onHome: () => void }) {
  const { tasks, projects, createProject } = useTasks();
  const host = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, frame, 'y');
  const today = todayIso();
  const [naming, setNaming] = useState<string | null>(null);
  const [, setMetaRevision] = useState(0);
  useEffect(() => {
    const changed = () => setMetaRevision((revision) => revision + 1);
    window.addEventListener('axonix:project-meta', changed);
    return () => window.removeEventListener('axonix:project-meta', changed);
  }, []);

  const openCount = (p?: string) => tasks.filter((t) => isOpen(t) && (p === undefined || t.project === p)).length;
  const lateCount = (p?: string) => tasks.filter((t) => isLate(t, today) && (p === undefined || t.project === p)).length;

  const main: RailItem[] = [
    { key: 'home', label: 'Home', icon: LayoutDashboard, count: openCount(), late: lateCount() },
    { key: 'p:', label: 'Inbox', icon: Inbox, count: openCount('') },
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    { key: 'notes', label: 'Notes', icon: NotebookText },
  ];
  const folders: RailItem[] = [
    ...projects.map((p) => ({ key: `p:${p}` as TasksFrame, label: p, dot: p, count: openCount(p), late: lateCount(p) })),
  ];

  const item = (n: RailItem) => {
    const on = n.key === frame;
    const Icon = n.icon;
    return (
      <button key={n.key} type="button" data-liquid-key={n.key} className={on ? 'fin-nav fin-nav--on' : 'fin-nav'} aria-current={on ? 'page' : undefined} onClick={() => onFrame(n.key)}>
        <span className="fin-nav__glyph">
          {Icon ? <Icon size={15} strokeWidth={1.5} color={on ? '#bfe3ff' : 'rgba(226,234,252,.42)'} aria-hidden="true" /> : <ProjectMark value={projectIcon(n.dot ?? '')} project={n.dot ?? ''} size={15} />}
        </span>
        <span className="tsk-nav__label">{n.label}</span>
        {n.late ? (
          <span className="fin-nav__badge tsk-nav__late" title={`${n.late} late`}>
            {n.late}
          </span>
        ) : n.count ? (
          <span className="fin-nav__count">{n.count}</span>
        ) : null}
        {n.soon && <span className="fin-nav__soon">Soon</span>}
      </button>
    );
  };

  const commitProject = async () => {
    const name = naming?.trim();
    setNaming(null);
    if (!name) return;
    if (await createProject(name)) onFrame(`p:${sanitizeName(name)}`);
  };

  return (
    <aside className="fin-rail tsk-rail">
      <div className="fin-grain fin-rail__grain" aria-hidden="true" />
      <button type="button" className="fin-rail__brand" onClick={onHome} title="Back to Axonix Home">
        <Mark />
        <span>AXONIX</span>
      </button>
      <nav className="fin-rail__nav tsk-rail__nav" ref={host}>
        <LiquidLens lensRef={lens} radius={10} />
        <span className="fin-rail__section">Tasks</span>
        {main.map(item)}
        <span className="fin-rail__section fin-rail__section--gap">Projects</span>
        {folders.map(item)}
        {naming !== null ? (
          <input
            className="fin-input fin-input--sm tsk-rail__new"
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onBlur={() => void commitProject()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitProject();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setNaming(null);
              }
            }}
            placeholder="Project name"
            aria-label="New project name"
          />
        ) : (
          <button type="button" className="fin-nav tsk-rail__add" onClick={() => setNaming('')}>
            <span className="fin-nav__glyph">
              <FolderPlus size={15} strokeWidth={1.5} color="rgba(226,234,252,.42)" aria-hidden="true" />
            </span>
            <span>New project</span>
          </button>
        )}
      </nav>
      <SaveState />
    </aside>
  );
}

/** The foot of the rail speaks only when saving fails, as in Finance. */
function SaveState() {
  const { save, loadError, loading, retry } = useTasks();
  if (loading) return null;
  if (loadError) {
    return (
      <div className="fin-rail__foot">
        <span className="fin-rail__sync" data-state="error" title={loadError}>
          <span className="fin-dot" /> Not saving this session
        </span>
      </div>
    );
  }
  if (save.state === 'error') {
    return (
      <div className="fin-rail__foot">
        <span className="fin-rail__sync" data-state="error" title={save.message}>
          <span className="fin-dot" /> Last change not saved
        </span>
        <button type="button" className="fin-link fin-rail__retry" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }
  return null;
}
