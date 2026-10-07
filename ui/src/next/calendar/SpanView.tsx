/**
 * Five weeks of every project, as bars.
 *
 * The first calendar had this as a button called Timeline: four weeks, one flat
 * list, no line for today. Here the rows are gathered under their project, the
 * weekends are marked, today has its line, and a bar that began before the
 * window or runs past it is cut square at that end so it reads as continuing.
 *
 * A bar runs from when the task was made (or first has a date) to when it was
 * finished or is due, as on a project's own timeline. Tones match it too:
 * in hand is blue because it is live, blocked is amber, late is red, done green.
 */
import { useMemo } from 'react';
import { addDays, daysBetween, shortDate } from '../../finance/format';
import { useTasks } from '../../tasks/TasksContext';
import { StateGlyph } from '../../tasks/components/bits';
import { ProjectMark, projectIcon } from '../../tasks/components/ProjectWorkspace';
import { projectLabel } from '../../tasks/derive';
import type { Task } from '../../tasks/types';
import { MONTHS, weekdayOf } from './time';

export const SPAN_DAYS = 35;

interface Row {
  task: Task;
  from: string;
  to: string;
}

export default function SpanView({ from, today, onOpenTask }: { from: string; today: string; onOpenTask: (id: string) => void }) {
  const { tasks } = useTasks();
  const days = useMemo(() => Array.from({ length: SPAN_DAYS }, (_, i) => addDays(from, i)), [from]);
  const end = days[SPAN_DAYS - 1];

  const groups = useMemo(() => {
    const rows: Row[] = tasks
      .filter((t) => t.created || t.due || t.scheduled || t.done)
      .map((task) => {
        const a = (task.created ?? task.scheduled ?? task.due ?? task.done)!.slice(0, 10);
        const b = (task.done ?? task.due ?? task.scheduled ?? task.created)!.slice(0, 10);
        return { task, from: a < b ? a : b, to: a < b ? b : a };
      })
      .filter((r) => r.from <= end && r.to >= from)
      .sort((x, y) => x.to.localeCompare(y.to) || x.from.localeCompare(y.from));
    const by = new Map<string, Row[]>();
    for (const r of rows) by.set(r.task.project, [...(by.get(r.task.project) ?? []), r]);
    return [...by.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])));
  }, [tasks, from, end]);

  const at = (day: string) => (clampDay(daysBetween(from, day)) / SPAN_DAYS) * 100;
  const todayIn = today >= from && today <= end;

  return (
    <div className="nxc-span">
      <div className="nxc-span__axis" aria-hidden="true">
        <span />
        <div className="nxc-span__track">
          {days.map((d, i) => {
            const wd = weekdayOf(d);
            const n = Number(d.slice(8));
            return (
              <i key={d} data-weekend={wd > 4 || undefined} data-today={d === today || undefined} data-monday={wd === 0 || undefined}>
                <b>{n === 1 || i === 0 ? MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3) : ''}</b>
                {n}
              </i>
            );
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="fin-empty__text nxc-span__none">Nothing has a date in these five weeks. Give a task a due day or a time block and it shows here.</p>
      ) : (
        <div className="nxc-span__rows">
          {/* Behind every row: the weekends, a rule per week, and today. */}
          <div className="nxc-span__grid" aria-hidden="true">
            <span />
            <div className="nxc-span__track">
              {days.map((d) => {
                const wd = weekdayOf(d);
                return <i key={d} data-weekend={wd > 4 || undefined} data-monday={wd === 0 || undefined} />;
              })}
              {todayIn && <em style={{ left: `${((daysBetween(from, today) + 0.5) / SPAN_DAYS) * 100}%` }} />}
            </div>
          </div>
          {groups.map(([project, rows]) => (
            <section key={project} className="nxc-span__group">
              <h3>
                <span className="nxc-span__mark">
                  <ProjectMark value={projectIcon(project)} project={project} size={13} />
                </span>
                {projectLabel(project)}
                <span className="fin-num">{rows.length}</span>
              </h3>
              {rows.map(({ task, from: a, to: b }) => {
                const left = at(a);
                const right = ((clampDay(daysBetween(from, b)) + 1) / SPAN_DAYS) * 100;
                return (
                  <button type="button" className="nxc-span__row" key={task.id} onClick={() => onOpenTask(task.id)} title={`${task.title} · ${shortDate(a)}${a === b ? '' : ` – ${shortDate(b)}`}`}>
                    <span className="nxc-span__name">
                      <StateGlyph state={task.state} size={12} />
                      <span>{task.title}</span>
                    </span>
                    <span className="nxc-span__track">
                      <b
                        data-state={task.state}
                        data-late={task.state !== 'done' && !!task.due && task.due < today ? true : undefined}
                        data-open-start={a < from || undefined}
                        data-open-end={b > end || undefined}
                        style={{ left: `${left}%`, width: `max(8px, ${right - left}%)` }}
                      />
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const clampDay = (i: number) => Math.min(SPAN_DAYS - 1, Math.max(0, i));
