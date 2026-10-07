/**
 * Calendar's sidebar.
 *
 * Views first: Week, Day, Month, Timeline. Then a small month to jump with —
 * a dot under a day means something of yours is on it — and the calendars
 * Google sends, each with its own colour and a switch. The colour is the
 * calendar's, so it stays.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CalendarRange, ChartGantt, ChevronLeft, ChevronRight, Grid3x3, Link2, Settings2, type LucideIcon } from 'lucide-react';
import { calendar, type CalInfo } from '../../calendar/backend';
import { mondayOf, useCalendar } from '../../calendar/CalendarContext';
import { addDays } from '../../finance/format';
import { LiquidLens, useLiquidIndicator } from '../../finance/components/Liquid';
import type { MenuEntry } from '../../finance/components/Menu';
import { useTasks } from '../../tasks/TasksContext';
import { isOpen } from '../../tasks/derive';
import { SPAN_DAYS } from './SpanView';
import { MONTHS, monthGrid, shiftMonth } from './time';

export type CalView = 'week' | 'day' | 'month' | 'timeline';

export const CAL_VIEWS: { key: CalView; label: string; icon: LucideIcon; hint: string }[] = [
  { key: 'week', label: 'Week', icon: CalendarRange, hint: 'W' },
  { key: 'day', label: 'Day', icon: CalendarDays, hint: 'D' },
  { key: 'month', label: 'Month', icon: Grid3x3, hint: 'M' },
  { key: 'timeline', label: 'Timeline', icon: ChartGantt, hint: 'L' },
];

/** The days the current view is showing, for the small month's highlight. */
function shownRange(view: CalView, anchor: string): [string, string] {
  if (view === 'day') return [anchor, anchor];
  if (view === 'month') return [`${anchor.slice(0, 8)}01`, addDays(shiftMonth(anchor, 1), -1)];
  const monday = mondayOf(anchor);
  return [monday, addDays(monday, view === 'week' ? 6 : SPAN_DAYS - 1)];
}

export default function CalendarSide({
  view,
  onView,
  anchor,
  today,
  onAnchor,
  onSettings,
}: {
  view: CalView;
  onView: (v: CalView) => void;
  anchor: string;
  today: string;
  onAnchor: (day: string) => void;
  onSettings: () => void;
}) {
  const connected = !!useCalendar().status?.connected;
  const host = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, view, 'y');

  return (
    <>
      <nav className="nx-nav" ref={host} aria-label="Calendar views">
        <LiquidLens lensRef={lens} radius={10} />
        {CAL_VIEWS.map((v) => (
          <button key={v.key} type="button" data-liquid-key={v.key} className="nx-nav__item" aria-current={v.key === view ? 'page' : undefined} onClick={() => onView(v.key)}>
            <span className="nx-nav__glyph">
              <v.icon size={16} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span>{v.label}</span>
            <span className="nxc-nav__key fin-key">{v.hint}</span>
          </button>
        ))}
      </nav>

      <div className="nx-side__more">
        <MiniMonth anchor={anchor} today={today} range={shownRange(view, anchor)} onPick={onAnchor} />
      </div>

      <Calendars onSettings={onSettings} />

      {/* Not connected, "Connect Google Calendar" above is the one way in; connected, this row manages it. */}
      {connected && (
        <div className="nx-side__foot">
          <button type="button" className="nx-row" onClick={onSettings}>
            <span className="nx-row__icon">
              <Settings2 size={14} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span className="nx-row__label">Google Calendar</span>
          </button>
        </div>
      )}
    </>
  );
}

function MiniMonth({ anchor, today, range, onPick }: { anchor: string; today: string; range: [string, string]; onPick: (day: string) => void }) {
  const { tasks } = useTasks();
  const [month, setMonth] = useState(() => `${anchor.slice(0, 8)}01`);
  // The small month follows the page when the page moves to another month.
  useEffect(() => setMonth(`${anchor.slice(0, 8)}01`), [anchor]);
  const days = useMemo(() => monthGrid(month), [month]);
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.scheduled) set.add(t.scheduled.slice(0, 10));
      if (t.due && isOpen(t)) set.add(t.due);
    }
    return set;
  }, [tasks]);

  return (
    <section className="nxc-mini" aria-label="Jump to a day">
      <div className="nxc-mini__head">
        <span>
          {MONTHS[Number(month.slice(5, 7)) - 1]} <span className="fin-num">{month.slice(0, 4)}</span>
        </span>
        <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Earlier month">
          <ChevronLeft size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Later month">
          <ChevronRight size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className="nxc-mini__grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
          <span key={i} className="nxc-mini__name" aria-hidden="true">
            {w}
          </span>
        ))}
        {days.map((day) => (
          <button
            key={day}
            type="button"
            className="nxc-mini__day fin-num"
            data-outside={day.slice(0, 7) !== month.slice(0, 7) || undefined}
            data-today={day === today || undefined}
            data-in={(day >= range[0] && day <= range[1]) || undefined}
            data-first={day === range[0] || undefined}
            data-last={day === range[1] || undefined}
            data-busy={busy.has(day) || undefined}
            aria-label={day}
            aria-current={day === anchor ? 'date' : undefined}
            data-drop={`date:${day}`}
            onClick={() => onPick(day)}
          >
            {Number(day.slice(8))}
          </button>
        ))}
      </div>
    </section>
  );
}

function Calendars({ onSettings }: { onSettings: () => void }) {
  const { status, invalidate } = useCalendar();
  const connected = !!status?.connected;
  const [cals, setCals] = useState<CalInfo[] | null>(null);
  const shown = status?.shown.join('|');
  useEffect(() => {
    if (!connected) {
      setCals(null);
      return;
    }
    let live = true;
    calendar
      .calendars()
      .then((list) => live && setCals(list))
      .catch(() => live && setCals([]));
    return () => {
      live = false;
    };
  }, [connected, shown]);

  const toggle = async (c: CalInfo) => {
    const next = (cals ?? []).map((x) => (x.id === c.id ? { ...x, shown: !x.shown } : x));
    setCals(next);
    await calendar.setShown(next.filter((x) => x.shown).map((x) => x.id));
    invalidate();
  };

  if (!connected) {
    return (
      <div className="nx-side__more">
        <p className="nxc-side__note">Time blocks work on their own. Connect Google Calendar to see your events beside them.</p>
        <button type="button" className="nx-row" onClick={onSettings}>
          <span className="nx-row__icon">
            <Link2 size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="nx-row__label">Connect Google Calendar</span>
        </button>
      </div>
    );
  }
  const list = (cals ?? []).filter((c) => !c.axonix);
  return (
    <div className="nx-side__more">
      <div className="nx-group__head">
        <span className="nx-group__toggle nxc-cals__title">
          <span>Calendars</span>
          <span className="fin-num">{list.length}</span>
        </span>
      </div>
      {list.map((c) => (
        <label key={c.id} className="nx-row nxc-cal">
          <i style={{ background: c.color }} data-off={!c.shown || undefined} aria-hidden="true" />
          <span className="nx-row__label">{c.name}</span>
          <input type="checkbox" checked={c.shown} onChange={() => void toggle(c)} aria-label={`Show ${c.name}`} />
        </label>
      ))}
    </div>
  );
}

/** With the sidebar put away: what is left of it, as the menu on the module's name. */
export function calendarMenu(onToday: () => void, onSettings: () => void): MenuEntry[] {
  const glyph = { size: 14, strokeWidth: 1.6 } as const;
  return [
    { id: 'today', label: 'Go to today', icon: <CalendarDays {...glyph} />, onSelect: onToday },
    { id: 'google', label: 'Google Calendar', icon: <Settings2 {...glyph} />, onSelect: onSettings },
  ];
}
