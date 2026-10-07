/**
 * Projects — everything about the work that is not the board.
 *
 * Two columns, as in the reference the owner chose (Hark, 2026-10-07): on the
 * left a stack of small panels about the day, on the right the projects.
 *
 * The stack, top to bottom, and each piece is left out when it has nothing to
 * say:
 * - **Today**: what is late, in hand, due or timed today, one action to a
 *   card. A title that opens with a verb gives it up as the button ("Pay" ·
 *   "the water bill"); pressing the button finishes the task, pressing the
 *   card opens it.
 * - **Agenda**: today's time blocks and calendar events, with the time now.
 * - **Ahead**: the next two weeks, soonest first.
 * - **Momentum**: three figures.
 *
 * The projects are one list: mark, name, the goal the owner wrote, how far
 * along. A row is a place, so it lifts and takes a dropped task.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import { addDays, dateOf } from '../../finance/format';
import { mondayOf, useCalendar, useEvents } from '../../calendar/CalendarContext';
import { useTasks } from '../../tasks/TasksContext';
import { agenda, clock, dueLabel, isLate, isOpen, momentum, projectStats, scheduledDay } from '../../tasks/derive';
import { formatEstimate, sanitizeName } from '../../tasks/taskfile';
import type { Task } from '../../tasks/types';
import { ProjectMark, projectGoal, projectIcon } from '../../tasks/components/ProjectWorkspace';
import { ShareBar } from '../charts';
import Count from '../motion/Count';
import { liftAttrs, projectThing, taskThing } from '../lift/things';
import { useToggleDone } from './TaskRow';
import { splitVerb } from './verbs';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** How many actions the stack shows before it points at the board. */
const ACTIONS = 6;
const AHEAD_DAYS = 14;
const AHEAD_ROWS = 6;

/* ------------------------------------------------------------------ */
/* today: one action to a card                                         */
/* ------------------------------------------------------------------ */

function Action({ task, today, onOpen }: { task: Task; today: string; onOpen: (id: string) => void }) {
  const toggle = useToggleDone();
  const [ticking, setTicking] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const { verb, rest } = splitVerb(task.title);
  const due = dueLabel(task, today);
  const time = scheduledDay(task) === today ? task.scheduled!.slice(11) : undefined;

  // The tick is seen where it was made, then the task leaves (as the round checkbox does).
  const finish = () => {
    if (ticking) return;
    setTicking(true);
    timer.current = window.setTimeout(() => {
      toggle(task);
      setTicking(false);
    }, 340);
  };

  return (
    <div
      className="nxt-action"
      role="button"
      tabIndex={0}
      data-late={due?.tone === 'late' || undefined}
      {...liftAttrs(taskThing(task))}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        onOpen(task.id);
      }}
    >
      <button
        type="button"
        className="nxt-action__verb"
        data-ticking={ticking || undefined}
        data-bare={!verb || undefined}
        aria-label={`Finish ${task.title}`}
        title="Finish"
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
      >
        {ticking || !verb ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : verb}
      </button>
      <span className="nxt-action__text">{rest}</span>
      {due?.tone === 'late' ? (
        <span className="nxt-action__meta nxt-action__meta--late">
          <TriangleAlert size={11} strokeWidth={2.2} aria-hidden="true" />
          {due.text}
        </span>
      ) : time ? (
        <span className="nxt-action__meta fin-num">{time}</span>
      ) : task.state === 'doing' ? (
        <span className="nxt-action__meta">In hand</span>
      ) : null}
    </div>
  );
}

function Actions({ tasks, today, onOpen, onBoard }: { tasks: Task[]; today: string; onOpen: (id: string) => void; onBoard: () => void }) {
  const list = useMemo(() => {
    const open = tasks.filter(isOpen);
    const seen = new Set<string>();
    const take = (some: Task[]) => some.filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
    return [
      ...take(open.filter((t) => isLate(t, today)).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))),
      ...take(open.filter((t) => t.state === 'doing')),
      ...take(open.filter((t) => t.due === today)),
      ...take(open.filter((t) => scheduledDay(t) === today).sort((a, b) => (a.scheduled ?? '').localeCompare(b.scheduled ?? ''))),
    ];
  }, [tasks, today]);
  const done = tasks.filter((t) => t.state === 'done' && t.done?.slice(0, 10) === today).length;
  const late = list.filter((t) => isLate(t, today)).length;

  return (
    <section className="nxt-today" aria-label="Today">
      <p className="nxt-eyebrow">
        Today
        <span>
          {list.length ? `${list.length} to do` : 'Nothing due'}
          {late > 0 && <b className="nxt-eyebrow__late"> · {late} late</b>}
          {done > 0 && ` · ${done} done`}
        </span>
      </p>
      {list.slice(0, ACTIONS).map((t) => (
        <Action key={t.id} task={t} today={today} onOpen={onOpen} />
      ))}
      {list.length > ACTIONS && (
        <button type="button" className="nxt-panel__link nxt-today__more" onClick={onBoard}>
          {list.length - ACTIONS} more on the board <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* agenda                                                              */
/* ------------------------------------------------------------------ */

function Agenda({ tasks, today, now, onOpen, onCalendar }: { tasks: Task[]; today: string; now: Date; onOpen: (id: string) => void; onCalendar: () => void }) {
  const { status } = useCalendar();
  const week = mondayOf(today);
  const range = useEvents(week, addDays(week, 6));
  const events = (range?.events ?? []).filter((e) => !e.allDay && e.calendarId !== status?.axonixCalendarId);
  const items = agenda(tasks, today, now, events).filter((i) => i.kind !== 'free');
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (!items.some((i) => i.kind !== 'now')) return null;

  return (
    <section className="nxt-panel" aria-label="Agenda">
      <header className="nxt-panel__head">
        <h3>Agenda</h3>
        <button type="button" className="nxt-panel__link" onClick={onCalendar}>
          Calendar <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>
      <ol className="nxt-agenda">
        {items.map((i, k) => {
          if (i.kind === 'now') {
            return (
              <li key={`now-${k}`} className="nxt-agenda__now">
                <span className="fin-num">{clock(i.start)}</span>
                <i aria-hidden="true" />
              </li>
            );
          }
          if (i.kind === 'event') {
            const e = i.event!;
            return (
              <li key={`ev-${e.id}`} className="nxt-agenda__item" data-past={i.end <= nowMin || undefined}>
                <span className="fin-num">{clock(i.start)}</span>
                <span className="nxt-agenda__bar" style={{ background: e.color }} aria-hidden="true" />
                <span className="nxt-agenda__title">{e.title}</span>
                <span className="nxt-agenda__len fin-num">{formatEstimate(i.end - i.start)}</span>
              </li>
            );
          }
          const t = i.task!;
          return (
            <li key={t.id}>
              <button type="button" className="nxt-agenda__item" data-past={i.end <= nowMin || undefined} {...liftAttrs(taskThing(t))} onClick={() => onOpen(t.id)}>
                <span className="fin-num">{clock(i.start)}</span>
                <span className="nxt-agenda__bar" aria-hidden="true" />
                <span className="nxt-agenda__title">{t.title}</span>
                <span className="nxt-agenda__len fin-num">{formatEstimate(i.end - i.start)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ahead                                                               */
/* ------------------------------------------------------------------ */

function Ahead({ tasks, today, onOpen }: { tasks: Task[]; today: string; onOpen: (id: string) => void }) {
  const last = addDays(today, AHEAD_DAYS);
  const { coming, undated } = useMemo(() => {
    const open = tasks.filter(isOpen);
    const dayOf = (t: Task) => [t.due, scheduledDay(t)].filter((d): d is string => !!d && d > today).sort()[0];
    return {
      coming: open
        .map((t) => ({ task: t, day: dayOf(t) }))
        .filter((r): r is { task: Task; day: string } => !!r.day && r.day <= last)
        .sort((a, b) => a.day.localeCompare(b.day)),
      undated: open.filter((t) => !t.due && !t.scheduled).length,
    };
  }, [tasks, today, last]);
  if (coming.length === 0) return null;

  const label = (day: string) => {
    if (day === addDays(today, 1)) return 'Tomorrow';
    const d = dateOf(day);
    return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
  };

  return (
    <section className="nxt-panel" aria-label="Ahead">
      <header className="nxt-panel__head">
        <h3>Ahead</h3>
        <span className="nxt-panel__aside">Two weeks</span>
      </header>
      <div className="nxt-table">
        {coming.slice(0, AHEAD_ROWS).map(({ task, day }) => (
          <button type="button" key={task.id} className="nxt-table__row" {...liftAttrs(taskThing(task))} onClick={() => onOpen(task.id)}>
            <span className="nxt-table__name">{task.title}</span>
            <span className="nxt-table__end">{label(day)}</span>
          </button>
        ))}
      </div>
      {(coming.length > AHEAD_ROWS || undated > 0) && (
        <p className="nxt-panel__note">{[coming.length > AHEAD_ROWS ? `${coming.length - AHEAD_ROWS} more in these two weeks` : '', undated > 0 ? `${undated} with no date` : ''].filter(Boolean).join(' · ')}</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* momentum                                                            */
/* ------------------------------------------------------------------ */

function MomentumTiles({ tasks, today }: { tasks: Task[]; today: string }) {
  const m = momentum(tasks, today);
  if (m.week === 0 && m.streak === 0) return null;
  const cycle = m.cycleHours === undefined ? '—' : m.cycleHours < 24 ? `${Math.max(1, Math.round(m.cycleHours))}h` : `${(m.cycleHours / 24).toFixed(m.cycleHours < 240 ? 1 : 0)}d`;
  return (
    <section className="nxt-panel" aria-label="Momentum">
      <header className="nxt-panel__head">
        <h3>Momentum</h3>
      </header>
      <div className="nxt-tiles">
        <div className="nxt-tile" title="Tasks finished in the last seven days">
          <span>This week</span>
          <b className="fin-num">{m.week}</b>
        </div>
        <div className="nxt-tile" title="Days in a row with something finished">
          <span>Streak</span>
          <b className="fin-num">{m.streak}d</b>
        </div>
        <div className="nxt-tile" title="Median time from Doing to Done, last 30 days">
          <span>Doing to done</span>
          <b className="fin-num">{cycle}</b>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* the page                                                            */
/* ------------------------------------------------------------------ */

export default function Projects({
  tasks,
  projects,
  today,
  now,
  onOpen,
  onProject,
  onBoard,
  onCalendar,
}: {
  tasks: Task[];
  projects: string[];
  today: string;
  now: Date;
  onOpen: (id: string) => void;
  onProject: (project: string) => void;
  /** Shows a project's tasks (or, with none named, every task) on the board. */
  onBoard: (project?: string) => void;
  onCalendar: () => void;
}) {
  const { createProject } = useTasks();
  const [naming, setNaming] = useState<string | null>(null);
  // A project's mark and goal are workspace preferences; redraw when one changes.
  const [, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((r) => r + 1);
    window.addEventListener('axonix:project-meta', changed);
    return () => window.removeEventListener('axonix:project-meta', changed);
  }, []);

  const stats = useMemo(() => projectStats(tasks, projects, today), [tasks, projects, today]);
  const rows = stats.filter((s) => s.name !== '').sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const inbox = stats.find((s) => s.name === '');
  const open = rows.reduce((sum, s) => sum + s.open, 0);

  const commit = async () => {
    const name = naming?.trim();
    setNaming(null);
    if (!name) return;
    if (await createProject(name)) onProject(sanitizeName(name));
  };

  return (
    <div className="nxt-projects">
      <aside className="nxt-stack" aria-label="The day">
        <Actions tasks={tasks} today={today} onOpen={onOpen} onBoard={() => onBoard()} />
        <Agenda tasks={tasks} today={today} now={now} onOpen={onOpen} onCalendar={onCalendar} />
        <Ahead tasks={tasks} today={today} onOpen={onOpen} />
        <MomentumTiles tasks={tasks} today={today} />
      </aside>

      <section className="nxt-main" aria-label="Projects">
        <header className="nxt-title">
          <div>
            <h2>Projects</h2>
            {rows.length ? (
              <p>
                <Count value={rows.length} /> {rows.length === 1 ? 'project' : 'projects'} · <Count value={open} /> open {open === 1 ? 'task' : 'tasks'}
              </p>
            ) : (
              <p>A project is a piece of work with its own space.</p>
            )}
          </div>
          <button type="button" className="nxt-round" onClick={() => setNaming('')} aria-label="New project" title="New project">
            <Plus size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </header>

        {(rows.length > 0 || naming !== null || (inbox && inbox.open > 0)) && (
          <div className="nxt-rows">
            {naming !== null && (
              <div className="nxt-prow nxt-prow--new">
                <span className="nxt-prow__mark">
                  <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <input
                  autoFocus
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                  onBlur={() => void commit()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void commit();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setNaming(null);
                    }
                  }}
                  placeholder="Project name"
                  aria-label="New project name"
                  spellCheck={false}
                />
              </div>
            )}
            {rows.map((s) => {
              const goal = projectGoal(s.name);
              return (
                <button key={s.name} type="button" className="nxt-prow" data-drop={`project:${s.name}`} {...liftAttrs(projectThing(s.name, s.open), { hold: true })} onClick={() => onProject(s.name)}>
                  <span className="nxt-prow__mark">
                    <ProjectMark value={projectIcon(s.name)} project={s.name} size={17} />
                  </span>
                  <span className="nxt-prow__text">
                    <span className="nxt-prow__name">{s.name}</span>
                    {goal && <span className="nxt-prow__goal">{goal}</span>}
                  </span>
                  {s.late > 0 && (
                    <span className="nxt-prow__late" title={`${s.late} late`}>
                      <TriangleAlert size={11} strokeWidth={2.2} aria-hidden="true" />
                      <span className="fin-num">{s.late}</span>
                    </span>
                  )}
                  {s.total > 0 ? (
                    <span className="nxt-prow__progress" title={`${s.done} of ${s.total} done`}>
                      <span className="fin-num">
                        {s.done}/{s.total}
                      </span>
                      <ShareBar share={s.done / s.total} />
                    </span>
                  ) : (
                    <span className="nxt-prow__progress nxt-prow__progress--none">No tasks yet</span>
                  )}
                  <ChevronRight className="nxt-prow__chev" size={15} strokeWidth={1.9} aria-hidden="true" />
                </button>
              );
            })}
            {inbox && inbox.open > 0 && (
              <button type="button" className="nxt-prow nxt-prow--quiet" data-drop="project:" onClick={() => onBoard('')}>
                <span className="nxt-prow__mark">
                  <ProjectMark project="" size={17} />
                </span>
                <span className="nxt-prow__text">
                  <span className="nxt-prow__name">Inbox</span>
                  <span className="nxt-prow__goal">Tasks without a project</span>
                </span>
                <span className="nxt-prow__progress">
                  <span className="fin-num">{inbox.open}</span>
                </span>
                <ChevronRight className="nxt-prow__chev" size={15} strokeWidth={1.9} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
