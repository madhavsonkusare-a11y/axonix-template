/**
 * Calendar — the week, with Google Calendar's events beside your time blocks.
 *
 * Time blocks are tasks with a `scheduled` time; they work with or without
 * Google, and with Google connected each one is also an event on the "Axonix"
 * calendar (two-way, see CalendarContext). Google's own events show in their
 * calendar's colour and open in Google.
 *
 *   drag a task from "To schedule" onto the week   → a block at that time
 *   drag a block                                   → move it (15-minute steps)
 *   drag a block's lower edge                      → change how long it is
 *   double-click an empty slot                     → a new task there
 *   click a block / an event                       → the task / the event
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, MapPin, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useTasks } from '../tasks/TasksContext';
import { dueLabel, isOpen, projectLabel, todayIso } from '../tasks/derive';
import { addDays } from '../finance/format';
import { parseQuick } from '../tasks/quickadd';
import { formatEstimate } from '../tasks/taskfile';
import type { Task } from '../tasks/types';
import { ProjectDot } from '../tasks/components/bits';
import { clockOf } from '../finance/format';
import { desktop } from '../finance/desktop';
import { mondayOf, useCalendar, useEvents } from './CalendarContext';
import type { CalEvent } from './backend';
import CalendarSheet from './CalendarSheet';

const HOUR = 52;
const SNAP = 15;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const minuteOf = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function weekNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
}

interface Item {
  key: string;
  kind: 'task' | 'event';
  start: number;
  end: number;
  title: string;
  task?: Task;
  event?: CalEvent;
  col: number;
  cols: number;
}

/** Side by side where they overlap, full width where they don't. */
function layout(items: Omit<Item, 'col' | 'cols'>[]): Item[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Item[] = [];
  let cluster: Item[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((i) => i.col + 1));
    for (const i of cluster) i.cols = cols;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.col));
    let col = 0;
    while (taken.has(col)) col++;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

type Drag =
  | { mode: 'move' | 'resize' | 'new'; task: Task; dur: number; grab: number; day: string | null; start: number | null; moved: boolean; x: number; y: number; ox: number; oy: number };

export default function CalendarFrame({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { tasks, update, create, projects, undo } = useTasks();
  const cal = useCalendar();
  const today = todayIso();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const ev = useEvents(days[0], days[6]);
  const [sheet, setSheet] = useState(false);
  const [view, setView] = useState<'week' | 'gantt'>('week');
  const [popover, setPopover] = useState<{ event: CalEvent; rect: DOMRect } | null>(null);
  const [draft, setDraft] = useState<{ day: string; start: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);

  // Opens on the working day: 07:30 at the top.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7.5 * HOUR;
  }, []);

  const connected = !!cal.status?.connected;
  const axonixCal = cal.status?.axonixCalendarId;
  const events = useMemo(() => (ev?.events ?? []).filter((e) => e.calendarId !== axonixCal), [ev, axonixCal]);

  /* ---------- what is on each day ---------- */

  const perDay = useMemo(() => {
    return days.map((day) => {
      const items: Omit<Item, 'col' | 'cols'>[] = [];
      for (const t of tasks) {
        if (!t.scheduled || t.scheduled.slice(0, 10) !== day) continue;
        const start = minuteOf(t.scheduled);
        items.push({ key: `t:${t.id}`, kind: 'task', start, end: Math.min(24 * 60, start + (t.estimate ?? 30)), title: t.title, task: t });
      }
      for (const e of events) {
        if (e.allDay) continue;
        const sDay = e.start.slice(0, 10);
        const eDay = e.end.slice(0, 10);
        if (day < sDay || day > eDay) continue;
        const start = day === sDay ? minuteOf(e.start) : 0;
        const end = day === eDay ? minuteOf(e.end) : 24 * 60;
        if (end <= start) continue;
        items.push({ key: `e:${e.id}:${day}`, kind: 'event', start, end, title: e.title, event: e });
      }
      const allDay = [
        // Google's all-day end is the day after (exclusive).
        ...events.filter((e) => e.allDay && e.start <= day && (e.end > day || (e.end <= e.start && e.start === day))).map((e) => ({ key: `ae:${e.id}`, title: e.title, event: e as CalEvent | undefined, task: undefined as Task | undefined })),
        ...tasks.filter((t) => isOpen(t) && t.due === day && !t.scheduled).map((t) => ({ key: `due:${t.id}`, title: t.title, event: undefined as CalEvent | undefined, task: t as Task | undefined })),
      ];
      return { day, items: layout(items), allDay };
    });
  }, [days, tasks, events]);

  const unscheduled = useMemo(
    () =>
      tasks
        .filter((t) => isOpen(t) && t.state !== 'backlog' && !t.scheduled)
        .sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9') || (a.priority ?? 5) - (b.priority ?? 5) || a.title.localeCompare(b.title))
        .slice(0, 40),
    [tasks],
  );

  /* ---------- dragging ---------- */

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const where = useCallback((x: number, y: number, grab: number): { day: string; minute: number } | null => {
    const b = body.current?.getBoundingClientRect();
    if (!b) return null;
    const i = cols.current.findIndex((c) => {
      const r = c?.getBoundingClientRect();
      return r && x >= r.left && x < r.right;
    });
    if (i < 0 || y < b.top - 20 || y > b.bottom + 20) return null;
    const minute = ((y - b.top) / HOUR) * 60 - grab;
    return { day: days[i], minute: clamp(snap(minute), 0, 24 * 60 - SNAP) };
  }, [days]);

  const pointerMinute = (y: number) => {
    const b = body.current?.getBoundingClientRect();
    return b ? ((y - b.top) / HOUR) * 60 : 0;
  };

  const begin = (e: React.PointerEvent, mode: Drag['mode'], task: Task) => {
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
        const end = clamp(snap(pointerMinute(e.clientY)), start + SNAP, 24 * 60);
        setDrag({ ...d, moved, dur: end - start, x: e.clientX, y: e.clientY });
        return;
      }
      const w = where(e.clientX, e.clientY, d.grab);
      setDrag({ ...d, moved, day: w?.day ?? null, start: w ? Math.min(w.minute, 24 * 60 - d.dur) : null, x: e.clientX, y: e.clientY });
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
        const label = d.mode === 'resize' ? `${d.task.title}: ${formatEstimate(d.dur)}` : `${d.task.title} → ${WEEKDAYS[(new Date(`${d.day}T00:00`).getDay() + 6) % 7]} ${clock(d.start!)}`;
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

  /* ---------- a new task in a slot ---------- */

  const addAt = async (text: string, day: string, start: number) => {
    const p = parseQuick(text, projects);
    if (!p.title) return false;
    const change = await create({
      title: p.title,
      project: p.project ?? '',
      priority: p.priority,
      due: p.due,
      scheduled: p.scheduled ?? `${day}T${clock(start)}`,
      estimate: p.estimate ?? 30,
      tags: p.tags,
    });
    if (change !== null) toast(`Added ${p.title}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    return change !== null;
  };

  /* ---------- render ---------- */

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const first = days[0].split('-').map(Number);
  const last = days[6].split('-').map(Number);
  const title = first[1] === last[1] ? `${MONTHS[first[1] - 1]} ${first[0]}` : `${MONTHS[first[1] - 1].slice(0, 3)} – ${MONTHS[last[1] - 1].slice(0, 3)} ${last[0]}`;
  const status = cal.status;

  if (view === 'gantt') return <div className="cal cal--gantt"><div className="cal-main"><header className="cal-head"><div className="cal-nav"><button type="button" className="fin-pill fin-pill--sm" onClick={() => setView('week')}><CalendarDays size={13} /> Week</button><button type="button" className="fin-pill fin-pill--sm" disabled><BarChart3 size={13} /> Timeline</button></div><h2 className="cal-title">Project timeline<span className="cal-week">Four-week view</span></h2></header><GanttView tasks={tasks} from={weekStart} onOpen={onOpenTask} /></div></div>;

  return (
    <div className="cal" data-dragging={drag?.moved || undefined}>
      <div className="cal-main">
        <header className="cal-head">
          <div className="cal-nav">
            <button type="button" className="fin-icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
              <ChevronLeft size={15} strokeWidth={1.9} />
            </button>
            <button type="button" className="fin-icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
              <ChevronRight size={15} strokeWidth={1.9} />
            </button>
            <button type="button" className="fin-pill fin-pill--sm" onClick={() => setWeekStart(mondayOf(today))} disabled={weekStart === mondayOf(today)}>
              Today
            </button>
          </div>
          <h2 className="cal-title">
            {title}
            <span className="cal-week fin-num">Week {weekNumber(days[0])}</span>
          </h2>
          <span className="fin-spacer" />
          <button type="button" className="fin-pill fin-pill--sm" onClick={() => setView('gantt')}><BarChart3 size={13} /> Timeline</button>
          {connected && (status?.error || ev?.stale || cal.syncing) ? (
            <span className="cal-sync" data-state={status?.error ? 'error' : cal.syncing ? 'syncing' : 'stale'}>
              {status?.error ? (
                <>
                  <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
                  {status.error}
                </>
              ) : cal.syncing ? (
                'Syncing…'
              ) : (
                `Offline copy from ${clockOf(new Date(ev!.fetchedAt))}`
              )}
            </span>
          ) : null}
          {connected && (
            <button
              type="button"
              className="fin-icon-btn"
              onClick={() => void cal.syncNow()}
              aria-label="Sync with Google now"
              title={status?.lastSync ? `Synced with Google at ${clockOf(new Date(status.lastSync))}` : 'Sync with Google now'}
            >
              <RefreshCw size={13} strokeWidth={1.9} />
            </button>
          )}
          <button type="button" className={connected ? 'fin-pill fin-pill--sm' : 'fin-pill fin-pill--action fin-pill--sm'} onClick={() => setSheet(true)}>
            {connected ? 'Calendars' : 'Connect Google Calendar'}
          </button>
        </header>

        <div className="cal-days" role="row">
          <span className="cal-gutter" />
          {perDay.map(({ day, allDay }) => {
            const [y, m, d] = day.split('-').map(Number);
            const wd = WEEKDAYS[(new Date(y, m - 1, d).getDay() + 6) % 7];
            return (
              <div key={day} className="cal-day" data-today={day === today || undefined} data-past={day < today || undefined}>
                <div className="cal-day__name">
                  <span>{wd}</span>
                  <span className="cal-day__num fin-num">{d}</span>
                </div>
                <div className="cal-allday">
                  {allDay.slice(0, 3).map((a) =>
                    a.task ? (
                      <button key={a.key} type="button" className="cal-chip cal-chip--due" onClick={() => onOpenTask(a.task!.id)} title={`Due: ${a.title}`}>
                        <span className="cal-chip__ring" aria-hidden="true" />
                        {a.title}
                      </button>
                    ) : (
                      <button
                        key={a.key}
                        type="button"
                        className="cal-chip"
                        style={{ '--ec': a.event!.color } as React.CSSProperties}
                        onClick={(e) => setPopover({ event: a.event!, rect: e.currentTarget.getBoundingClientRect() })}
                      >
                        {a.title}
                      </button>
                    ),
                  )}
                  {allDay.length > 3 && <span className="cal-chip cal-chip--more">+{allDay.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="cal-scroll" ref={scroller}>
          <div className="cal-grid" ref={body} style={{ height: 24 * HOUR }}>
            <div className="cal-gutter cal-hours" aria-hidden="true">
              {Array.from({ length: 23 }, (_, i) => (
                <span key={i} className="fin-num" style={{ top: (i + 1) * HOUR }}>
                  {pad(i + 1)}:00
                </span>
              ))}
            </div>
            {perDay.map(({ day, items }, i) => (
              <div
                key={day}
                ref={(el) => {
                  cols.current[i] = el;
                }}
                className="cal-col"
                data-today={day === today || undefined}
                data-over={(drag?.moved && drag.day === day) || undefined}
                onDoubleClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const b = body.current!.getBoundingClientRect();
                  setDraft({ day, start: clamp(snap(((e.clientY - b.top) / HOUR) * 60 - 15), 0, 24 * 60 - SNAP) });
                }}
              >
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
                        className="cal-ev"
                        title={`${it.title}, ${clock(it.start)}–${clock(it.end)}`}
                        data-short={end - it.start < 45 || undefined}
                        data-past={e.end < `${today}T${clock(nowMin)}` || undefined}
                        style={{ ...style, '--ec': e.color } as React.CSSProperties}
                        onClick={(ev2) => setPopover({ event: e, rect: ev2.currentTarget.getBoundingClientRect() })}
                      >
                        <span className="cal-ev__title">{it.title}</span>
                        <span className="cal-ev__time fin-num">
                          {clock(it.start)}–{clock(it.end)}
                        </span>
                      </button>
                    );
                  }
                  const t = it.task!;
                  return (
                    <div
                      key={it.key}
                      className="cal-block"
                      data-done={t.state === 'done' || undefined}
                      data-hidden={hidden || undefined}
                      data-short={end - it.start < 45 || undefined}
                      style={style}
                      role="button"
                      tabIndex={0}
                      aria-label={`${t.title}, ${clock(it.start)} to ${clock(end)}`}
                      onPointerDown={(e) => begin(e, 'move', t)}
                      onKeyDown={(e) => e.key === 'Enter' && onOpenTask(t.id)}
                    >
                      <span className="cal-block__title">{t.title}</span>
                      <span className="cal-block__time fin-num">
                        {clock(it.start)}–{clock(end)}
                        {t.project && <span className="cal-block__proj"> · {projectLabel(t.project)}</span>}
                      </span>
                      <span className="cal-block__grip" onPointerDown={(e) => begin(e, 'resize', t)} aria-hidden="true" />
                    </div>
                  );
                })}

                {drag?.moved && drag.mode !== 'resize' && drag.day === day && drag.start !== null && (
                  <div className="cal-block cal-block--ghost" style={{ top: (drag.start / 60) * HOUR + 1, height: Math.max(18, (drag.dur / 60) * HOUR - 3), left: 2, right: 2 }}>
                    <span className="cal-block__title">{drag.task.title}</span>
                    <span className="cal-block__time fin-num">
                      {clock(drag.start)}–{clock(drag.start + drag.dur)}
                    </span>
                  </div>
                )}

                {draft && draft.day === day && (
                  <SlotInput
                    top={(draft.start / 60) * HOUR + 1}
                    time={clock(draft.start)}
                    onCancel={() => setDraft(null)}
                    onSubmit={async (text) => {
                      const ok = await addAt(text, draft.day, draft.start);
                      if (ok) setDraft(null);
                    }}
                  />
                )}

                {day === today && (
                  <div className="cal-now" style={{ top: (nowMin / 60) * HOUR }} aria-hidden="true">
                    <span className="cal-now__label fin-num">{clock(nowMin)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="cal-side" aria-label="Tasks to schedule">
        <h3>To schedule</h3>
        <p className="fin-hint">Drag a task onto the week to block time for it.</p>
        <div className="cal-side__list">
          {unscheduled.length ? (
            unscheduled.map((t) => {
              const due = dueLabel(t, today);
              return (
                <div key={t.id} className="cal-todo" data-dragging={(drag?.moved && drag.task.id === t.id) || undefined} onPointerDown={(e) => begin(e, 'new', t)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpenTask(t.id)}>
                  <span className="cal-todo__title">{t.title}</span>
                  <span className="cal-todo__meta">
                    <ProjectDot name={t.project} />
                    {projectLabel(t.project)}
                    {due && (
                      <span className="tsk-due" data-tone={due.tone}>
                        · {due.text}
                      </span>
                    )}
                    <span className="fin-num">· {formatEstimate(t.estimate ?? 30)}</span>
                  </span>
                </div>
              );
            })
          ) : (
            <p className="cal-side__none">Every open task has a time, or there are none. Add one with Ctrl N.</p>
          )}
        </div>
      </aside>

      {drag?.moved && drag.mode === 'new' && drag.day === null && (
        <div className="cal-float" style={{ left: drag.x + 12, top: drag.y + 8 }} aria-hidden="true">
          {drag.task.title}
        </div>
      )}

      {popover && <EventPopover event={popover.event} rect={popover.rect} onClose={() => setPopover(null)} />}
      <CalendarSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}

function GanttView({ tasks, from, onOpen }: { tasks: Task[]; from: string; onOpen: (id: string) => void }) {
  const days = Array.from({ length: 28 }, (_, i) => addDays(from, i));
  const end = days[27];
  const shown = tasks.filter((t) => { const a = t.created?.slice(0, 10) ?? t.scheduled?.slice(0, 10) ?? t.due; const b = t.done?.slice(0, 10) ?? t.due ?? t.scheduled?.slice(0, 10) ?? a; return a && b && a <= end && b >= from; }).sort((a, b) => a.project.localeCompare(b.project) || (a.due ?? '9').localeCompare(b.due ?? '9'));
  const dayIndex = (iso: string) => Math.round((new Date(`${iso}T00:00`).getTime() - new Date(`${from}T00:00`).getTime()) / 864e5);
  return <div className="cal-gantt"><div className="cal-gantt__days"><span>Task</span>{days.map((d, i) => <i key={d} data-weekend={[5,6].includes(i % 7) || undefined}><b>{i % 7 === 0 ? new Date(`${d}T00:00`).toLocaleDateString(undefined, { month: 'short' }) : ''}</b>{new Date(`${d}T00:00`).getDate()}</i>)}</div><div className="cal-gantt__rows">{shown.map((t) => { const a = t.created?.slice(0, 10) ?? t.scheduled?.slice(0, 10) ?? t.due!; const b = t.done?.slice(0, 10) ?? t.due ?? t.scheduled?.slice(0, 10) ?? a; const left = Math.max(0, dayIndex(a)); const right = Math.min(27, dayIndex(b)); return <button key={t.id} onClick={() => onOpen(t.id)}><span><ProjectDot name={t.project} /><em>{t.title}</em></span><i className="cal-gantt__track"><b data-state={t.state} style={{ left: `${(left / 28) * 100}%`, width: `${(Math.max(1, right - left + 1) / 28) * 100}%` }} /></i></button>; })}</div>{!shown.length && <p className="prj-empty">Add created and due dates to tasks to build the project timeline.</p>}</div>;
}

function SlotInput({ top, time, onSubmit, onCancel }: { top: number; time: string; onSubmit: (text: string) => void | Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="cal-slot" style={{ top }}>
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

function EventPopover({ event, rect, onClose }: { event: CalEvent; rect: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect.right + 8;
    if (left + w > innerWidth - 8) left = rect.left - w - 8;
    const top = clamp(rect.top, 8, innerHeight - h - 8);
    setPos({ left: clamp(left, 8, innerWidth - w - 8), top });
  }, [rect]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const when = event.allDay
    ? event.end > event.start && addDays(event.start, 1) !== event.end
      ? `${event.start} – ${addDays(event.end, -1)}, all day`
      : 'All day'
    : `${event.start.slice(11)} – ${event.end.slice(11)}`;
  return (
    <div ref={ref} className="cal-pop" role="dialog" aria-label={event.title} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, opacity: pos ? undefined : 0 }}>
      <div className="cal-pop__head">
        <span className="cal-pop__dot" style={{ background: event.color }} />
        <strong>{event.title}</strong>
      </div>
      <p className="fin-num cal-pop__when">{when}</p>
      {event.location && (
        <p className="cal-pop__where">
          <MapPin size={12} strokeWidth={2} aria-hidden="true" />
          {event.location}
        </p>
      )}
      {event.htmlLink && (
        <button type="button" className="fin-link cal-pop__open" onClick={() => (desktop ? desktop.openExternal(event.htmlLink!) : window.open(event.htmlLink, '_blank', 'noopener'))}>
          <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
          Open in Google Calendar
        </button>
      )}
    </div>
  );
}
