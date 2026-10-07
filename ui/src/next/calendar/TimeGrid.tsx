/**
 * The hours of one day or seven, with time blocks and the calendar's events.
 *
 * Everything the first calendar could do with the pointer, kept:
 *   drag a task from "To schedule" onto a day   → a block at that time
 *   drag a block                                → move it (15-minute steps)
 *   drag a block's lower edge                   → change how long it is
 *   double-click an empty slot                  → a new task there
 *   click a block / an event                    → the task / the event
 *
 * New: press on an empty slot and drag down to draw a block of the length you
 * want, then name it. Each day says how much time is planned on it, the hours
 * outside the working day are quieter, the list of what still needs a time is
 * grouped by how soon it is due and can be put away, and the same grid shows
 * one day.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from 'sonner';
import type { CalEvent } from '../../calendar/backend';
import { addDays } from '../../finance/format';
import { useTasks } from '../../tasks/TasksContext';
import { ProjectDot } from '../../tasks/components/bits';
import { dueLabel, isOpen, projectLabel } from '../../tasks/derive';
import { parseQuick } from '../../tasks/quickadd';
import { formatEstimate } from '../../tasks/taskfile';
import type { Task } from '../../tasks/types';
import { dayThing, eventThing, liftAttrs, taskThing } from '../lift/things';
import { DAY_MIN, HOUR, SNAP, WEEKDAYS, WEEKDAYS_LONG, clamp, clock, contentsOf, hoursLabel, layout, minuteOf, pad, snap, weekdayOf } from './time';

interface Drag {
  mode: 'move' | 'resize' | 'new';
  task: Task;
  dur: number;
  grab: number;
  day: string | null;
  start: number | null;
  moved: boolean;
  x: number;
  y: number;
  ox: number;
  oy: number;
}

/** The working day, for the quieter hours either side of it. */
const DAY_FROM = 7;
const DAY_TO = 21;

export default function TimeGrid({
  days,
  today,
  now,
  live = true,
  events,
  tray,
  onOpenTask,
  onEvent,
  onDay,
}: {
  days: string[];
  today: string;
  now: Date;
  /** `today` is the real today. When it is not, there is no "now" on the page. */
  live?: boolean;
  events: CalEvent[];
  /** Whether the list of tasks that still need a time is showing. */
  tray: boolean;
  onOpenTask: (id: string) => void;
  onEvent: (event: CalEvent, rect: DOMRect) => void;
  /** A day's name was pressed (the week opens that day). */
  onDay?: (day: string) => void;
}) {
  const { tasks, update, create, projects, undo } = useTasks();
  const [draft, setDraft] = useState<{ day: string; start: number; dur?: number } | null>(null);
  /** A block being drawn on an empty slot. */
  const [draw, setDraw] = useState<{ day: string; from: number; to: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const single = days.length === 1;

  // Opens on the working day: 07:30 at the top.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7.5 * HOUR;
  }, []);

  /* ---------- what is on each day ---------- */

  const perDay = useMemo(
    () =>
      days.map((day) => {
        const c = contentsOf(day, tasks, events);
        return { ...c, items: layout(c.timed) };
      }),
    [days, tasks, events],
  );

  const waiting = useMemo(() => {
    const list = tasks
      .filter((t) => isOpen(t) && t.state !== 'backlog' && !t.scheduled)
      .sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9') || (a.priority ?? 5) - (b.priority ?? 5) || a.title.localeCompare(b.title));
    const soon = addDays(today, 7);
    return [
      { key: 'late', label: 'Late', tone: 'late' as const, list: list.filter((t) => t.due && t.due < today) },
      { key: 'week', label: 'Due within a week', tone: undefined, list: list.filter((t) => t.due && t.due >= today && t.due <= soon) },
      { key: 'rest', label: 'No rush', tone: undefined, list: list.filter((t) => !t.due || t.due > soon).slice(0, 40) },
    ].filter((g) => g.list.length > 0);
  }, [tasks, today]);
  const waitingCount = waiting.reduce((sum, g) => sum + g.list.length, 0);

  /* ---------- dragging ---------- */

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const where = useCallback(
    (x: number, y: number, grab: number): { day: string; minute: number } | null => {
      const b = body.current?.getBoundingClientRect();
      if (!b) return null;
      const i = cols.current.findIndex((c) => {
        const r = c?.getBoundingClientRect();
        return r && x >= r.left && x < r.right;
      });
      if (i < 0 || i >= days.length || y < b.top - 20 || y > b.bottom + 20) return null;
      const minute = ((y - b.top) / HOUR) * 60 - grab;
      return { day: days[i], minute: clamp(snap(minute), 0, DAY_MIN - SNAP) };
    },
    [days],
  );

  const pointerMinute = (y: number) => {
    const b = body.current?.getBoundingClientRect();
    return b ? ((y - b.top) / HOUR) * 60 : 0;
  };

  const begin = (e: ReactPointerEvent, mode: Drag['mode'], task: Task) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const dur = task.estimate ?? 30;
    const start = task.scheduled ? minuteOf(task.scheduled) : 0;
    const grab = mode === 'move' ? clamp(pointerMinute(e.clientY) - start, 0, dur) : mode === 'new' ? 10 : 0;
    setDrag({ mode, task, dur, grab, day: task.scheduled?.slice(0, 10) ?? null, start: task.scheduled ? start : null, moved: false, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.ox, e.clientY - d.oy) > 4;
      if (d.mode === 'resize') {
        const start = d.start ?? 0;
        const end = clamp(snap(pointerMinute(e.clientY)), start + SNAP, DAY_MIN);
        setDrag({ ...d, moved, dur: end - start, x: e.clientX, y: e.clientY });
        return;
      }
      const w = where(e.clientX, e.clientY, d.grab);
      setDrag({ ...d, moved, day: w?.day ?? null, start: w ? Math.min(w.minute, DAY_MIN - d.dur) : null, x: e.clientX, y: e.clientY });
      // Near the top or bottom of the grid, it scrolls.
      const s = scroller.current?.getBoundingClientRect();
      if (s && scroller.current) {
        if (e.clientY < s.top + 36) scroller.current.scrollTop -= 14;
        else if (e.clientY > s.bottom - 36) scroller.current.scrollTop += 14;
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (!d.moved) {
        if (d.mode !== 'resize') onOpenTask(d.task.id);
        return;
      }
      if (d.day === null || d.start === null) return;
      const scheduled = `${d.day}T${clock(d.start)}`;
      if (scheduled === d.task.scheduled && d.dur === (d.task.estimate ?? 30)) return;
      void update(d.task.id, { scheduled, estimate: d.dur }).then((change) => {
        if (change === null) return;
        const label = d.mode === 'resize' ? `${d.task.title}: ${formatEstimate(d.dur)}` : `${d.task.title} → ${WEEKDAYS[weekdayOf(d.day!)]} ${clock(d.start!)}`;
        toast(label, { action: { label: 'Undo', onClick: () => undo(change) } });
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrag(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
    // Bound for the life of one drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  // A block held still is lifted off the page (next/lift): its move ends here.
  useEffect(() => {
    const onLift = () => setDrag(null);
    window.addEventListener('axonix:lift-begin', onLift);
    return () => window.removeEventListener('axonix:lift-begin', onLift);
  }, []);

  /* ---------- drawing a block on an empty slot ---------- */

  const beginDraw = (e: ReactPointerEvent<HTMLDivElement>, day: string) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const from = clamp(snap(pointerMinute(e.clientY) - SNAP / 2), 0, DAY_MIN - SNAP);
    const oy = e.clientY;
    let span: { from: number; to: number } | null = null;
    const onMove = (ev: PointerEvent) => {
      if (!span && Math.abs(ev.clientY - oy) < 6) return;
      const at = clamp(snap(pointerMinute(ev.clientY)), 0, DAY_MIN);
      span = at >= from ? { from, to: Math.max(at, from + SNAP) } : { from: at, to: from + SNAP };
      setDraw({ day, ...span });
    };
    const done = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      setDraw(null);
    };
    const onUp = () => {
      done();
      if (span) setDraft({ day, start: span.from, dur: span.to - span.from });
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      span = null;
      done();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  };

  /* ---------- a new task in a slot ---------- */

  const addAt = async (text: string, day: string, start: number, dur = 30) => {
    const p = parseQuick(text, projects);
    if (!p.title) return false;
    const change = await create({
      title: p.title,
      project: p.project ?? '',
      priority: p.priority,
      due: p.due,
      scheduled: p.scheduled ?? `${day}T${clock(start)}`,
      estimate: p.estimate ?? dur,
      tags: p.tags,
    });
    if (change !== null) toast(`Added ${p.title}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    return change !== null;
  };

  /* ---------- render ---------- */

  // Another day is shown as it stood at its end.
  const nowMin = live ? now.getHours() * 60 + now.getMinutes() : DAY_MIN;
  const nowStamp = live ? `${today}T${clock(nowMin)}` : `${today}T24:00`;
  const showsToday = live && days.includes(today);
  const template = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="nxc-time" data-dragging={drag?.moved || undefined} data-single={single || undefined}>
      <div className="nxc-time__main">
        <div className="nxc-days" role="row" style={template}>
          <span className="nxc-gutter" />
          {perDay.map(({ day, allDay, planned }) => {
            const d = Number(day.slice(8));
            const wd = weekdayOf(day);
            return (
              <div key={day} className="nxc-dayhead" data-today={day === today || undefined} data-past={day < today || undefined} data-drop={`date:${day}`} {...liftAttrs(dayThing(day), { hold: true })}>
                <button type="button" className="nxc-dayhead__name" onClick={onDay ? () => onDay(day) : undefined} disabled={!onDay} title={onDay ? 'Open this day' : undefined}>
                  <span>{single ? WEEKDAYS_LONG[wd] : WEEKDAYS[wd]}</span>
                  <span className="nxc-dayhead__num fin-num">{d}</span>
                  {planned > 0 && <span className="nxc-dayhead__load fin-num">{hoursLabel(planned)}</span>}
                </button>
                <div className="nxc-allday">
                  {allDay.slice(0, single ? 8 : 3).map((a) =>
                    a.task ? (
                      <button key={a.key} type="button" className="nxc-chip nxc-chip--due" onClick={() => onOpenTask(a.task!.id)} title={`Due: ${a.title}`} {...liftAttrs(taskThing(a.task))}>
                        <i aria-hidden="true" />
                        <span>{a.title}</span>
                      </button>
                    ) : (
                      <button key={a.key} type="button" className="nxc-chip" style={{ '--ec': a.event!.color } as CSSProperties} onClick={(e) => onEvent(a.event!, e.currentTarget.getBoundingClientRect())} {...liftAttrs(eventThing(a.event!))}>
                        <span>{a.title}</span>
                      </button>
                    ),
                  )}
                  {!single && allDay.length > 3 && (
                    <button type="button" className="nxc-chip nxc-chip--more" onClick={() => onDay?.(day)}>
                      {allDay.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="nxc-scroll" ref={scroller}>
          <div className="nxc-grid" ref={body} style={{ ...template, height: 24 * HOUR }}>
            <div className="nxc-gutter nxc-hours" aria-hidden="true">
              {Array.from({ length: 23 }, (_, i) =>
                // The hour gives way to the time now when the two would touch.
                showsToday && Math.abs((i + 1) * 60 - nowMin) < 20 ? null : (
                  <span key={i} className="fin-num" style={{ top: (i + 1) * HOUR }}>
                    {pad(i + 1)}:00
                  </span>
                ),
              )}
              {/* The time now stands in the gutter, where it cannot sit on top of a block. */}
              {showsToday && (
                <span className="nxc-hours__now fin-num" style={{ top: (nowMin / 60) * HOUR }}>
                  {clock(nowMin)}
                </span>
              )}
            </div>
            {perDay.map(({ day, items }, i) => (
              <div
                key={day}
                ref={(el) => {
                  cols.current[i] = el;
                }}
                className="nxc-col"
                data-today={day === today || undefined}
                data-over={(drag?.moved && drag.day === day) || undefined}
                data-drop={`day:${day}`}
                onPointerDown={(e) => beginDraw(e, day)}
                onDoubleClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const b = body.current!.getBoundingClientRect();
                  setDraft({ day, start: clamp(snap(((e.clientY - b.top) / HOUR) * 60 - 15), 0, DAY_MIN - SNAP) });
                }}
              >
                <i className="nxc-col__off" style={{ height: DAY_FROM * HOUR }} aria-hidden="true" />
                <i className="nxc-col__off" style={{ top: DAY_TO * HOUR, height: (24 - DAY_TO) * HOUR }} aria-hidden="true" />

                {items.map((it) => {
                  const hidden = drag?.moved && it.task && drag.task.id === it.task.id && drag.mode !== 'resize';
                  const resizing = drag?.mode === 'resize' && it.task && drag.task.id === it.task.id;
                  const end = resizing ? it.start + drag!.dur : it.end;
                  const style = {
                    top: (it.start / 60) * HOUR + 1,
                    height: Math.max(18, ((end - it.start) / 60) * HOUR - 3),
                    left: `calc(${(it.col / it.cols) * 100}% + 2px)`,
                    width: `calc(${100 / it.cols}% - 4px)`,
                  };
                  if (it.kind === 'event') {
                    const e = it.event!;
                    return (
                      <button
                        key={it.key}
                        type="button"
                        className="nxc-ev"
                        title={`${it.title}, ${clock(it.start)}–${clock(it.end)}`}
                        data-short={end - it.start < 45 || undefined}
                        data-past={e.end < nowStamp || undefined}
                        style={{ ...style, '--ec': e.color } as CSSProperties}
                        {...liftAttrs(eventThing(e))}
                        onClick={(ev) => onEvent(e, ev.currentTarget.getBoundingClientRect())}
                      >
                        <span className="nxc-ev__title">{it.title}</span>
                        <span className="nxc-ev__time fin-num">
                          {clock(it.start)}–{clock(it.end)}
                        </span>
                      </button>
                    );
                  }
                  const t = it.task!;
                  return (
                    <div
                      key={it.key}
                      className="nxc-block"
                      data-done={t.state === 'done' || undefined}
                      data-live={(day === today && it.start <= nowMin && end > nowMin && t.state !== 'done') || undefined}
                      data-hidden={hidden || undefined}
                      data-short={end - it.start < 45 || undefined}
                      style={style}
                      role="button"
                      tabIndex={0}
                      aria-label={`${t.title}, ${clock(it.start)} to ${clock(end)}`}
                      {...liftAttrs(taskThing(t), { hold: true })}
                      onPointerDown={(e) => begin(e, 'move', t)}
                      onKeyDown={(e) => e.key === 'Enter' && onOpenTask(t.id)}
                    >
                      <span className="nxc-block__title">
                        {t.project && <ProjectDot name={t.project} />}
                        <span>{t.title}</span>
                      </span>
                      <span className="nxc-block__time fin-num">
                        {clock(it.start)}–{clock(end)}
                        {t.project && ` · ${projectLabel(t.project)}`}
                      </span>
                      <span className="nxc-block__grip" onPointerDown={(e) => begin(e, 'resize', t)} aria-hidden="true" />
                    </div>
                  );
                })}

                {drag?.moved && drag.mode !== 'resize' && drag.day === day && drag.start !== null && (
                  <div className="nxc-block nxc-block--ghost" style={{ top: (drag.start / 60) * HOUR + 1, height: Math.max(18, (drag.dur / 60) * HOUR - 3), left: 2, right: 2 }}>
                    <span className="nxc-block__title">
                      <span>{drag.task.title}</span>
                    </span>
                    <span className="nxc-block__time fin-num">
                      {clock(drag.start)}–{clock(drag.start + drag.dur)}
                    </span>
                  </div>
                )}

                {draw && draw.day === day && (
                  <div className="nxc-block nxc-block--ghost nxc-block--draw" style={{ top: (draw.from / 60) * HOUR + 1, height: Math.max(12, ((draw.to - draw.from) / 60) * HOUR - 3), left: 2, right: 2 }}>
                    <span className="nxc-block__time fin-num">
                      {clock(draw.from)}–{clock(draw.to)} · {formatEstimate(draw.to - draw.from)}
                    </span>
                  </div>
                )}

                {draft && draft.day === day && (
                  <>
                    {draft.dur !== undefined && (
                      <div className="nxc-draft" style={{ top: (draft.start / 60) * HOUR + 1, height: Math.max(26, (draft.dur / 60) * HOUR - 3) }} aria-hidden="true">
                        {draft.dur >= 45 && (
                          <span className="fin-num">
                            until {clock(draft.start + draft.dur)} · {formatEstimate(draft.dur)}
                          </span>
                        )}
                      </div>
                    )}
                    <SlotInput
                      top={(draft.start / 60) * HOUR + 1}
                      time={clock(draft.start)}
                      onCancel={() => setDraft(null)}
                      onSubmit={async (text) => {
                        const ok = await addAt(text, draft.day, draft.start, draft.dur);
                        if (ok) setDraft(null);
                      }}
                    />
                  </>
                )}

                {day === today && live && (
                  <div className="nxc-now" style={{ top: (nowMin / 60) * HOUR }} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {tray && (
        <aside className="nxc-tray" aria-label="Tasks to schedule">
          <div className="nxc-tray__head">
            <h3>To schedule</h3>
            <span className="fin-num">{waitingCount}</span>
          </div>
          <div className="nxc-tray__list">
            {waiting.length ? (
              waiting.map((g) => (
                <div key={g.key} className="nxc-tray__group" data-tone={g.tone}>
                  <p className="nxc-tray__label">
                    {g.label} <span className="fin-num">{g.list.length}</span>
                  </p>
                  {g.list.map((t) => {
                    const due = dueLabel(t, today);
                    return (
                      <div
                        key={t.id}
                        className="nxc-todo"
                        data-dragging={(drag?.moved && drag.task.id === t.id) || undefined}
                        {...liftAttrs(taskThing(t), { hold: true })}
                        onPointerDown={(e) => begin(e, 'new', t)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && onOpenTask(t.id)}
                      >
                        <span className="nxc-todo__title">{t.title}</span>
                        <span className="nxc-todo__meta">
                          <ProjectDot name={t.project} />
                          <span className="nxc-todo__project">{projectLabel(t.project)}</span>
                          {due && (
                            <span className="tsk-due" data-tone={due.tone}>
                              {due.text}
                            </span>
                          )}
                          <span className="fin-num">{formatEstimate(t.estimate ?? 30)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              <p className="nxc-tray__none">Every open task has a time. Add one with Ctrl N, or double-click an empty slot.</p>
            )}
          </div>
          {waiting.length > 0 && <p className="nxc-tray__hint">Drag one onto a day to block time for it.</p>}
        </aside>
      )}

      {drag?.moved && drag.mode === 'new' && drag.day === null && (
        <div className="nxc-float" style={{ left: drag.x + 12, top: drag.y + 8 }} aria-hidden="true">
          {drag.task.title}
        </div>
      )}
    </div>
  );
}

function SlotInput({ top, time, onSubmit, onCancel }: { top: number; time: string; onSubmit: (text: string) => void | Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="nxc-slot" style={{ top }}>
      <span className="fin-num">{time}</span>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="New task"
        aria-label={`New task at ${time}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault();
            void onSubmit(text);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => !text.trim() && onCancel()}
      />
    </div>
  );
}
