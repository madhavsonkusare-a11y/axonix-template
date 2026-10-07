/**
 * Everything the board and the dashboard show is derived here from the task
 * files — nothing below is stored. Days are LOCAL calendar days, as in Finance.
 */
import { addDays, dateOf, todayIso } from '../finance/format';
import { dueWords } from './quickadd';
import type { Priority, Task, TaskState } from './types';

export { todayIso };

export const isOpen = (t: Task) => t.state !== 'done';
export const isLate = (t: Task, today: string) => isOpen(t) && !!t.due && t.due < today;
export const isDueToday = (t: Task, today: string) => isOpen(t) && t.due === today;
export const doneDay = (t: Task) => t.done?.slice(0, 10);
export const scheduledDay = (t: Task) => t.scheduled?.slice(0, 10);

/** Column order: explicit `order` first, then files without one by age. */
export function byOrder(a: Task, b: Task): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao < bo ? -1 : 1;
  return (a.created ?? '').localeCompare(b.created ?? '') || a.title.localeCompare(b.title);
}

/** Done shows the last week; older finished tasks stay on disk, off the board. */
export const DONE_WINDOW_DAYS = 7;
export const recentlyDone = (t: Task, today: string) => t.state === 'done' && !!t.done && t.done.slice(0, 10) >= addDays(today, -(DONE_WINDOW_DAYS - 1));

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

export function dueLabel(t: Task, today: string): { text: string; tone: 'late' | 'today' | 'soon' | 'later' } | null {
  if (!t.due) return null;
  if (t.state !== 'done' && t.due < today) {
    const days = Math.round((dateOf(today).getTime() - dateOf(t.due).getTime()) / 86_400_000);
    return { text: days === 1 ? 'Yesterday' : `${days}d late`, tone: 'late' };
  }
  if (t.due === today) return { text: 'Today', tone: 'today' };
  const tone = t.due <= addDays(today, 6) ? 'soon' : 'later';
  const words = dueWords(t.due, today);
  // `Mon 22 SEP` → `Mon` within the week: the weekday is enough.
  return { text: tone === 'soon' && words !== 'Tomorrow' ? words.slice(0, 3) : words, tone };
}

export const projectLabel = (project: string) => project || 'Inbox';

/* ------------------------------------------------------------------ */
/* filters                                                             */
/* ------------------------------------------------------------------ */

export type DueFilter = 'any' | 'late' | 'today' | 'week' | 'none';
export type PriorityFilter = 'any' | '1' | '2' | '3' | '4' | 'none';

export interface TaskFilter {
  query: string;
  /** '*' for every project; '' is the Inbox. */
  project: string;
  due: DueFilter;
  priority: PriorityFilter;
}

export const NO_FILTER: TaskFilter = { query: '', project: '*', due: 'any', priority: 'any' };

export function matches(t: Task, f: TaskFilter, today: string): boolean {
  if (f.project !== '*' && t.project !== f.project) return false;
  if (f.priority === 'none' ? t.priority !== undefined : f.priority !== 'any' && t.priority !== (Number(f.priority) as Priority)) return false;
  if (f.due === 'late' && !isLate(t, today)) return false;
  if (f.due === 'today' && !(t.due && t.due <= today && isOpen(t))) return false;
  if (f.due === 'week' && !(t.due && t.due <= addDays(today, 6))) return false;
  if (f.due === 'none' && t.due) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${t.title} ${t.project} ${t.tags.map((x) => `#${x}`).join(' ')} ${t.body}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* the dashboard                                                       */
/* ------------------------------------------------------------------ */

const PRIORITY_RANK = (p?: Priority) => p ?? 5;

export interface TodaySummary {
  /** Open, due today or earlier, or scheduled today. */
  open: Task[];
  doneToday: Task[];
  dueToday: number;
  late: number;
  next?: Task;
}

export function todaySummary(tasks: Task[], today: string): TodaySummary {
  const open = tasks.filter((t) => isOpen(t) && ((t.due && t.due <= today) || scheduledDay(t) === today));
  const doneToday = tasks.filter((t) => t.state === 'done' && doneDay(t) === today);
  // Next up: whatever is in hand first, then the earliest time block, then
  // what is most late, then priority.
  const next = [...open].sort(
    (a, b) =>
      Number(b.state === 'doing') - Number(a.state === 'doing') ||
      (a.scheduled ?? '9').localeCompare(b.scheduled ?? '9') ||
      (a.due ?? '9').localeCompare(b.due ?? '9') ||
      PRIORITY_RANK(a.priority) - PRIORITY_RANK(b.priority),
  )[0];
  return {
    open,
    doneToday,
    dueToday: open.filter((t) => t.due === today).length,
    late: open.filter((t) => isLate(t, today)).length,
    next,
  };
}

export interface AgendaItem {
  kind: 'block' | 'event' | 'free' | 'now';
  start: number;
  end: number;
  task?: Task;
  event?: AgendaEvent;
}

/** A timed calendar event, as the agenda needs it. */
export interface AgendaEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  color: string;
}

/** Minutes since midnight of a local `…THH:mm` stamp. */
const minutesOf = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));

export const DAY_END = 21 * 60;

/**
 * Today's time blocks and calendar events, the free gaps between now and the
 * end of the day (30 minutes or more), and a "now" marker. A block with no
 * estimate is 30 minutes.
 */
export function agenda(tasks: Task[], today: string, now: Date, events: AgendaEvent[] = []): AgendaItem[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const blocks: AgendaItem[] = [
    ...tasks
      .filter((t) => scheduledDay(t) === today && t.state !== 'done')
      .map((t) => ({ kind: 'block' as const, start: minutesOf(t.scheduled!), end: minutesOf(t.scheduled!) + (t.estimate ?? 30), task: t })),
    ...events
      .filter((e) => e.start.slice(0, 10) <= today && e.end.slice(0, 10) >= today)
      .map((e) => ({
        kind: 'event' as const,
        start: e.start.slice(0, 10) === today ? minutesOf(e.start) : 0,
        end: e.end.slice(0, 10) === today ? minutesOf(e.end) : 24 * 60,
        event: e,
      })),
  ].sort((a, b) => a.start - b.start);

  const items: AgendaItem[] = [];
  let cursor = Math.max(nowMin, 8 * 60);
  for (const b of blocks) {
    if (b.start - cursor >= 30 && b.start > nowMin) items.push({ kind: 'free', start: cursor, end: b.start });
    items.push(b);
    cursor = Math.max(cursor, b.end);
  }
  if (DAY_END - cursor >= 30) items.push({ kind: 'free', start: cursor, end: DAY_END });

  // "Now" goes before the first thing that has not ended yet.
  const at = items.findIndex((i) => i.end > nowMin);
  items.splice(at < 0 ? items.length : at, 0, { kind: 'now', start: nowMin, end: nowMin });
  return items;
}

export const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function spanWords(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export interface Momentum {
  days: { day: string; count: number }[];
  streak: number;
  /** Median hours from Doing to Done over the last 30 days, when there are three or more. */
  cycleHours?: number;
  week: number;
}

export function momentum(tasks: Task[], today: string): Momentum {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const d = doneDay(t);
    if (t.state === 'done' && d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6);
    return { day, count: counts.get(day) ?? 0 };
  });
  // A streak counts back from today, or from yesterday while today is still open.
  let streak = 0;
  let day = counts.get(today) ? today : addDays(today, -1);
  while (counts.get(day)) {
    streak++;
    day = addDays(day, -1);
  }
  const since = addDays(today, -29);
  const cycles = tasks
    .filter((t) => t.state === 'done' && t.started && t.done && t.done.slice(0, 10) >= since)
    .map((t) => (new Date(t.done!).getTime() - new Date(t.started!).getTime()) / 3_600_000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  const cycleHours = cycles.length >= 3 ? cycles[Math.floor(cycles.length / 2)] : undefined;
  return { days, streak, cycleHours, week: days.reduce((s, d) => s + d.count, 0) };
}

export interface ProjectStat {
  name: string;
  total: number;
  done: number;
  open: number;
  blocked: number;
  late: number;
}

export function projectStats(tasks: Task[], projects: string[], today: string): ProjectStat[] {
  const stats = new Map<string, ProjectStat>();
  const get = (name: string) => {
    let s = stats.get(name);
    if (!s) stats.set(name, (s = { name, total: 0, done: 0, open: 0, blocked: 0, late: 0 }));
    return s;
  };
  for (const p of projects) get(p);
  for (const t of tasks) {
    const s = get(t.project);
    s.total++;
    if (t.state === 'done') s.done++;
    else s.open++;
    if (t.state === 'blocked') s.blocked++;
    if (isLate(t, today)) s.late++;
  }
  return [...stats.values()];
}

/** How a column reads for a given state, for empty states and headers. */
export const EMPTY_COLUMN: Record<TaskState, string> = {
  backlog: 'Ideas and someday tasks.',
  todo: 'Nothing queued.',
  doing: 'Nothing in hand.',
  blocked: 'Nothing waiting.',
  done: 'Finished tasks show here for a week.',
};
