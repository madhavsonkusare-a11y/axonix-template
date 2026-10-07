/**
 * A task on the board.
 *
 * The whole card is the drag handle and opens the task on click; the round
 * checkbox finishes it. Everything on the card is derived from the file:
 * project, due, time block, priority, subtask progress, whether it has notes.
 */
import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { AlignLeft, Clock, ListChecks, Timer, TriangleAlert } from 'lucide-react';
import type { Task } from '../types';
import { dueLabel, projectLabel } from '../derive';
import { formatEstimate } from '../taskfile';
import { PriorityFlag, ProjectDot, TaskCheck } from './bits';

export interface TaskCardProps extends HTMLAttributes<HTMLDivElement> {
  task: Task;
  today: string;
  showProject: boolean;
  onToggleDone?: () => void;
  /** Rendered in the drag overlay: lifted, not interactive. */
  lifted?: boolean;
  /** The slot the dragged card left behind. */
  placeholder?: boolean;
  /**
   * The new shell's board: the title, then only what decides the day (project,
   * due, a time block that is today's, subtasks). Priority is the ring on the
   * checkbox; estimate, tags and the notes mark wait in the task's panel.
   */
  lean?: boolean;
  style?: CSSProperties;
}

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  { task, today, showProject, onToggleDone, lifted, placeholder, lean, className, ...rest },
  ref,
) {
  const done = task.state === 'done';
  // A finished task's dates and priority are history; the card keeps its project only.
  const due = done ? null : dueLabel(task, today);
  const scheduledElsewhere = task.scheduled && task.scheduled.slice(0, 10) !== task.due && task.scheduled.slice(0, 10) !== today;
  const time = task.scheduled && task.state !== 'done' && !(lean && task.scheduled.slice(0, 10) !== today) ? task.scheduled.slice(11) : undefined;

  return (
    <div
      ref={ref}
      className={['tsk-card', className].filter(Boolean).join(' ')}
      data-state={task.state}
      data-lifted={lifted || undefined}
      data-placeholder={placeholder || undefined}
      data-late={due?.tone === 'late' || undefined}
      {...rest}
    >
      <TaskCheck done={done} priority={task.priority} onToggle={() => onToggleDone?.()} label={done ? `Reopen ${task.title}` : `Finish ${task.title}`} />
      <div className="tsk-card__main">
        <span className="tsk-card__title">{task.title}</span>
        <span className="tsk-card__meta">
          {task.unverified && (
            <span className="fin-auto" title="Written by an agent — not confirmed yet">
              auto
            </span>
          )}
          {showProject && (
            <span className="tsk-meta">
              <ProjectDot name={task.project} />
              {projectLabel(task.project)}
            </span>
          )}
          {due && (
            <span className="tsk-meta tsk-due" data-tone={due.tone}>
              {due.tone === 'late' && <TriangleAlert size={11} strokeWidth={2.2} aria-hidden="true" />}
              {due.tone === 'late' ? <span>{due.text}</span> : <span className={/\d/.test(due.text) ? 'fin-num' : undefined}>{due.text}</span>}
            </span>
          )}
          {time && (
            <span className="tsk-meta" title={scheduledElsewhere ? `Scheduled ${task.scheduled!.replace('T', ' ')}` : 'Time block'}>
              <Clock size={11} strokeWidth={2} aria-hidden="true" />
              <span className="fin-num">
                {scheduledElsewhere ? `${task.scheduled!.slice(8, 10)}/${task.scheduled!.slice(5, 7)} ` : ''}
                {time}
              </span>
            </span>
          )}
          {!lean && task.estimate && !time && !done && (
            <span className="tsk-meta" title="Estimate">
              <Timer size={11} strokeWidth={2} aria-hidden="true" />
              <span className="fin-num">{formatEstimate(task.estimate)}</span>
            </span>
          )}
          {!lean && task.priority && task.priority < 4 && !done && <PriorityFlag priority={task.priority} />}
          {task.checklist.total > 0 && (
            <span className="tsk-meta" data-complete={task.checklist.done === task.checklist.total || undefined} title="Subtasks">
              <ListChecks size={11} strokeWidth={2} aria-hidden="true" />
              <span className="fin-num">
                {task.checklist.done}/{task.checklist.total}
              </span>
            </span>
          )}
          {!lean && task.hasNotes && <AlignLeft className="tsk-meta__icon" size={11} strokeWidth={2} aria-label="Has notes" />}
          {!lean &&
            task.tags.slice(0, 2).map((t) => (
              <span key={t} className="tsk-tag">
                #{t}
              </span>
            ))}
        </span>
      </div>
    </div>
  );
});
