/**
 * Calendar state: whether Google is connected, the events for the weeks on
 * screen, and the two-way time-block sync.
 *
 * Mounted above every surface (in `App`), so blocks keep syncing whatever is
 * open. The sync runs a moment after a time block changes in Axonix, every
 * five minutes, and when the window comes back into focus; there is no push
 * from Google to a local app, so polling is the channel. Changes that come
 * from Google (a block moved or deleted there) are written to the task files
 * like any other change, but not offered for Undo — Undo is for your own.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useTasks } from '../tasks/TasksContext';
import type { TaskPatch } from '../tasks/types';
import { calendar, messageOf, type Block, type CalEvent, type CalStatus } from './backend';

const SYNC_EVERY_MS = 5 * 60_000;
const EVENTS_FRESH_MS = 5 * 60_000;

interface Range {
  events: CalEvent[];
  stale: boolean;
  fetchedAt: number;
  error?: string;
  loading: boolean;
}

export interface CalendarValue {
  status: CalStatus | null;
  refreshStatus: () => Promise<CalStatus | null>;
  /** Events for a range of days, fetched (and kept five minutes) on first ask. */
  range: (from: string, to: string) => Range | undefined;
  ensure: (from: string, to: string, force?: boolean) => void;
  syncing: boolean;
  syncNow: () => Promise<void>;
  /** Everything that changes what is shown: connect, disconnect, calendars shown. */
  invalidate: () => void;
}

const CalendarContext = createContext<CalendarValue | null>(null);

const pad = (n: number) => String(n).padStart(2, '0');
export const stampPlus = (stamp: string, minutes: number) => {
  const d = new Date(stamp);
  d.setMinutes(d.getMinutes() + minutes);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const minutesBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

/** The Monday of `iso`'s week (weeks start on Monday). */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function CalendarProvider({ children }: { children: ReactNode }) {
  const { tasks, loading, loadError, applyRemote } = useTasks();
  const [status, setStatus] = useState<CalStatus | null>(null);
  const [ranges, setRanges] = useState<Record<string, Range>>({});
  const rangesRef = useRef(ranges);
  rangesRef.current = ranges;
  const [syncing, setSyncing] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await calendar.status();
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  /* ---------- events ---------- */

  const fetching = useRef(new Set<string>());
  const ensure = useCallback(
    (from: string, to: string, force = false) => {
      if (!status?.connected) return;
      const key = `${from}|${to}`;
      const have = rangesRef.current[key];
      if (fetching.current.has(key)) return;
      if (!force && have && !have.error && Date.now() - have.fetchedAt < EVENTS_FRESH_MS) return;
      fetching.current.add(key);
      setRanges((r) => ({ ...r, [key]: { events: have?.events ?? [], stale: have?.stale ?? false, fetchedAt: have?.fetchedAt ?? 0, loading: true } }));
      calendar
        .events(from, to)
        .then((res) => setRanges((r) => ({ ...r, [key]: { ...res, loading: false } })))
        .catch((e) => setRanges((r) => ({ ...r, [key]: { events: have?.events ?? [], stale: true, fetchedAt: have?.fetchedAt ?? 0, loading: false, error: messageOf(e) } })))
        .finally(() => fetching.current.delete(key));
    },
    [status?.connected],
  );
  const range = useCallback((from: string, to: string) => ranges[`${from}|${to}`], [ranges]);

  const invalidate = useCallback(() => {
    setRanges({});
    void refreshStatus();
  }, [refreshStatus]);

  /* ---------- two-way time blocks ---------- */

  const blocks = useMemo<Block[]>(
    () =>
      tasks
        .filter((t) => t.scheduled && !t.broken && !t.id.startsWith('path:'))
        .map((t) => ({ taskId: t.id, title: t.title, start: t.scheduled!, end: stampPlus(t.scheduled!, t.estimate ?? 30), done: t.state === 'done', path: t.path })),
    [tasks],
  );
  const keep = useMemo(() => tasks.filter((t) => t.broken).map((t) => t.id), [tasks]);
  const signature = useMemo(() => JSON.stringify(blocks), [blocks]);
  const latest = useRef({ blocks, keep, tasks });
  latest.current = { blocks, keep, tasks };

  const running = useRef<Promise<void> | null>(null);
  const syncNow = useCallback(async () => {
    if (running.current) return running.current;
    const s = status;
    if (!s?.connected || loading || loadError) return;
    const job = (async () => {
      setSyncing(true);
      try {
        const res = await calendar.syncBlocks(latest.current.blocks, latest.current.keep);
        if (res.remote.length) {
          const byId = new Map(latest.current.tasks.map((t) => [t.id, t]));
          const changes: { id: string; patch: TaskPatch }[] = [];
          for (const r of res.remote) {
            const t = byId.get(r.taskId);
            if (!t) continue;
            if ('removed' in r) {
              changes.push({ id: t.id, patch: { scheduled: null } });
            } else {
              const patch: TaskPatch = { scheduled: r.start, estimate: Math.max(5, minutesBetween(r.start, r.end)) };
              // A block moved to another day takes its due day along, when they were the same day.
              if (t.due && t.scheduled && t.due === t.scheduled.slice(0, 10) && r.start.slice(0, 10) !== t.due) patch.due = r.start.slice(0, 10);
              changes.push({ id: t.id, patch });
            }
          }
          if (changes.length) {
            await applyRemote(changes);
            const moved = res.remote.filter((r) => !('removed' in r)).length;
            const removed = res.remote.length - moved;
            toast('Google Calendar changed your time blocks', {
              description: [moved ? `${moved} moved` : '', removed ? `${removed} removed` : ''].filter(Boolean).join(' · '),
            });
          }
        }
        // What is on screen is fetched again, without blanking it meanwhile.
        setRanges((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, fetchedAt: 0 }])));
      } catch {
        // The error is kept in the status; the next run tries again.
      } finally {
        setSyncing(false);
        void refreshStatus();
      }
    })();
    running.current = job;
    try {
      await job;
    } finally {
      running.current = null;
    }
  }, [applyRemote, loadError, loading, refreshStatus, status]);

  const syncRef = useRef(syncNow);
  syncRef.current = syncNow;

  // Soon after a block changes here…
  useEffect(() => {
    if (!status?.connected || loading) return;
    const id = window.setTimeout(() => void syncRef.current(), 1500);
    return () => window.clearTimeout(id);
  }, [signature, status?.connected, loading]);

  // …every five minutes, and on coming back to the window.
  useEffect(() => {
    if (!status?.connected) return;
    const id = window.setInterval(() => void syncRef.current(), SYNC_EVERY_MS);
    const onFocus = () => {
      void syncRef.current();
      setRanges((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, fetchedAt: 0 }])));
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [status?.connected]);

  const value = useMemo<CalendarValue>(
    () => ({ status, refreshStatus, range, ensure, syncing, syncNow, invalidate }),
    [status, refreshStatus, range, ensure, syncing, syncNow, invalidate],
  );
  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarValue {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error('useCalendar must be used within CalendarProvider');
  return ctx;
}

/** Events for `from…to`, fetched when needed. Empty while not connected. */
export function useEvents(from: string, to: string): Range | undefined {
  const { ensure, range, status } = useCalendar();
  const current = range(from, to);
  // Re-asks whenever the copy is marked old (after a sync, on focus).
  const fetchedAt = current?.fetchedAt;
  useEffect(() => {
    if (status?.connected) ensure(from, to);
  }, [ensure, from, to, status?.connected, fetchedAt]);
  return status?.connected ? current : undefined;
}
