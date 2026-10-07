/**
 * Tasks: the board, and nothing else.
 *
 * Five columns of every task there is. One row above them says whose tasks
 * are showing: all of them, the Inbox, or one project. That row replaces the
 * project menu and the swimlanes; the filter in the top bar replaces the due
 * and priority menus (a late task is red on its card, an urgent one has a red
 * ring). A list of the same tasks lives where a list is wanted: on a project.
 *
 * The board itself is the first Tasks' own (`tasks/components/Board.tsx`):
 * drag between columns, a `+` on a column when the pointer is over it, Done
 * shows a week.
 *
 * At the foot of Done: **Delete finished** (owner, 2026-10-07: "add an option
 * to delete completed tasks"). It moves every finished task that is showing
 * to the trash, the ones older than a week included, after asking in place.
 * One change, so one Undo brings them all back; `Tasks/.trash` keeps the files.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTasks } from '../../tasks/TasksContext';
import { isLate, isOpen } from '../../tasks/derive';
import type { Task } from '../../tasks/types';
import Board from '../../tasks/components/Board';
import { ProjectMark, projectIcon } from '../../tasks/components/ProjectWorkspace';
import { liftAttrs, projectThing } from '../lift/things';
import { useAsOf } from '../scrub/Scrub';
import Count from '../motion/Count';

/** Whose tasks the board shows: every one (`*`), the Inbox (`''`), or a project by name. */
export type Scope = string;
export const ALL: Scope = '*';

/** Asks in place, then moves the finished tasks to the trash as one change. */
function DeleteFinished({ done }: { done: Task[] }) {
  const { trashMany, undo } = useTasks();
  const [asking, setAsking] = useState(false);
  // The question is about a number: if that changes under it, ask again.
  useEffect(() => setAsking(false), [done.length]);
  if (done.length === 0) return null;
  const n = done.length;
  const words = n === 1 ? '1 finished task' : `${n} finished tasks`;

  if (!asking) {
    return (
      <button type="button" className="tsk-col__older nxt-clear" onClick={() => setAsking(true)}>
        Delete finished
      </button>
    );
  }
  return (
    <span className="fin-confirm nxt-clear">
      <span className="nxt-clear__ask">Move {words} to the trash?</span>
      <button
        type="button"
        className="fin-link fin-link--danger"
        autoFocus
        onClick={() => {
          setAsking(false);
          void trashMany(done.map((t) => t.id)).then((change) => {
            if (change !== null) toast(`Moved ${words} to the trash`, { description: 'Tasks/.trash keeps them', action: { label: 'Undo', onClick: () => undo(change) } });
          });
        }}
      >
        Move
      </button>
      <button type="button" className="fin-link" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}

export default function TaskBoard({
  tasks,
  shown,
  today,
  scope,
  onScope,
  loading,
  onOpen,
}: {
  /** Every task, for the counts on the row. */
  tasks: Task[];
  /** The tasks on the board: already narrowed to the scope and the filter. */
  shown: Task[];
  today: string;
  scope: Scope;
  onScope: (scope: Scope) => void;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  const { projects } = useTasks();
  const { live } = useAsOf();
  // A project's mark is a workspace preference; redraw when one changes.
  const [, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((r) => r + 1);
    window.addEventListener('axonix:project-meta', changed);
    return () => window.removeEventListener('axonix:project-meta', changed);
  }, []);

  const openIn = (p?: string) => tasks.filter((t) => isOpen(t) && (p === undefined || t.project === p)).length;
  const lateIn = (p: string) => tasks.filter((t) => isLate(t, today) && t.project === p).length;
  const inbox = openIn('');

  /** A project's open count or, in red, how many of them are late. "All" only counts. */
  const count = (p?: string) => {
    const late = p === undefined ? 0 : lateIn(p);
    const open = openIn(p);
    if (late)
      return (
        <span className="nxt-scope__late fin-num" title={`${late} late`}>
          <Count value={late} />
        </span>
      );
    return open ? <Count className="nxt-scope__count fin-num" value={open} /> : null;
  };

  return (
    <section className="nxt-board" aria-label="Board">
      {(projects.length > 0 || inbox > 0) && (
        <nav className="nxt-scopes" aria-label="Whose tasks">
          <button type="button" className="nxt-scope" aria-pressed={scope === ALL} onClick={() => onScope(ALL)}>
            All
            {count()}
          </button>
          {(inbox > 0 || scope === '') && (
            <button type="button" className="nxt-scope" aria-pressed={scope === ''} data-drop="project:" onClick={() => onScope('')}>
              Inbox
              {count('')}
            </button>
          )}
          {projects.map((p) => (
            <button key={p} type="button" className="nxt-scope" aria-pressed={scope === p} data-drop={`project:${p}`} {...liftAttrs(projectThing(p, openIn(p)), { hold: true })} onClick={() => onScope(scope === p ? ALL : p)}>
              <span className="nxt-scope__mark">
                <ProjectMark value={projectIcon(p)} project={p} size={13} />
              </span>
              <span className="nxt-scope__name">{p}</span>
              {count(p)}
            </button>
          ))}
        </nav>
      )}
      {!loading && (
        <Board
          tasks={shown}
          grouping="none"
          showProject={scope === ALL}
          today={today}
          project={scope === ALL ? undefined : scope}
          lean
          // Another day is for looking, not changing: the option is not offered there.
          doneFoot={live ? <DeleteFinished done={shown.filter((t) => t.state === 'done')} /> : undefined}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}
