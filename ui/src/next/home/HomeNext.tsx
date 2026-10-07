/**
 * Home in the new shell — the day at a glance, and little else.
 *
 * The owner asked for "a simple home dashboard, without a lot of data when I
 * open the app", with "more character". So Home is three things:
 * - a sky that is the colour of the hour, with the sun (or the moon) where the
 *   day has got to and today's blocks and events standing on the horizon;
 * - one line that says what the day holds, put together from what the modules
 *   already know. Nothing in it is invented: when there is nothing, it says so;
 * - the one task to do next, and how the month's money is going.
 *
 * The modules are in the dock, so Home has no tiles and no sidebar. It reads
 * from every module and writes to none. The first Home is kept as Legacy Home.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, House } from 'lucide-react';
import { useFinance } from '../../finance/FinanceContext';
import * as L from '../../finance/ledger';
import { money } from '../../finance/format';
import { getGreeting } from '../../finance/data';
import { Mark } from '../../finance/components/Glyphs';
import { Secret } from '../../finance/components/Secret';
import { useTasks } from '../../tasks/TasksContext';
import { agenda, clock, dueLabel, projectLabel, spanWords, todaySummary, type AgendaEvent } from '../../tasks/derive';
import { useEvents } from '../../calendar/CalendarContext';
import Shell from '../Shell';
import { liftAttrs, taskThing } from '../lift/things';
import { useAsOf } from '../scrub/Scrub';
import { useDockApps } from '../apps';
import { PaceChart } from '../charts';
import { skyOf } from '../sky';
import * as D from '../finance/derive';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The horizon runs from six in the morning to midnight. */
const along = (hour: number) => clamp((hour - 6) / 18, 0, 1) * 100;
/** Height of the sun's path above the foot of the sky, in px, at `x` percent along. */
const arcHeight = (x: number) => {
  const t = x / 100;
  return 270 - ((1 - t) * (1 - t) * 190 + 2 * (1 - t) * t * -10 + t * t * 190);
};

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(tick);
  }, []);
  return now;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Stop {
  key: string;
  title: string;
  start: number;
  end: number;
}

export default function HomeNext({ onOpenApp, onAsk }: { onOpenApp: (id: string) => void; onAsk: () => void }) {
  const apps = useDockApps();
  const { data, loading: financeLoading } = useFinance();
  const { tasks, loading: tasksLoading } = useTasks();
  const clockNow = useNow();
  const asOf = useAsOf();
  const today = asOf.day;
  // Another day is shown whole: looking back, as it stood at its end; looking ahead, before it starts.
  const now = useMemo(() => (asOf.live ? clockNow : new Date(`${today}T${asOf.past ? '23:59' : '00:00'}:00`)), [asOf.live, asOf.past, today, clockNow]);
  const [greeting] = useState(getGreeting);
  const range = useEvents(today, today);

  const hour = asOf.live ? now.getHours() + now.getMinutes() / 60 : 12;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sky = skyOf(hour);
  const night = sky === 'night';
  const sunAt = along(hour < 5 ? 24 : hour);

  /* ---- today's schedule: time blocks and calendar events ---- */
  const events = useMemo<AgendaEvent[]>(() => (range?.events ?? []).filter((e) => !e.allDay).map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, color: e.color })), [range]);
  const allDay = useMemo(() => (range?.events ?? []).filter((e) => e.allDay), [range]);
  const marks = useMemo<Stop[]>(
    () =>
      agenda(tasks, today, now, events)
        .filter((i) => i.kind === 'block' || i.kind === 'event')
        .map((i) => ({ key: i.task?.id ?? i.event?.id ?? String(i.start), title: i.task?.title ?? i.event?.title ?? '', start: i.start, end: i.end })),
    // The agenda only changes with the minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, today, events, nowMin],
  );
  const ahead = marks.filter((m) => m.end > nowMin);
  // The horizon holds four things before the labels collide; what is still to come goes first.
  const shown = (ahead.length >= 4 ? ahead : [...marks.filter((m) => m.end <= nowMin).slice(-(4 - ahead.length)), ...ahead]).slice(0, 4);
  // Where each one stands on the horizon: a long block is a bar, labelled at its middle.
  const stops = shown.map((m) => {
    const from = along(m.start / 60);
    const to = along(m.end / 60);
    const long = m.end - m.start >= 90;
    return { ...m, long, at: long ? (from + to) / 2 : from, width: to - from };
  });

  /* ---- tasks ---- */
  const sum = useMemo(() => todaySummary(tasks, today), [tasks, today]);
  const next = sum.next;
  const nextDue = next ? dueLabel(next, today) : null;

  /* ---- money ---- */
  const month = L.monthPeriod(today);
  const flow = L.flowOf(data, month);
  const last = L.flowOf(data, L.previousPeriod('MONTH', today));
  const pace = useMemo(() => D.monthPace(data, today), [data, today]);
  const budgeted = data.budgets.reduce((s, b) => s + b.limit, 0);
  const budgetSpent = data.budgets.reduce((s, b) => s + L.spentIn(data, b.category, month), 0);
  const left = D.daysLeftInMonth(today);
  const free = budgeted - budgetSpent;
  const noBalances = data.accounts.every((a) => L.needsBalance(data, a));
  const soon = useMemo(() => D.upcoming(data, today).filter((d) => D.inDays(d.date, today) === 'today' || D.inDays(d.date, today) === 'tomorrow'), [data, today]);
  const review = L.needsReview(data).length;
  const prevMonth = D.monthName(L.previousPeriod('MONTH', today).start);

  /* ---- the line under the greeting ---- */
  const brief: ReactNode[] = [];
  if (!asOf.live) brief.push(<span key="asof">{asOf.past ? 'How things stood at the end of this day. ' : 'What is planned and expected by this day. '}</span>);
  if (!tasksLoading) {
    if (sum.late > 0 || sum.dueToday > 0) {
      const parts = [sum.dueToday > 0 ? `${sum.dueToday} ${sum.dueToday === 1 ? 'task is' : 'tasks are'} due today` : '', sum.late > 0 ? `${sum.late} ${sum.late === 1 ? 'is' : 'are'} late` : ''].filter(Boolean);
      brief.push(<span key="tasks">{parts.join(' and ')}. </span>);
    } else brief.push(<span key="tasks">Nothing is due today. </span>);
  }
  const upNext = ahead[0];
  if (upNext) {
    brief.push(
      <span key="next">
        {upNext.start <= nowMin ? 'On now: ' : 'Next: '}
        <b>{upNext.title}</b>
        {upNext.start > nowMin ? ` at ${clock(upNext.start)}` : ` until ${clock(upNext.end)}`}.{' '}
      </span>,
    );
  } else if (marks.length > 0) brief.push(<span key="next">The day’s blocks are behind you. </span>);
  if (allDay.length > 0) brief.push(<span key="allday">All day: {allDay.map((e) => e.title).join(', ')}. </span>);
  if (!financeLoading && soon.length > 0) {
    brief.push(
      <span key="due">
        <b>{soon[0].name}</b> ({money(soon[0].amount)}) {soon[0].kind === 'instruction' ? 'moves' : 'renews'} {D.inDays(soon[0].date, today)}.{' '}
      </span>,
    );
  }
  if (!financeLoading && review > 0) brief.push(<span key="review">{review} {review === 1 ? 'transaction needs' : 'transactions need'} a look.</span>);

  return (
    <Shell module="home" title="Home" icon={House} apps={apps} onOpenApp={onOpenApp} onAsk={onAsk} scrollKey="home">
      <div className="nxh">
        <section className="nxh-sky" data-sky={sky} data-lift-title="The day at a glance">
          <div className="nxh-sky__text">
            <p className="nxh-eyebrow fin-num">
              {WEEKDAY[now.getDay()]} {now.getDate()} {MONTH[now.getMonth()]} · {asOf.live ? clock(nowMin) : asOf.past ? 'end of day' : 'as planned'}
            </p>
            <h1>{asOf.live ? greeting : asOf.past ? 'Looking back.' : 'Looking ahead.'}</h1>
            <p className="nxh-brief">{brief.length > 0 ? brief : 'Getting the day together…'}</p>
          </div>

          <div className="nxh-arc" aria-hidden="true">
            <svg viewBox="0 0 1000 270" preserveAspectRatio="none">
              <path d="M0,190 Q500,-10 1000,190" />
              <line x1="0" x2="1000" y1="190" y2="190" />
            </svg>
            <span className={night ? 'nxh-sun nxh-sun--moon' : 'nxh-sun'} style={{ left: `${sunAt}%`, bottom: arcHeight(sunAt) }} />
            {[9, 12, 15, 18, 21].map((h) => (
              <span key={h} className="nxh-hour fin-num" style={{ left: `${along(h)}%` }}>
                {String(h).padStart(2, '0')}
              </span>
            ))}
            {stops.map((s, i) => {
              // A label gets the room between its neighbours and no more, so two never run into each other.
              const room = Math.min(i > 0 ? s.at - stops[i - 1].at : 100, i < stops.length - 1 ? stops[i + 1].at - s.at : 100);
              return (
                <span key={s.key} className="nxh-mark" data-past={s.end <= nowMin || undefined} style={{ left: `${s.at}%` }}>
                  {s.long ? <i className="nxh-mark__span" style={{ width: `calc(${s.width}cqw)` }} /> : <i className="nxh-mark__dot" />}
                  <span style={{ maxWidth: `calc(${Math.min(room, 18)}cqw - 10px)` }}>
                    {room >= 5 && s.title}
                    <small className="fin-num">{s.long && room >= 9 ? `${clock(s.start)}–${clock(s.end)}` : clock(s.start)}</small>
                  </span>
                </span>
              );
            })}
          </div>
        </section>

        <button type="button" className="nxh-ask" onClick={onAsk}>
          <span className="nxh-ask__mark">
            <Mark />
          </span>
          <span>Search, jump, or add</span>
          <span className="fin-key">Ctrl K</span>
        </button>

        <div className="nxh-cards">
          <section className="nxf-card">
            <div className="nxf-card__head">
              <h3>Next up</h3>
              {nextDue && <span className={nextDue.tone === 'late' ? 'nxf-chip nxf-chip--neg' : nextDue.tone === 'today' ? 'nxf-chip nxf-chip--att' : 'nxf-chip nxh-chip'}>{nextDue.text}</span>}
              <button type="button" className="nxf-card__link" onClick={() => onOpenApp('tasks')}>
                Tasks <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
            {next ? (
              <div className="nxh-next nxh-liftable" {...liftAttrs(taskThing(next))}>
                <p className="nxh-next__title">{next.title}</p>
                <p className="nxf-note">
                  {projectLabel(next.project)}
                  {next.scheduled && next.scheduled.slice(0, 10) === today && ` · ${next.scheduled.slice(11, 16)}`}
                  {next.estimate ? ` · ${spanWords(next.estimate)}` : ''}
                  {next.checklist.total > 0 && ` · ${next.checklist.done} of ${next.checklist.total} steps`}
                </p>
                {/* The card's head already opens Tasks: one door. */}
                {sum.open.length > 1 && (
                  <p className="nxf-note nxh-next__more">
                    {sum.open.length - 1} more for today
                    {sum.doneToday.length > 0 && ` · ${sum.doneToday.length} done`}
                  </p>
                )}
              </div>
            ) : (
              <div className="fin-empty">
                <p className="fin-empty__text">{tasksLoading ? 'Reading your tasks…' : sum.doneToday.length > 0 ? `Clear. ${sum.doneToday.length} finished today.` : 'Nothing due or scheduled today.'}</p>
              </div>
            )}
          </section>

          <section className="nxf-card">
            <div className="nxf-card__head">
              <h3>{D.monthName(today)}</h3>
              <button type="button" className="nxf-card__link" onClick={() => onOpenApp('finance')}>
                Finance <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
            {noBalances && flow.count === 0 ? (
              <div className="fin-empty">
                <p className="fin-empty__text">Set a balance on each account and the month shows up here.</p>
              </div>
            ) : (
              <>
                <div className="nxh-money">
                  <div>
                    <p className="nxf-label">Spent</p>
                    <span className="fin-num">{money(Math.round(flow.out))}</span>
                  </div>
                  <div>
                    <p className="nxf-label">{budgeted > 0 ? 'Free to spend' : 'Kept'}</p>
                    <span className={(budgeted > 0 ? free : flow.net) < 0 ? 'fin-num fin-negative' : 'fin-num'}>{money(Math.round(budgeted > 0 ? free : flow.net))}</span>
                  </div>
                  <div>
                    <p className="nxf-label">{asOf.future ? 'Net worth, expected' : 'Net worth'}</p>
                    <Secret className={asOf.future ? 'fin-num nxs-forecast' : 'fin-num'} label="Net worth" value={money(L.netWorth(data).total)} />
                  </div>
                </div>
                <PaceChart now={pace.now} before={pace.before} days={pace.days} limit={budgeted > 0 ? budgeted : undefined} format={(v) => money(Math.round(v))} nowLabel="Now" beforeLabel={prevMonth.slice(0, 3)} ahead={flow.out > last.out && last.out > 0} height={84} />
                <p className="nxf-note">
                  {last.out === 0 && flow.out === 0
                    ? 'No spending recorded yet.'
                    : `${money(Math.round(Math.abs(flow.out - last.out)))} ${flow.out <= last.out ? 'less' : 'more'} than this point in ${prevMonth}${budgeted > 0 && free > 0 && left > 0 ? ` · ${money(Math.round(free / left))} a day left` : ''}.`}
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}
