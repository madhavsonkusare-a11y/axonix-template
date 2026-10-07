/**
 * The month, a week to a row.
 *
 * New in this version: the first calendar could only show seven days. Each day
 * lists what is on it in the order it happens: all-day events, then what has a
 * time, then what is due. A day that holds more than fits says how many more.
 * Pressing a day opens it; pressing a thing opens the thing.
 */
import { useMemo, type CSSProperties } from 'react';
import type { CalEvent } from '../../calendar/backend';
import { useTasks } from '../../tasks/TasksContext';
import { dayThing, eventThing, liftAttrs, taskThing } from '../lift/things';
import { WEEKDAYS, clock, contentsOf, weekNumber } from './time';

const SHOWN = 4;

export default function MonthView({
  days,
  month,
  today,
  events,
  onOpenTask,
  onEvent,
  onDay,
}: {
  /** Whole weeks, Monday first. */
  days: string[];
  /** `YYYY-MM` of the month the page is about; other days are quieter. */
  month: string;
  today: string;
  events: CalEvent[];
  onOpenTask: (id: string) => void;
  onEvent: (event: CalEvent, rect: DOMRect) => void;
  onDay: (day: string) => void;
}) {
  const { tasks } = useTasks();
  const cells = useMemo(
    () =>
      days.map((day) => {
        const c = contentsOf(day, tasks, events);
        const lines = [
          ...c.allDay.filter((a) => a.event).map((a) => ({ key: a.key, title: a.title, time: '', event: a.event, task: undefined, due: false })),
          ...[...c.timed].sort((a, b) => a.start - b.start).map((t) => ({ key: t.key, title: t.title, time: clock(t.start), event: t.event, task: t.task, due: false })),
          ...c.allDay.filter((a) => a.task).map((a) => ({ key: a.key, title: a.title, time: '', event: undefined, task: a.task, due: true })),
        ];
        return { day, lines };
      }),
    [days, tasks, events],
  );
  const weeks = days.length / 7;

  return (
    <div className="nxc-month" style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(0, 1fr))` }}>
      <div className="nxc-month__names" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      {Array.from({ length: weeks }, (_, w) => (
        <div className="nxc-month__week" key={days[w * 7]}>
          <span className="nxc-month__wk fin-num" title={`Week ${weekNumber(days[w * 7])}`}>
            {weekNumber(days[w * 7])}
          </span>
          {cells.slice(w * 7, w * 7 + 7).map(({ day, lines }) => {
            const outside = day.slice(0, 7) !== month;
            const more = lines.length - SHOWN;
            return (
              <div
                key={day}
                className="nxc-cell"
                data-today={day === today || undefined}
                data-outside={outside || undefined}
                data-past={day < today || undefined}
                data-drop={`date:${day}`}
                {...liftAttrs(dayThing(day), { hold: true })}
                onClick={(e) => {
                  if (e.target === e.currentTarget) onDay(day);
                }}
              >
                <button type="button" className="nxc-cell__num fin-num" onClick={() => onDay(day)} aria-label={`Open ${day}`}>
                  {Number(day.slice(8))}
                </button>
                {lines.slice(0, more === 1 ? SHOWN + 1 : SHOWN).map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    className="nxc-line"
                    data-kind={l.event ? 'event' : l.due ? 'due' : 'block'}
                    data-done={l.task?.state === 'done' || undefined}
                    style={l.event ? ({ '--ec': l.event.color } as CSSProperties) : undefined}
                    title={l.due ? `Due: ${l.title}` : l.title}
                    {...liftAttrs(l.task ? taskThing(l.task) : eventThing(l.event!))}
                    onClick={(e) => (l.task ? onOpenTask(l.task.id) : onEvent(l.event!, e.currentTarget.getBoundingClientRect()))}
                  >
                    <i aria-hidden="true" />
                    {l.time && <span className="fin-num">{l.time}</span>}
                    <span className="nxc-line__title">{l.title}</span>
                  </button>
                ))}
                {more > 1 && (
                  <button type="button" className="nxc-line nxc-line--more" onClick={() => onDay(day)}>
                    {more} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
