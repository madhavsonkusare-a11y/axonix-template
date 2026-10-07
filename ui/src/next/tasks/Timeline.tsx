/**
 * A project's timeline, second version.
 *
 * The first one drew a bar per task on a track with no scale: you could see
 * that one bar was longer than another, not when either was. This one has an
 * axis (weeks, or months on a long project), a line for today, the project's
 * own start and target, and rows in the order the work begins.
 *
 * A bar runs from when the task was made (or first has a date) to when it was
 * finished or is due. Its tone is its state: in hand is blue because it is
 * live, blocked is amber, finished is green.
 */
import { useMemo } from 'react';
import { addDays, dateOf, daysBetween, shortDate } from '../../finance/format';
import type { Task } from '../../tasks/types';
import { StateGlyph } from '../../tasks/components/bits';
import { useDay } from '../scrub/Scrub';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

interface Span {
  task: Task;
  from: string;
  to: string;
}

export default function Timeline({ tasks, start, target, onOpen }: { tasks: Task[]; start?: string; target?: string; onOpen: (id: string) => void }) {
  const today = useDay();
  const spans = useMemo<Span[]>(
    () =>
      tasks
        .filter((t) => t.created || t.due || t.scheduled || t.done)
        .map((task) => {
          const a = (task.created ?? task.scheduled ?? task.due ?? task.done)!.slice(0, 10);
          const b = (task.done ?? task.due ?? task.scheduled ?? task.created)!.slice(0, 10);
          return { task, from: a < b ? a : b, to: a < b ? b : a };
        })
        .sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to)),
    [tasks],
  );

  const scale = useMemo(() => {
    const dates = [start, target, today, ...spans.flatMap((s) => [s.from, s.to])].filter(Boolean) as string[];
    const low = addDays(dates.reduce((m, d) => (d < m ? d : m)), -1);
    const top = dates.reduce((m, d) => (d > m ? d : m));
    const high = addDays(daysBetween(low, top) < 13 ? addDays(low, 13) : top, 1);
    const days = Math.max(1, daysBetween(low, high));
    const at = (day: string) => (daysBetween(low, day) / days) * 100;

    // Weeks while they are readable, then months.
    const ticks: { day: string; label: string }[] = [];
    if (days <= 70) {
      const d = dateOf(low);
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
      for (; iso(d) <= high; d.setDate(d.getDate() + 7)) ticks.push({ day: iso(d), label: `${d.getDate()} ${MONTH[d.getMonth()]}` });
    } else {
      const d = dateOf(low);
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const step = days > 540 ? 3 : 1;
      for (; iso(d) <= high; d.setMonth(d.getMonth() + step)) ticks.push({ day: iso(d), label: d.getMonth() === 0 || days > 540 ? `${MONTH[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : MONTH[d.getMonth()] });
    }
    return { low, high, at, ticks };
  }, [spans, start, target, today]);

  return (
    <section className="nxf-card nxt-timeline">
      <div className="nxf-card__head">
        <h3>Timeline</h3>
        <span className="nxf-card__aside fin-num">
          {shortDate(scale.low)} – {shortDate(scale.high)}
        </span>
      </div>
      {spans.length === 0 ? (
        <p className="fin-empty__text nxt-timeline__none">Add dates or time blocks to tasks and the timeline builds itself.</p>
      ) : (
        <div className="nxt-timeline__body">
          <div className="nxt-timeline__axis" aria-hidden="true">
            <span />
            <div className="nxt-timeline__track">
              {scale.ticks.map((t) => (
                <span key={t.day} className="nxt-timeline__tick fin-num" style={{ left: `${scale.at(t.day)}%` }}>
                  {t.label}
                </span>
              ))}
            </div>
            <span />
          </div>
          <div className="nxt-timeline__rows">
            {/* The grid behind every row: a rule per tick, the project's bounds, and today. */}
            <div className="nxt-timeline__grid" aria-hidden="true">
              <span />
              <div className="nxt-timeline__track">
                {scale.ticks.map((t) => (
                  <i key={t.day} style={{ left: `${scale.at(t.day)}%` }} />
                ))}
                {start && <i className="nxt-timeline__bound" style={{ left: `${scale.at(start)}%` }} title={`Project start, ${shortDate(start)}`} />}
                {target && <i className="nxt-timeline__bound" style={{ left: `${scale.at(target)}%` }} title={`Project target, ${shortDate(target)}`} />}
                <i className="nxt-timeline__today" style={{ left: `${scale.at(today)}%` }} />
              </div>
              <span />
            </div>
            {spans.map(({ task, from, to }) => (
              <button type="button" className="nxt-timeline__row" key={task.id} onClick={() => onOpen(task.id)} title={`${task.title} · ${shortDate(from)}${from === to ? '' : ` – ${shortDate(to)}`}`}>
                <span className="nxt-timeline__name">
                  <StateGlyph state={task.state} size={12} />
                  <span>{task.title}</span>
                </span>
                <span className="nxt-timeline__track">
                  <b data-state={task.state} data-late={task.state !== 'done' && !!task.due && task.due < today ? true : undefined} style={{ left: `${scale.at(from)}%`, width: `max(8px, ${scale.at(to) - scale.at(from)}%)` }} />
                </span>
                <span className="nxt-timeline__end fin-num">{task.state === 'done' ? `Done ${shortDate(to)}` : task.due ? shortDate(task.due) : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
