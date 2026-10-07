/**
 * Calendar in the new shell.
 *
 * Same data as before: time blocks are tasks with a `scheduled` time
 * (`TasksContext`), events come from Google through `CalendarContext`, and the
 * two-way sync runs above every surface in `App`. Nothing about how either is
 * stored changed.
 *
 * What is new: the calendar is a module of its own with four views. Week is
 * the first calendar's grid; Day is the same grid for one day; Month and a
 * five-week Timeline did not exist (the old "Timeline" was four weeks in a flat
 * list). A small month in the sidebar jumps to any day, and Google's calendars
 * are switched on and off there instead of inside a sheet.
 *
 * Keys: W D M L choose the view, ← → move by one page of it, Ctrl+N adds a
 * task, Ctrl+Z undoes, S shows or hides what needs a time. T belongs to the
 * time ruler (next/scrub): the page follows the day the ruler is on, and
 * "today" on this page is that day.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ListTodo, RefreshCw, TriangleAlert } from 'lucide-react';
import ErrorBoundary from '../../ErrorBoundary';
import type { CalEvent } from '../../calendar/backend';
import { mondayOf, useCalendar, useEvents } from '../../calendar/CalendarContext';
import CalendarSheet from '../../calendar/CalendarSheet';
import { addDays, clockOf } from '../../finance/format';
import { LiquidSegment } from '../../finance/components/Liquid';
import { useTasks } from '../../tasks/TasksContext';
import Composer, { type ComposerSeed } from '../../tasks/components/Composer';
import { QuickAdd, type QuickAddHandle } from '../../tasks/components/QuickAdd';
import TaskSheet from '../../tasks/components/TaskSheet';
import { isOpen } from '../../tasks/derive';
import Shell from '../Shell';
import { useDockApps } from '../apps';
import Linked from '../lift/Links';
import { useScrub } from '../scrub/Scrub';
import SaveNotice from '../tasks/SaveNotice';
import CalendarSide, { CAL_VIEWS, calendarMenu, type CalView } from './CalendarSide';
import EventCard from './EventCard';
import MonthView from './MonthView';
import SpanView, { SPAN_DAYS } from './SpanView';
import TimeGrid from './TimeGrid';
import { MONTHS, WEEKDAYS_LONG, hoursLabel, monthGrid, rangeTitle, shiftMonth, weekNumber, weekdayOf } from './time';

const VIEW = 'axonix.next.calendar.view';
const TRAY = 'axonix.next.calendar.tray';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage refused: the choice lasts for this session only */
  }
};

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

export interface CalendarNextProps {
  onOpenApp: (id: string) => void;
  onSearch: () => void;
  /** Opens a note, by title or path, in Notes. */
  onOpenNote: (target: string) => void;
  /** A day to show (an event opened from a link or the Pocket). */
  request?: { day: string; n: number } | null;
}

export default function CalendarNext({ onOpenApp, onSearch, onOpenNote, request }: CalendarNextProps) {
  const apps = useDockApps();
  const { tasks, undo } = useTasks();
  const cal = useCalendar();
  const [view, setViewState] = useState<CalView>(() => {
    const saved = read(VIEW);
    return CAL_VIEWS.some((v) => v.key === saved) ? (saved as CalView) : 'week';
  });
  const [tray, setTrayState] = useState(() => read(TRAY) !== 'closed');
  const [sheet, setSheet] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposerSeed | null>(null);
  const [popover, setPopover] = useState<{ event: CalEvent; rect: DOMRect } | null>(null);
  const quick = useRef<QuickAddHandle>(null);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // "Today" on this page is the day the workspace is showing: the real one, unless the ruler is elsewhere.
  const scrub = useScrub();
  const today = scrub.day;
  const [anchor, setAnchor] = useState(request?.day ?? today);
  // The page follows the ruler, and comes home with it.
  const followed = useRef(today);
  useEffect(() => {
    if (followed.current === today) return;
    followed.current = today;
    setAnchor(today);
  }, [today]);
  const asked = useRef(request?.n);
  useEffect(() => {
    if (!request || asked.current === request.n) return;
    asked.current = request.n;
    setAnchor(request.day);
  }, [request]);

  const setView = useCallback((v: CalView) => {
    setViewState(v);
    keep(VIEW, v);
  }, []);
  const toggleTray = useCallback(() => {
    setTrayState((on) => {
      keep(TRAY, on ? 'closed' : 'open');
      return !on;
    });
  }, []);

  /* ---------- the days on the page ---------- */

  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'month') return monthGrid(anchor);
    const monday = mondayOf(anchor);
    return Array.from({ length: view === 'week' ? 7 : SPAN_DAYS }, (_, i) => addDays(monday, i));
  }, [view, anchor]);
  const from = days[0];
  const to = days[days.length - 1];
  const range = useEvents(from, to);
  const connected = !!cal.status?.connected;
  const axonixCal = cal.status?.axonixCalendarId;
  const events = useMemo(() => (range?.events ?? []).filter((e) => e.calendarId !== axonixCal), [range, axonixCal]);

  const step = useCallback(
    (by: 1 | -1) =>
      setAnchor((a) => (view === 'month' ? shiftMonth(a, by) : addDays(a, by * (view === 'day' ? 1 : 7)))),
    [view],
  );
  const { live, reset, today: realToday } = scrub;
  const goToday = useCallback(() => {
    if (!live) reset();
    setAnchor(realToday);
  }, [live, reset, realToday]);
  const openDay = useCallback(
    (day: string) => {
      setAnchor(day);
      setView('day');
    },
    [setView],
  );

  /* ---------- keys ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && !e.shiftKey && !e.altKey && key === 'n') {
        e.preventDefault();
        quick.current?.focus();
        return;
      }
      if (typing(e.target)) return;
      if (ctrl && !e.shiftKey && !e.altKey && key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (ctrl || e.altKey) return;
      const chosen = CAL_VIEWS.find((v) => v.hint.toLowerCase() === key);
      if (chosen) setView(chosen.key);
      else if (key === 's') toggleTray();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, setView, toggleTray, step]);

  /* ---------- the head: where you are, and what is on it ---------- */

  const head = useMemo(() => {
    if (view === 'day') {
      const [, m, d] = anchor.split('-').map(Number);
      return { title: `${WEEKDAYS_LONG[weekdayOf(anchor)]} ${d} ${MONTHS[m - 1]}`, aside: `Week ${weekNumber(anchor)}` };
    }
    if (view === 'month') return { title: `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`, aside: '' };
    return { title: rangeTitle(from, to), aside: view === 'week' ? `Week ${weekNumber(from)}` : 'Five weeks' };
  }, [view, anchor, from, to]);

  const summary = useMemo(() => {
    const lo = view === 'month' ? `${anchor.slice(0, 8)}01` : from;
    const hi = view === 'month' ? addDays(shiftMonth(anchor, 1), -1) : to;
    const blocks = tasks.filter((t) => t.scheduled && t.scheduled.slice(0, 10) >= lo && t.scheduled.slice(0, 10) <= hi);
    const planned = blocks.filter(isOpen).reduce((sum, t) => sum + (t.estimate ?? 30), 0);
    const due = tasks.filter((t) => isOpen(t) && t.due && t.due >= lo && t.due <= hi).length;
    const shown = events.filter((e) => e.start.slice(0, 10) <= hi && e.end.slice(0, 10) >= lo).length;
    return [
      blocks.length ? `${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}${planned ? `, ${hoursLabel(planned)} planned` : ''}` : 'No time blocked',
      due ? `${due} due` : '',
      connected && shown ? `${shown} ${shown === 1 ? 'event' : 'events'}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }, [view, anchor, from, to, tasks, events, connected]);

  const onPage = today >= (view === 'month' ? `${anchor.slice(0, 8)}01` : from) && today <= (view === 'month' ? addDays(shiftMonth(anchor, 1), -1) : to);
  const stepName = view === 'timeline' ? 'week' : view;

  const open = useCallback((id: string) => setOpenId(id), []);
  const showEvent = useCallback((event: CalEvent, rect: DOMRect) => setPopover({ event, rect }), []);
  const openNote = useCallback(
    (target: string) => {
      setOpenId(null);
      onOpenNote(target);
    },
    [onOpenNote],
  );
  const expand = useCallback((seed: Omit<ComposerSeed, 'n'>) => setCompose((c) => ({ ...seed, n: (c?.n ?? 0) + 1 })), []);

  const status = cal.status;
  const syncNote = !connected ? null : status?.error ? (
    <span className="nxc-sync" data-state="error" title={status.error}>
      <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
      {status.error}
    </span>
  ) : cal.syncing ? (
    <span className="nxc-sync">Syncing…</span>
  ) : range?.stale ? (
    <span className="nxc-sync">Offline copy from {clockOf(new Date(range.fetchedAt))}</span>
  ) : null;

  const tabs = <LiquidSegment<CalView> label="Calendar views" className="nx-tabs" mono={false} value={view} onChange={setView} options={CAL_VIEWS.map((v) => ({ value: v.key, label: v.label }))} />;

  return (
    <>
      <Shell
        module="calendar"
        title="Calendar"
        icon={CalendarDays}
        apps={apps}
        onOpenApp={onOpenApp}
        onAsk={onSearch}
        side={<CalendarSide view={view} onView={setView} anchor={anchor} today={today} onAnchor={setAnchor} onSettings={() => setSheet(true)} />}
        tabs={tabs}
        menu={() => calendarMenu(goToday, () => setSheet(true))}
        lead={<QuickAdd ref={quick} onExpand={expand} />}
        actions={
          <>
            <SaveNotice />
            {connected && (
              <button
                type="button"
                className="nx-iconbtn"
                onClick={() => void cal.syncNow()}
                aria-label="Sync with Google now"
                title={status?.lastSync ? `Synced with Google at ${clockOf(new Date(status.lastSync))}` : 'Sync with Google now'}
              >
                <RefreshCw size={15} strokeWidth={1.6} aria-hidden="true" />
              </button>
            )}
          </>
        }
        scrollKey={view}
        fill
      >
        <ErrorBoundary label={`calendar ${view}`}>
          <div className="nxc" data-view={view}>
            <header className="nxc-head">
              <div className="nxc-head__nav">
                <button type="button" className="nx-iconbtn" onClick={() => step(-1)} aria-label={`Previous ${stepName}`} title={`Previous ${stepName} · ←`}>
                  <ChevronLeft size={16} strokeWidth={1.7} aria-hidden="true" />
                </button>
                <button type="button" className="nx-iconbtn" onClick={() => step(1)} aria-label={`Next ${stepName}`} title={`Next ${stepName} · →`}>
                  <ChevronRight size={16} strokeWidth={1.7} aria-hidden="true" />
                </button>
                <button type="button" className="fin-pill fin-pill--sm" onClick={goToday} disabled={live && onPage && (view !== 'day' || anchor === today)} title={live ? 'Today' : 'Back to today'}>
                  Today
                </button>
              </div>
              <div className="nxc-head__title">
                <h2>
                  {head.title}
                  {head.aside && <span className="fin-num">{head.aside}</span>}
                </h2>
                {view !== 'timeline' && <p>{summary}</p>}
              </div>
              <span className="fin-spacer" />
              {syncNote}
              {(view === 'week' || view === 'day') && (
                <button type="button" className="fin-pill fin-pill--sm nxc-head__tray" aria-pressed={tray} onClick={toggleTray} title={`${tray ? 'Hide' : 'Show'} what still needs a time · S`}>
                  <ListTodo size={13} strokeWidth={1.8} aria-hidden="true" />
                  To schedule
                </button>
              )}
            </header>

            {(view === 'week' || view === 'day') && (
              <TimeGrid key={view} days={days} today={today} now={now} live={live} events={events} tray={tray} onOpenTask={open} onEvent={showEvent} onDay={view === 'week' ? openDay : undefined} />
            )}
            {view === 'month' && <MonthView days={days} month={anchor.slice(0, 7)} today={today} events={events} onOpenTask={open} onEvent={showEvent} onDay={openDay} />}
            {view === 'timeline' && <SpanView from={from} today={today} onOpenTask={open} />}
          </div>
        </ErrorBoundary>
      </Shell>

      {popover && <EventCard event={popover.event} rect={popover.rect} onClose={() => setPopover(null)} />}
      <TaskSheet id={openId} onClose={() => setOpenId(null)} onOpenNote={openNote} extra={openId ? <Linked thing={{ kind: 'task', id: openId }} before={() => setOpenId(null)} /> : undefined} />
      <Composer seed={compose} onClose={() => setCompose(null)} onOpenNote={openNote} />
      <CalendarSheet open={sheet} onClose={() => setSheet(false)} />
    </>
  );
}
