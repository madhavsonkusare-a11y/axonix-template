/**
 * What the calendar's views share: the clock arithmetic, what falls on a day,
 * and how overlapping things sit side by side.
 *
 * Days are local `YYYY-MM-DD`, times are minutes from midnight, weeks start on
 * Monday (as `mondayOf` in CalendarContext).
 */
import { addDays, dateOf } from '../../finance/format';
import type { CalEvent } from '../../calendar/backend';
import { isOpen } from '../../tasks/derive';
import type { Task } from '../../tasks/types';

/** One hour, in pixels, and the step a block snaps to, in minutes. */
export const HOUR = 52;
export const SNAP = 15;
export const DAY_MIN = 24 * 60;

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
export const minuteOf = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
export const snap = (m: number) => Math.round(m / SNAP) * SNAP;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** 0 for Monday … 6 for Sunday. */
export const weekdayOf = (iso: string) => (dateOf(iso).getDay() + 6) % 7;
export const monthStart = (iso: string) => `${iso.slice(0, 8)}01`;

export function shiftMonth(iso: string, by: number): string {
  const d = dateOf(monthStart(iso));
  d.setMonth(d.getMonth() + by);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/** ISO week number. */
export function weekNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
}

/** The weeks a month's page shows: from the Monday on or before the 1st, whole weeks, five or six of them. */
export function monthGrid(iso: string): string[] {
  const first = monthStart(iso);
  const from = addDays(first, -weekdayOf(first));
  const next = shiftMonth(first, 1);
  const days: string[] = [];
  for (let day = from; day < next || days.length % 7 !== 0; day = addDays(day, 1)) days.push(day);
  return days;
}

export interface Item {
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
export function layout(items: Omit<Item, 'col' | 'cols'>[]): Item[] {
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

export interface AllDay {
  key: string;
  title: string;
  event?: CalEvent;
  task?: Task;
}

export interface DayContents {
  day: string;
  /** Everything with a time: blocks and events, unplaced. */
  timed: Omit<Item, 'col' | 'cols'>[];
  /** All-day events, then tasks due that day with no time. */
  allDay: AllDay[];
  /** Minutes of time blocks, for the day's load. */
  planned: number;
}

/** What is on `day`: time blocks, the calendar's events, and what is due. */
export function contentsOf(day: string, tasks: Task[], events: CalEvent[]): DayContents {
  const timed: Omit<Item, 'col' | 'cols'>[] = [];
  let planned = 0;
  for (const t of tasks) {
    if (!t.scheduled || t.scheduled.slice(0, 10) !== day) continue;
    const start = minuteOf(t.scheduled);
    const end = Math.min(DAY_MIN, start + (t.estimate ?? 30));
    timed.push({ key: `t:${t.id}`, kind: 'task', start, end, title: t.title, task: t });
    if (t.state !== 'done') planned += end - start;
  }
  for (const e of events) {
    if (e.allDay) continue;
    const sDay = e.start.slice(0, 10);
    const eDay = e.end.slice(0, 10);
    if (day < sDay || day > eDay) continue;
    const start = day === sDay ? minuteOf(e.start) : 0;
    const end = day === eDay ? minuteOf(e.end) : DAY_MIN;
    if (end <= start) continue;
    timed.push({ key: `e:${e.id}:${day}`, kind: 'event', start, end, title: e.title, event: e });
  }
  const allDay: AllDay[] = [
    // Google's all-day end is the day after (exclusive).
    ...events.filter((e) => e.allDay && e.start <= day && (e.end > day || (e.end <= e.start && e.start === day))).map((e) => ({ key: `ae:${e.id}`, title: e.title, event: e })),
    ...tasks.filter((t) => isOpen(t) && t.due === day && !t.scheduled).map((t) => ({ key: `due:${t.id}`, title: t.title, task: t })),
  ];
  return { day, timed, allDay, planned };
}

/** `2h 30m`, `45m` — a day's planned time. */
export function hoursLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/** The title over a range of days: `October 2026`, or `Sep – Oct 2026` when it crosses a month. */
export function rangeTitle(from: string, to: string): string {
  const a = from.split('-').map(Number);
  const b = to.split('-').map(Number);
  return a[1] === b[1] ? `${MONTHS[a[1] - 1]} ${a[0]}` : `${MONTHS[a[1] - 1].slice(0, 3)} – ${MONTHS[b[1] - 1].slice(0, 3)} ${b[0]}`;
}
