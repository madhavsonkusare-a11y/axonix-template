/**
 * The dashboard: widgets 4-up on a wide window and 2×2 otherwise (never 3 + 1).
 *
 * Widgets come from a registry keyed by id, and a dashboard is just a list of
 * ids — Home keeps the four it has always had, and a project page holds its own
 * list, which the owner edits. Each widget says where it may be used (`scope`)
 * and how wide it wants to be; nothing here assumes where a widget sits.
 */
import type { ReactNode } from 'react';
import { ArrowUpRight, Ban, ChevronLeft, ChevronRight, ExternalLink, Flame, TriangleAlert, X } from 'lucide-react';
import { AuroraLayers, auroraClass } from '../../finance/components/Aurora';
import { DAY_END, agenda, clock, dueLabel, momentum, projectLabel, projectStats, spanWords, todaySummary } from '../derive';
import { formatEstimate } from '../taskfile';
import { addDays } from '../../finance/format';
import { mondayOf, useCalendar, useEvents } from '../../calendar/CalendarContext';
import { APP_STAGES, type Task } from '../types';
import { COUNTRY_NAME, docKey, documentsOf, isApplication } from '../application';
import { useNotes } from '../../notes/NotesContext';
import { readProfile } from '../masters/profile';
import { check, daysTo as daysToDeadline, nextDeadline, readScholarships } from '../masters/scholarship';
import { ProjectDot } from './bits';

export interface WidgetContext {
  tasks: Task[];
  /** Opens a note by title; the scholarships widget needs it. */
  onOpenNote?: (target: string) => void;
  /** The project a project-scoped widget is showing, '' for the Inbox. */
  project?: string;
  projects: string[];
  today: string;
  now: Date;
  onOpen: (id: string) => void;
  onProject: (project: string) => void;
}

export type WidgetId = 'today' | 'agenda' | 'momentum' | 'projects' | 'deadlines' | 'pipeline' | 'documents' | 'scholarships';

export interface WidgetDef {
  title: string;
  /** What it is for, one line, shown in the Add-widget menu. */
  hint: string;
  /** Home's dashboard, a project's, or both. */
  scope: 'home' | 'project' | 'both';
  /** Cells across; 2 for a widget that needs the room. */
  size?: 1 | 2;
  render: (ctx: WidgetContext) => ReactNode;
}

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  today: { title: 'Today', hint: 'What is due, late and done today', scope: 'both', render: (ctx) => <TodayWidget {...ctx} /> },
  agenda: { title: 'Agenda', hint: "Today's time blocks and free gaps", scope: 'both', render: (ctx) => <AgendaWidget {...ctx} /> },
  momentum: { title: 'Momentum', hint: 'Seven days of finished work, and the streak', scope: 'both', render: (ctx) => <MomentumWidget {...ctx} /> },
  projects: { title: 'Projects', hint: 'Every project and how far along it is', scope: 'home', render: (ctx) => <ProjectsWidget {...ctx} /> },
  deadlines: { title: 'Deadlines', hint: 'The next applications to close, with a countdown', scope: 'project', render: (ctx) => <DeadlinesWidget {...ctx} /> },
  pipeline: { title: 'Pipeline', hint: 'Where each application stands', scope: 'project', render: (ctx) => <PipelineWidget {...ctx} /> },
  documents: { title: 'Documents', hint: 'Which paper is missing, and where', scope: 'project', size: 2, render: (ctx) => <DocumentsWidget {...ctx} /> },
  scholarships: { title: 'Scholarships', hint: 'What you may have, and what closes next', scope: 'project', render: (ctx) => <ScholarshipsWidget {...ctx} /> },
};

export const DEFAULT_DASHBOARD: WidgetId[] = ['today', 'agenda', 'momentum', 'projects'];

/** Widgets a project page may hold. */
export const PROJECT_WIDGETS = (Object.keys(WIDGETS) as WidgetId[]).filter((id) => WIDGETS[id].scope !== 'home');

export interface DashboardEdit {
  onMove: (id: WidgetId, by: -1 | 1) => void;
  onRemove: (id: WidgetId) => void;
}

export default function Dashboard({ layout = DEFAULT_DASHBOARD, edit, ...ctx }: WidgetContext & { layout?: WidgetId[]; edit?: DashboardEdit }) {
  return (
    <div className="tsk-widgets">
      {layout.map((id, i) => {
        const w = WIDGETS[id];
        if (!w) return null;
        return (
          <div key={id} className="tsk-widgets__cell" data-wide={w.size === 2 || undefined}>
            {w.render(ctx)}
            {edit && (
              <div className="tsk-widgets__edit">
                <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => edit.onMove(id, -1)} disabled={i === 0} aria-label={`Move ${w.title} left`}>
                  <ChevronLeft size={13} strokeWidth={2} />
                </button>
                <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => edit.onMove(id, 1)} disabled={i === layout.length - 1} aria-label={`Move ${w.title} right`}>
                  <ChevronRight size={13} strokeWidth={2} />
                </button>
                <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => edit.onRemove(id)} aria-label={`Remove ${w.title}`}>
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Today — the light-blue aurora                                       */
/* ------------------------------------------------------------------ */

function Ring({ done, total }: { done: number; total: number }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const part = total ? done / total : 0;
  return (
    <svg className="tsk-ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r={r} className="tsk-ring__track" />
      {part > 0 && <circle cx="24" cy="24" r={r} className="tsk-ring__fill" strokeDasharray={`${c * part} ${c}`} />}
    </svg>
  );
}

function TodayWidget({ tasks, today, onOpen }: WidgetContext) {
  const s = todaySummary(tasks, today);
  const total = s.open.length + s.doneToday.length;
  const next = s.next;
  const nextDue = next ? dueLabel(next, today) : null;
  return (
    <div className={auroraClass('violet', 'tsk-today')}>
      <AuroraLayers />
      <div className="fin-aurora__body tsk-today__body">
        <div className="tsk-today__top">
          <span className="tsk-today__label">Today</span>
          <Ring done={s.doneToday.length} total={total} />
        </div>
        <div className="tsk-today__figure">
          <span className="fin-num fin-num--xl">{s.doneToday.length}</span>
          <span className="tsk-today__of fin-num">/{total}</span>
          <span className="tsk-today__word">done</span>
        </div>
        <div className="tsk-today__line">
          {s.dueToday} due{s.late > 0 && ` · ${s.late} late`}
        </div>
        {next ? (
          <button type="button" className="tsk-today__next fin-ink" onClick={() => onOpen(next.id)}>
            <span className="tsk-today__nextlabel">{next.state === 'doing' ? 'In hand' : 'Next'}</span>
            <span className="tsk-today__nexttitle">{next.title}</span>
            {nextDue?.tone === 'late' ? (
              <TriangleAlert size={12} strokeWidth={2.2} aria-label={nextDue.text} />
            ) : next.scheduled?.slice(0, 10) === today ? (
              <span className="fin-num">{next.scheduled.slice(11)}</span>
            ) : (
              <ArrowUpRight size={13} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        ) : (
          <p className="tsk-today__clear fin-ink">{total ? 'All done for today.' : 'Nothing due today.'}</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agenda — time blocks and free time                                  */
/* ------------------------------------------------------------------ */

function AgendaWidget({ tasks, today, now, onOpen }: WidgetContext) {
  const { status } = useCalendar();
  const week = mondayOf(today);
  const ev = useEvents(week, addDays(week, 6));
  const events = (ev?.events ?? []).filter((e) => !e.allDay && e.calendarId !== status?.axonixCalendarId);
  const items = agenda(tasks, today, now, events);
  const blocks = items.filter((i) => i.kind === 'block' || i.kind === 'event');
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <div className="fin-card tsk-widget">
      <div className="tsk-widget__head">
        <h3 className="fin-card__title">Agenda</h3>
        <span className="fin-card__aside">{blocks.length ? `${blocks.length} on today` : 'Today'}</span>
      </div>
      {nowMin >= DAY_END && !blocks.length ? (
        <p className="tsk-widget__empty">The day is over. Tomorrow’s blocks show here in the morning.</p>
      ) : (
        <ol className="tsk-agenda">
          {items.map((i, k) => {
            if (i.kind === 'now') {
              return (
                <li key={`now-${k}`} className="tsk-agenda__now">
                  <span className="fin-num">{clock(i.start)}</span>
                  <span className="tsk-agenda__nowline" aria-hidden="true" />
                </li>
              );
            }
            if (i.kind === 'free') {
              return (
                <li key={`free-${k}`} className="tsk-agenda__free">
                  {/* A gap that starts now needs no second time: the now-line above says it. */}
                  <span className="fin-num">{i.start === nowMin ? '' : clock(i.start)}</span>
                  <span>
                    {spanWords(i.end - i.start)} free{i.end === DAY_END ? ` until ${clock(DAY_END)}` : ''}
                  </span>
                </li>
              );
            }
            if (i.kind === 'event') {
              const e = i.event!;
              return (
                <li key={`ev-${e.id}`}>
                  <span className="tsk-agenda__block tsk-agenda__block--event" data-past={i.end <= nowMin || undefined} style={{ '--ec': e.color } as React.CSSProperties}>
                    <span className="fin-num">{clock(i.start)}</span>
                    <span className="tsk-agenda__title">{e.title}</span>
                    <span className="tsk-agenda__len fin-num">{formatEstimate(i.end - i.start)}</span>
                  </span>
                </li>
              );
            }
            const t = i.task!;
            return (
              <li key={t.id}>
                <button type="button" className="tsk-agenda__block" data-past={i.end <= nowMin || undefined} onClick={() => onOpen(t.id)}>
                  <span className="fin-num">{clock(i.start)}</span>
                  <span className="tsk-agenda__title">{t.title}</span>
                  <span className="tsk-agenda__len fin-num">{formatEstimate(i.end - i.start)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {!blocks.length && nowMin < DAY_END && <p className="tsk-widget__hint">Give a task a time — “call the bank 3pm” — and it blocks out the slot.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Momentum — finished per day, streak, Doing → Done                   */
/* ------------------------------------------------------------------ */

const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MomentumWidget({ tasks, today }: WidgetContext) {
  const m = momentum(tasks, today);
  const max = Math.max(1, ...m.days.map((d) => d.count));
  const cycle =
    m.cycleHours === undefined ? null : m.cycleHours < 24 ? `${Math.max(1, Math.round(m.cycleHours))}h` : `${(m.cycleHours / 24).toFixed(m.cycleHours < 240 ? 1 : 0)}d`;
  return (
    <div className="fin-card tsk-widget">
      <div className="tsk-widget__head">
        <h3 className="fin-card__title">Momentum</h3>
        <span className="fin-card__aside">
          <span className="fin-num">{m.week}</span> this week
        </span>
      </div>
      <div className="tsk-bars" role="img" aria-label={`Finished per day, last seven days: ${m.days.map((d) => d.count).join(', ')}`}>
        {m.days.map((d) => {
          const [y, mo, da] = d.day.split('-').map(Number);
          const letter = DAY_LETTER[new Date(y, mo - 1, da).getDay()];
          return (
            <div key={d.day} className="tsk-bars__col" data-today={d.day === today || undefined}>
              <span className="tsk-bars__n fin-num">{d.count || ''}</span>
              <span className="tsk-bars__bar" style={{ height: `${Math.max(d.count ? 12 : 4, (d.count / max) * 100)}%` }} />
              <span className="tsk-bars__day">{letter}</span>
            </div>
          );
        })}
      </div>
      <div className="tsk-momentum__stats">
        <span title="Days in a row with something finished">
          <Flame size={12} strokeWidth={2} aria-hidden="true" />
          <span>
            <span className="fin-num">{m.streak}</span>-day streak
          </span>
        </span>
        <span title="Median time from Doing to Done, last 30 days">
          Doing → Done <span className="fin-num">{cycle ?? '—'}</span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Projects — progress                                                  */
/* ------------------------------------------------------------------ */

function ProjectsWidget({ tasks, projects, today, onProject }: WidgetContext) {
  const stats = projectStats(tasks, projects, today)
    .filter((p) => p.total > 0 || p.name !== '')
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const shown = stats.slice(0, 4);
  return (
    <div className="fin-card tsk-widget">
      <div className="tsk-widget__head">
        <h3 className="fin-card__title">Projects</h3>
        <span className="fin-card__aside">
          <span className="fin-num">{projects.length}</span> project{projects.length === 1 ? '' : 's'}
        </span>
      </div>
      {shown.length ? (
        <div className="tsk-projects">
          {shown.map((p) => (
            <button key={p.name || 'inbox'} type="button" className="tsk-projects__row" onClick={() => onProject(p.name)}>
              <span className="tsk-projects__name">
                <ProjectDot name={p.name} />
                <span>{projectLabel(p.name)}</span>
                {p.blocked > 0 && (
                  <span className="tsk-projects__flag" title={`${p.blocked} blocked`}>
                    <Ban size={10} strokeWidth={2.4} aria-hidden="true" />
                    <span className="fin-num">{p.blocked}</span>
                  </span>
                )}
                <span className="tsk-projects__count fin-num">
                  {p.done}/{p.total}
                </span>
              </span>
              <span className="fin-bar fin-bar--thin">
                <span className="fin-bar__fill tsk-projects__fill" style={{ clipPath: `inset(0 ${100 - (p.total ? (p.done / p.total) * 100 : 0)}% 0 0 round 980px)` }} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="tsk-widget__empty">Start a project when a piece of work deserves its own space.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deadlines — the applications about to close                         */
/* ------------------------------------------------------------------ */

/** Whole days from today to `iso`; negative once it has passed. */
function daysTo(iso: string, today: string): number {
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

function countdown(days: number): string {
  if (days < 0) return `${-days}d late`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 45) return `in ${days}d`;
  const weeks = Math.round(days / 7);
  return weeks < 12 ? `in ${weeks}w` : `in ${Math.round(days / 30)}mo`;
}

function DeadlinesWidget({ tasks, today, onOpen }: WidgetContext) {
  const apps = tasks
    .filter((t) => isApplication(t) && t.due && t.stage !== 'rejected')
    .sort((a, b) => (a.due! < b.due! ? -1 : 1))
    .slice(0, 6);
  return (
    <div className="fin-card tsk-widget tsk-deadlines">
      <div className="tsk-widget__head">
        <h3 className="fin-card__title">Deadlines</h3>
        {apps.length > 0 && <span className="fin-card__aside fin-num">{apps.length}</span>}
      </div>
      {apps.length ? (
        <ul className="tsk-deadlines__list">
          {apps.map((t) => {
            const days = daysTo(t.due!, today);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => onOpen(t.id)}>
                  <span className="tsk-deadlines__uni">{t.uni}</span>
                  <span className="tsk-deadlines__prog">
                    {t.country && <em title={COUNTRY_NAME[t.country] ?? t.country}>{t.country}</em>}
                    <span>{t.programme ?? t.title}</span>
                  </span>
                  <span className="tsk-deadlines__when fin-num" data-tone={days < 0 ? 'late' : days <= 14 ? 'soon' : undefined}>
                    {countdown(days)}
                  </span>
                </button>
                {t.portal && (
                  <a className="fin-icon-btn fin-icon-btn--sm" href={t.portal} target="_blank" rel="noreferrer noopener" aria-label={`Open the ${t.uni} portal`} title={t.portal}>
                    <ExternalLink size={12} strokeWidth={1.9} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tsk-widget__empty">No application has a deadline yet. Give one a university and a due date.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pipeline — where each application stands                            */
/* ------------------------------------------------------------------ */

function PipelineWidget({ tasks, onOpen }: WidgetContext) {
  const apps = tasks.filter(isApplication);
  const counts = new Map<string, Task[]>();
  for (const t of apps) {
    const key = t.stage ?? 'researching';
    counts.set(key, [...(counts.get(key) ?? []), t]);
  }
  const most = Math.max(1, ...APP_STAGES.map((s) => counts.get(s.id)?.length ?? 0));
  return (
    <div className="fin-card tsk-widget tsk-pipeline">
      <div className="tsk-widget__head">
        <h3 className="fin-card__title">Pipeline</h3>
        <span className="fin-card__aside">{apps.length ? `${apps.length} applications` : ''}</span>
      </div>
      {apps.length ? (
        <div className="tsk-pipeline__rows">
          {APP_STAGES.map((s) => {
            const here = counts.get(s.id) ?? [];
            return (
              <button key={s.id} type="button" className="tsk-pipeline__row" data-stage={s.id} data-empty={here.length === 0 || undefined} onClick={() => here[0] && onOpen(here[0].id)} disabled={!here.length}>
                <span className="tsk-pipeline__name">{s.label}</span>
                <span className="fin-bar fin-bar--thin">
                  <span className="fin-bar__fill" style={{ clipPath: `inset(0 ${100 - (here.length / most) * 100}% 0 0 round 980px)` }} />
                </span>
                <span className="tsk-pipeline__count fin-num">{here.length}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="tsk-widget__empty">Add an application — a task with a university on it — and it appears here.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Documents — which paper is missing, and where                       */
/* ------------------------------------------------------------------ */

function DocumentsWidget({ tasks, onOpen }: WidgetContext) {
  const apps = tasks.filter(isApplication).slice(0, 8);
  // Columns: every document name in play, in the order they first appear.
  const columns: { key: string; label: string }[] = [];
  const rows = apps.map((t) => {
    const docs = documentsOf(t);
    for (const d of docs) {
      const key = docKey(d.label);
      if (key && !columns.some((c) => c.key === key)) columns.push({ key, label: d.label });
    }
    return { task: t, have: new Map(docs.map((d) => [docKey(d.label), d.done])) };
  });
  // The one that is missing in the most places, named in the footer.
  const worst = columns
    .map((c) => ({ ...c, missing: rows.filter((r) => r.have.get(c.key) === false).length }))
    .sort((a, b) => b.missing - a.missing)[0];

  return (
    <div className="fin-card tsk-widget tsk-docs">
      <div className="tsk-widget__head">
        <h3 className="fin-card__title">Documents</h3>
        {columns.length > 0 && <span className="fin-card__aside">{columns.length} kinds</span>}
      </div>
      {rows.length && columns.length ? (
        <>
          <div className="tsk-docs__grid">
            {rows.map(({ task, have }) => {
              const done = columns.filter((c) => have.get(c.key) === true).length;
              const total = columns.filter((c) => have.has(c.key)).length;
              return (
                <button key={task.id} type="button" className="tsk-docs__row" onClick={() => onOpen(task.id)}>
                  <span className="tsk-docs__uni">{task.uni}</span>
                  <span className="tsk-docs__dots">
                    {columns.map((c) => {
                      const state = have.has(c.key) ? (have.get(c.key) ? 'done' : 'missing') : 'none';
                      return <span key={c.key} className="tsk-docs__dot" data-state={state} title={`${c.label} — ${state === 'done' ? 'done' : state === 'missing' ? 'missing' : 'not on this application'}`} />;
                    })}
                  </span>
                  <span className="tsk-docs__count fin-num">
                    {done}/{total}
                  </span>
                </button>
              );
            })}
          </div>
          {worst && worst.missing > 0 && (
            <p className="tsk-widget__hint">
              Missing most often: <b>{worst.label}</b> <span className="fin-num">({worst.missing})</span>
            </p>
          )}
        </>
      ) : (
        <p className="tsk-widget__empty">Each application's checklist shows up here — transcripts, SOP, letters, tests.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scholarships — what you may have, and what closes next              */
/* ------------------------------------------------------------------ */

function ScholarshipsWidget({ project, today, onOpenNote }: WidgetContext) {
  const { notes } = useNotes();
  const mine = notes.filter((n) => n.project === (project ?? ''));
  const profile = readProfile(mine);
  const all = readScholarships(mine).map((s) => {
    const deadline = nextDeadline(s, today);
    return { s, deadline, days: deadline ? daysToDeadline(deadline.date, today) : undefined, level: check(s, profile, today).level };
  });
  const worth = all.filter((r) => r.level === 'eligible' || r.level === 'borderline');
  const soon = all
    .filter((r) => r.days !== undefined && r.days >= 0 && r.level !== 'no')
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .slice(0, 5);

  return (
    <div className="fin-card tsk-widget tsk-sch">
      <div className="tsk-widget__head">
        <h3 className="fin-card__title">Scholarships</h3>
        {all.length > 0 && (
          <span className="fin-card__aside">
            <span className="fin-num">{worth.length}</span> worth a look
          </span>
        )}
      </div>
      {soon.length ? (
        <ul className="tsk-sch__list">
          {soon.map(({ s, days, level }) => (
            <li key={s.path}>
              <button type="button" onClick={() => onOpenNote?.(s.title)}>
                <span className="tsk-sch__dot" data-level={level} title={level === 'eligible' ? 'Eligible' : 'Worth checking'} />
                <span className="tsk-sch__name">{s.title}</span>
                <span className="tsk-sch__when fin-num" data-tone={(days ?? 0) <= 60 ? 'soon' : undefined}>
                  {(days ?? 0) < 45 ? `in ${days}d` : `in ${Math.round((days ?? 0) / 30)}mo`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tsk-widget__empty">{all.length ? 'Nothing open in this window. The Scholarships tab has the whole list.' : 'Add notes of kind Scholarship to this project and they appear here.'}</p>
      )}
      {all.length > 0 && <p className="tsk-widget__hint">{all.filter((r) => r.level === 'no').length} ruled out for now · dates were read when each note says</p>}
    </div>
  );
}
