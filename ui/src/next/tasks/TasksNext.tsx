/**
 * Tasks in the new shell, third version: Tasks | Projects.
 *
 * Owner, 2026-10-07: "divide it into tasks and project. The tasks module
 * should just be the kanban board, and the project should hold all details
 * from the current tasks app… remove repetitive buttons, more button, and more
 * options, keep everything minimal." The composition follows the reference he
 * chose that day (Hark): no sidebar, one switch in the middle of the top bar,
 * a stack of small panels beside the main column, borderless panels standing
 * on the hour's sky.
 *
 * - **Tasks** is the board (`TaskBoard`), with one row for whose tasks show.
 * - **Projects** is everything else (`Projects`): the day's actions, agenda,
 *   what is ahead, momentum, and the projects. A project opens its workspace
 *   (hero, dashboard, timeline, library, moodboard, discover, compare,
 *   scholarships: the first Tasks' own); its tasks read as a list there, with
 *   one link to the board.
 *
 * Same files, same context (`TasksContext`), same sheets as before. The first
 * Tasks is still Legacy Tasks, from Ctrl K.
 *
 * Keys: Ctrl+N adds (Shift+Enter there opens the full composer), Ctrl+Z
 * undoes, `/` filters the board.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Search, SquareCheck } from 'lucide-react';
import ErrorBoundary from '../../ErrorBoundary';
import { useTasks } from '../../tasks/TasksContext';
import { NO_FILTER, matches } from '../../tasks/derive';
import TaskSheet from '../../tasks/components/TaskSheet';
import Composer, { type ComposerSeed } from '../../tasks/components/Composer';
import ResearchSheet from '../../tasks/masters/ResearchSheet';
import { QuickAdd, type QuickAddHandle } from '../../tasks/components/QuickAdd';
import ProjectWorkspace from '../../tasks/components/ProjectWorkspace';
import Shell from '../Shell';
import Linked from '../lift/Links';
import { becomes, taskOnPage } from '../motion/becomes';
import { useAsOf } from '../scrub/Scrub';
import { useDockApps } from '../apps';
import Projects from './Projects';
import SaveNotice from './SaveNotice';
import Switch from './Switch';
import TaskBoard, { ALL, type Scope } from './TaskBoard';
import TaskList from './TaskList';
import Timeline from './Timeline';

/** Where Tasks can be: the board, the projects, or one project. */
export type TasksView = 'board' | 'projects' | `p:${string}`;

const SCOPE = 'axonix.next.tasks.scope';

/** The time, to the minute: the agenda's now-line and "today" move on their own. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

/** Something asked for from outside Tasks (the palette): a task to open, or the add line. */
export interface TaskRequest {
  id?: string;
  add?: boolean;
  n: number;
}

export interface TasksNextProps {
  /** Acted on once per `n`. */
  request?: TaskRequest | null;
  frame: TasksView;
  onFrame: (f: TasksView) => void;
  onOpenApp: (id: string) => void;
  onSearch: () => void;
  /** Opens a note, by title or path, in Notes. */
  onOpenNote: (target: string) => void;
}

export default function TasksNext({ frame, onFrame, onOpenApp, onSearch, onOpenNote, request }: TasksNextProps) {
  const apps = useDockApps();
  const { tasks, projects, loading, loadError, undo } = useTasks();
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScopeState] = useState<Scope>(() => {
    try {
      return localStorage.getItem(SCOPE) ?? ALL;
    } catch {
      return ALL;
    }
  });
  const [compose, setCompose] = useState<ComposerSeed | null>(null);
  const [research, setResearch] = useState(false);
  const quick = useRef<QuickAddHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const clockNow = useNow();
  const asOf = useAsOf();
  const today = asOf.day;
  // Another day is shown whole: looking back, as it stood at its end; looking ahead, before it starts.
  const now = useMemo(() => (asOf.live ? clockNow : new Date(`${today}T${asOf.past ? '23:59' : '00:00'}:00`)), [asOf.live, asOf.past, today, clockNow]);

  const project = frame.startsWith('p:') ? frame.slice(2) : undefined;

  const setScope = useCallback((s: Scope) => {
    setScopeState(s);
    try {
      localStorage.setItem(SCOPE, s);
    } catch {
      /* storage refused: the choice lasts for this session only */
    }
  }, []);
  const onBoard = useCallback(
    (p?: string) => {
      setScope(p ?? ALL);
      onFrame('board');
    },
    [setScope, onFrame],
  );

  const requestSeen = useRef<number | null>(null);
  useEffect(() => {
    if (!request || requestSeen.current === request.n) return;
    requestSeen.current = request.n;
    if (request.id) setOpenId(request.id);
    if (request.add) quick.current?.focus();
  }, [request]);

  // The Inbox is not a project: it is the board, showing what has none.
  useEffect(() => {
    if (project === '') onBoard('');
  }, [project, onBoard]);
  // A project folder that went away (renamed in Explorer) sends you back to the projects, and the board back to everything.
  useEffect(() => {
    if (loading) return;
    if (project && !projects.includes(project)) onFrame('projects');
    if (scope !== ALL && scope !== '' && !projects.includes(scope)) setScope(ALL);
  }, [project, scope, projects, loading, onFrame, setScope]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
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
        search.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  // Opened from the page, the task grows out of its card, row or action (Becomes).
  const open = useCallback((id: string) => becomes(taskOnPage(id), () => setOpenId(id)), []);
  const close = useCallback(() => setOpenId(null), []);
  const goProject = useCallback((p: string) => onFrame(`p:${p}`), [onFrame]);
  const openNote = useCallback(
    (target: string) => {
      setOpenId(null);
      onOpenNote(target);
    },
    [onOpenNote],
  );
  const expand = useCallback((seed: Omit<ComposerSeed, 'n'>) => setCompose((c) => ({ ...seed, n: (c?.n ?? 0) + 1 })), []);
  const closeComposer = useCallback(() => setCompose(null), []);

  const shown = useMemo(() => tasks.filter((t) => matches(t, { ...NO_FILTER, query, project: scope }, today)), [tasks, query, scope, today]);
  const mine = useMemo(() => (project ? tasks.filter((t) => t.project === project) : []), [tasks, project]);

  const top = (
    <>
      {project !== undefined && (
        <button type="button" className="nxt-round nxt-round--sm" onClick={() => onFrame('projects')} aria-label="All projects" title="All projects">
          <ChevronLeft size={16} strokeWidth={1.9} aria-hidden="true" />
        </button>
      )}
      <QuickAdd ref={quick} project={project ?? (frame === 'board' && scope !== ALL ? scope : undefined)} onExpand={expand} />
      <Switch<'board' | 'projects'>
        label="Tasks or projects"
        value={frame === 'board' ? 'board' : 'projects'}
        onChange={onFrame}
        options={[
          { value: 'board', label: 'Tasks' },
          { value: 'projects', label: 'Projects' },
        ]}
      />
      <span className="nx-top__space" />
      {frame === 'board' && (
        <label className="nxf-find nxt-find">
          <Search size={13} strokeWidth={1.9} aria-hidden="true" />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              if (query) setQuery('');
              else e.currentTarget.blur();
            }}
            placeholder="Filter"
            aria-label="Filter the board"
            spellCheck={false}
          />
          {!query && <span className="fin-key">/</span>}
        </label>
      )}
    </>
  );

  return (
    <>
      <Shell module="tasks" title="Tasks" icon={SquareCheck} apps={apps} onOpenApp={onOpenApp} onAsk={onSearch} top={top} actions={<SaveNotice />} scrollKey={frame}>
        <ErrorBoundary label={`tasks ${frame}`}>
          <div className="nxf-page nxt-page">
            {loadError && (
              <p className="fin-error" role="alert">
                Tasks could not be loaded, so nothing will be saved this session. ({loadError})
              </p>
            )}
            {frame === 'board' && <TaskBoard tasks={tasks} shown={shown} today={today} scope={scope} onScope={setScope} loading={loading} onOpen={open} />}
            {frame === 'projects' && <Projects tasks={tasks} projects={projects} today={today} now={now} onOpen={open} onProject={goProject} onBoard={onBoard} onCalendar={() => onOpenApp('calendar')} />}
            {project !== undefined && project !== '' && (
              <ProjectWorkspace
                key={project}
                project={project}
                tasks={tasks}
                list={<TaskList tasks={mine} today={today} onOpen={open} onBoard={() => onBoard(project)} />}
                onResearch={() => setResearch(true)}
                onOpenTask={open}
                onOpenNote={openNote}
                onRenamed={(name) => onFrame(`p:${name}`)}
                timeline={(p) => <Timeline {...p} />}
              />
            )}
          </div>
        </ErrorBoundary>
      </Shell>

      <TaskSheet id={openId} onClose={close} onOpenNote={openNote} extra={openId ? <Linked thing={{ kind: 'task', id: openId }} before={close} /> : undefined} />
      <Composer seed={compose} onClose={closeComposer} onOpenNote={openNote} />
      <ResearchSheet open={research} onClose={() => setResearch(false)} />
    </>
  );
}
