/**
 * A project's tasks, one to a line.
 *
 * The board is Tasks now, so a project reads its own work as a list: grouped
 * by state in the order it needs attention, each line tickable in place. Done
 * shows a week, as the board's last column does.
 */
import { useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { byOrder, isOpen, recentlyDone } from '../../tasks/derive';
import { STATE_LABEL, type Task, type TaskState } from '../../tasks/types';
import { StateGlyph } from '../../tasks/components/bits';
import { TaskRow } from './TaskRow';

/** The order a list is read in: what is moving, what is queued, what is stuck, then the rest. */
const LIST_ORDER: TaskState[] = ['doing', 'todo', 'blocked', 'backlog', 'done'];

export default function TaskList({ tasks, today, onOpen, onBoard }: { tasks: Task[]; today: string; onOpen: (id: string) => void; /** Shows these tasks on the board. */ onBoard: () => void }) {
  const [older, setOlder] = useState(false);
  const groups = useMemo(
    () =>
      LIST_ORDER.map((state) => {
        const all = tasks.filter((t) => t.state === state).sort(byOrder);
        const shown = state === 'done' && !older ? all.filter((t) => recentlyDone(t, today)) : all;
        return { state, shown, hidden: all.length - shown.length };
      }).filter((g) => g.shown.length > 0 || g.hidden > 0),
    [tasks, today, older],
  );
  const open = tasks.filter(isOpen).length;

  return (
    <section className="nxt-panel nxt-list" aria-label="Tasks">
      <header className="nxt-panel__head">
        <h3>
          {open} open
          {tasks.length > open ? <span> · {tasks.length - open} done</span> : null}
        </h3>
        <button type="button" className="nxt-panel__link" onClick={onBoard}>
          Board <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>
      {groups.length === 0 ? (
        <p className="nxt-none">No tasks here yet. Type one in the field above.</p>
      ) : (
        groups.map((g) => (
          <div className="nxt-group" key={g.state}>
            <p className="nxt-group__label">
              <StateGlyph state={g.state} size={12} />
              {STATE_LABEL[g.state]} <span className="fin-num">{g.shown.length}</span>
            </p>
            {g.shown.map((t) => (
              <TaskRow key={t.id} task={t} today={today} onOpen={onOpen} showProject={false} />
            ))}
            {g.state === 'done' && (g.hidden > 0 || older) && (
              <button type="button" className="nxf-more" onClick={() => setOlder((v) => !v)}>
                {older ? 'Show the last week only' : `Show ${g.hidden} older`}
              </button>
            )}
          </div>
        ))
      )}
    </section>
  );
}
