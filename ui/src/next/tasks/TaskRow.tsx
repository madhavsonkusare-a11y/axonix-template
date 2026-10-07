/**
 * A task as one line — the row every list in the new Tasks is made of.
 *
 * The round checkbox is the board's own (`TaskCheck`): it plays its tick
 * before the task leaves, and finishing raises a toast with Undo. Everything
 * shown is derived from the task's file, as on the board's cards.
 */
import { useCallback } from 'react';
import { AlignLeft, Clock, ListChecks, Timer, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useTasks } from '../../tasks/TasksContext';
import { dueLabel, projectLabel } from '../../tasks/derive';
import { formatEstimate } from '../../tasks/taskfile';
import type { Task } from '../../tasks/types';
import { PriorityFlag, ProjectDot, StateGlyph, TaskCheck } from '../../tasks/components/bits';
import { LinkMark, useLinkCount } from '../lift/Links';
import { liftAttrs, taskThing } from '../lift/things';

/** Finish or reopen, with the same toast and Undo the board gives. */
export function useToggleDone(): (task: Task) => void {
  const { update, undo } = useTasks();
  return useCallback(
    (task: Task) => {
      const reopening = task.state === 'done';
      void update(task.id, { state: reopening ? 'todo' : 'done' }).then((change) => {
        if (change !== null && !reopening) toast(`Done: ${task.title}`, { action: { label: 'Undo', onClick: () => undo(change) } });
      });
    },
    [update, undo],
  );
}

export function TaskRow({
  task,
  today,
  onOpen,
  showProject = true,
  showState = false,
  showDue = true,
  day,
}: {
  task: Task;
  today: string;
  onOpen: (id: string) => void;
  showProject?: boolean;
  /** The state's glyph, where rows of several states sit together. */
  showState?: boolean;
  /** Off where the row already sits under its day. */
  showDue?: boolean;
  /** The day the row is listed under, when it is not today: a time block on another day then says which. */
  day?: string;
}) {
  const toggle = useToggleDone();
  const links = useLinkCount({ kind: 'task', id: task.id });
  const done = task.state === 'done';
  const due = done || !showDue ? null : dueLabel(task, today);
  const time = task.scheduled && !done ? task.scheduled.slice(11) : undefined;
  const anchor = day ?? today;
  const elsewhere = task.scheduled && task.scheduled.slice(0, 10) !== anchor && (day !== undefined || task.scheduled.slice(0, 10) !== task.due);

  return (
    <div
      className="nxt-row"
      role="button"
      tabIndex={0}
      data-state={task.state}
      data-late={due?.tone === 'late' || undefined}
      {...liftAttrs(taskThing(task))}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        onOpen(task.id);
      }}
    >
      <TaskCheck done={done} priority={task.priority} onToggle={() => toggle(task)} label={done ? `Reopen ${task.title}` : `Finish ${task.title}`} />
      <span className="nxt-row__title">
        {showState && !done && <StateGlyph state={task.state} size={12} />}
        <span>{task.title}</span>
        <LinkMark count={links} />
        {task.unverified && (
          <span className="fin-auto" title="Written by an agent — not confirmed yet">
            auto
          </span>
        )}
      </span>
      <span className="nxt-row__meta">
        {task.checklist.total > 0 && (
          <span className="tsk-meta" data-complete={task.checklist.done === task.checklist.total || undefined} title="Subtasks">
            <ListChecks size={11} strokeWidth={2} aria-hidden="true" />
            <span className="fin-num">
              {task.checklist.done}/{task.checklist.total}
            </span>
          </span>
        )}
        {task.hasNotes && <AlignLeft className="tsk-meta__icon" size={11} strokeWidth={2} aria-label="Has notes" />}
        {task.tags.slice(0, 2).map((t) => (
          <span key={t} className="tsk-tag">
            #{t}
          </span>
        ))}
        {task.priority && task.priority < 4 && !done && <PriorityFlag priority={task.priority} />}
        {task.estimate && !time && !done && (
          <span className="tsk-meta" title="Estimate">
            <Timer size={11} strokeWidth={2} aria-hidden="true" />
            <span className="fin-num">{formatEstimate(task.estimate)}</span>
          </span>
        )}
        {time && (
          <span className="tsk-meta" title={elsewhere ? `Scheduled ${task.scheduled!.replace('T', ' ')}` : 'Time block'}>
            <Clock size={11} strokeWidth={2} aria-hidden="true" />
            <span className="fin-num">
              {elsewhere ? `${task.scheduled!.slice(8, 10)}/${task.scheduled!.slice(5, 7)} ` : ''}
              {time}
            </span>
          </span>
        )}
        {due && (
          <span className="tsk-meta tsk-due" data-tone={due.tone}>
            {due.tone === 'late' && <TriangleAlert size={11} strokeWidth={2.2} aria-hidden="true" />}
            <span className={due.tone !== 'late' && /\d/.test(due.text) ? 'fin-num' : undefined}>{due.text}</span>
          </span>
        )}
        {showProject && (
          <span className="tsk-meta nxt-row__project">
            <ProjectDot name={task.project} />
            {projectLabel(task.project)}
          </span>
        )}
      </span>
    </div>
  );
}
