/**
 * Compare — the shortlist side by side, in rupees.
 *
 * Every figure keeps its own currency as written and shows the rupee amount
 * underneath, converted at today's reference rate, because the decision is
 * made in rupees but the source page is not. A tuition figure nobody marked
 * *official* is labelled an estimate.
 *
 * The rows that are not money are the ones people forget: the paperwork each
 * country adds for an Indian applicant (APS, ATAS, WES), what the scholarships
 * you have entered would cover, and how long you may stay and work afterwards.
 */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useNotes } from '../../notes/NotesContext';
import { vault } from '../../notes/backend';
import { COUNTRIES, COUNTRY_NAME } from '../application';
import { todayIso } from '../derive';
import { readProfile } from './profile';
import { inRupees, overCourse, parseMoney, readProgrammes, rupees, type Programme } from './programme';
import { check, readScholarships } from './scholarship';
import { canResearch, research } from './research';

/**
 * How long a graduate may stay and work afterwards. It moves with politics —
 * the UK's route drops to 18 months for courses applied to from January 2027 —
 * so each line says when it was last read.
 */
const WORK_AFTER: Record<string, string> = {
  DE: '18-month job-seeker permit',
  US: '12 months OPT, 36 for STEM',
  CA: 'PGWP, up to 3 years',
  GB: 'Graduate Route, 2 years (18 months from Jan 2027)',
  NL: 'Orientation year (zoekjaar)',
  SE: 'Residence permit to seek work',
  CH: '6 months to find work',
  AU: 'Temporary Graduate visa',
};
const WORK_CHECKED = '2026-09-20';

export default function Compare({ project, onOpenNote }: { project: string; onOpenNote: (target: string) => void }) {
  const { notes } = useNotes();
  const today = todayIso();
  const mine = useMemo(() => notes.filter((n) => n.project === project), [notes, project]);
  const programmes = useMemo(() => readProgrammes(mine), [mine]);
  const profile = useMemo(() => readProfile(mine), [mine]);
  const scholarships = useMemo(() => readScholarships(mine), [mine]);

  const [picked, setPicked] = useState<string[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});

  useEffect(() => {
    setPicked((p) => (p.length ? p.filter((x) => programmes.some((q) => q.path === x)) : programmes.slice(0, 3).map((q) => q.path)));
  }, [programmes]);

  // One rate per currency in play, from the reference rates.
  useEffect(() => {
    if (!canResearch) return;
    const wanted = new Set<string>();
    for (const p of programmes) {
      for (const text of [p.tuition, p.livingCost]) {
        const m = parseMoney(text);
        if (m && m.currency !== 'INR') wanted.add(m.currency);
      }
    }
    for (const c of wanted) {
      if (rates[c] !== undefined) continue;
      void research
        .rates(c)
        .then((r) => setRates((old) => ({ ...old, [c]: r.rates?.INR ?? 0 })))
        .catch(() => setRates((old) => ({ ...old, [c]: 0 })));
    }
  }, [programmes, rates]);

  const shown = programmes.filter((p) => picked.includes(p.path)).slice(0, 5);

  const money = (text: string | undefined, months: number) => {
    const m = parseMoney(text);
    if (!m) return { written: text ?? '—', inr: null as number | null };
    const total = overCourse(m, months);
    return { written: text!, inr: inRupees(total, m.currency, rates) };
  };

  const fundingFor = (p: Programme) =>
    scholarships.filter((s) => {
      if (check(s, profile, today).level === 'no') return false;
      return !s.countries.length || (p.country ? s.countries.includes(p.country) || s.countries.includes('EU') : false);
    });

  if (!programmes.length) {
    return (
      <div className="prj-dash__empty">
        <h3>Nothing to compare yet</h3>
        <p>Shortlist a few programmes in Discover, or write a note of kind Programme, and they line up here with their costs in rupees.</p>
      </div>
    );
  }

  const row = (label: string, render: (p: Programme) => React.ReactNode, note?: string) => (
    <tr>
      <th scope="row">
        {label}
        {note && <em>{note}</em>}
      </th>
      {shown.map((p) => (
        <td key={p.path}>{render(p)}</td>
      ))}
    </tr>
  );

  return (
    <section className="cmp" aria-label="Compare programmes">
      <div className="cmp__pick" role="group" aria-label="Which to compare">
        {programmes.map((p) => (
          <button
            type="button"
            key={p.path}
            data-active={picked.includes(p.path) || undefined}
            onClick={() => setPicked((cur) => (cur.includes(p.path) ? cur.filter((x) => x !== p.path) : cur.length >= 5 ? cur : [...cur, p.path]))}
          >
            {p.uni ?? p.title}
          </button>
        ))}
        <span className="fin-hint">{picked.length}/5</span>
      </div>

      <div className="cmp__scroll">
        <table className="cmp__table">
          <thead>
            <tr>
              <th scope="col" />
              {shown.map((p) => (
                <th scope="col" key={p.path}>
                  <button type="button" onClick={() => onOpenNote(p.title)}>
                    <strong>{p.uni ?? p.title}</strong>
                    <span>{p.programme ?? '—'}</span>
                  </button>
                  {p.link && (
                    <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => vault.openUrl(p.link!)} aria-label={`Open ${p.title}`}>
                      <ExternalLink size={12} strokeWidth={1.9} />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row('Where', (p) => (p.country ? `${p.city ? `${p.city}, ` : ''}${COUNTRY_NAME[p.country] ?? p.country}` : '—'))}
            {row('Taught in', (p) => p.language ?? '—')}
            {row('Length', (p) => (p.months ? `${p.months} months` : '—'))}
            {row(
              'Tuition',
              (p) => {
                const m = money(p.tuition, p.months ?? 24);
                return (
                  <span className="cmp__money">
                    <b>{m.written}</b>
                    {m.inr !== null && <em className="fin-num">{rupees(m.inr)} over the course</em>}
                    {p.tuition && p.tuitionBasis !== 'official' && <i data-basis={p.tuitionBasis}>{p.tuitionBasis}</i>}
                  </span>
                );
              },
              'as written, then in rupees',
            )}
            {row('Living', (p) => {
              const m = money(p.livingCost, p.months ?? 24);
              return (
                <span className="cmp__money">
                  <b>{m.written}</b>
                  {m.inr !== null && <em className="fin-num">{rupees(m.inr)} over the course</em>}
                </span>
              );
            })}
            {row('Total', (p) => {
              const t = money(p.tuition, p.months ?? 24).inr;
              const l = money(p.livingCost, p.months ?? 24).inr;
              if (t === null && l === null) return '—';
              const sum = (t ?? 0) + (l ?? 0);
              const over = profile.budgetInr !== undefined && sum > profile.budgetInr;
              return (
                <span className="cmp__money">
                  <b className="fin-num" data-over={over || undefined}>
                    {rupees(sum)}
                  </b>
                  {t === null || l === null ? <em>part of it is missing</em> : over ? <em>over your ceiling</em> : profile.budgetInr !== undefined ? <em>inside your ceiling</em> : null}
                </span>
              );
            })}
            {row('Next deadline', (p) => {
              const d = p.deadlines.find((x) => x.date >= today) ?? p.deadlines[p.deadlines.length - 1];
              return d ? (
                <span className="cmp__money">
                  <b className="fin-num">{d.date}</b>
                  {d.cycle && <em>{d.cycle}</em>}
                </span>
              ) : (
                '—'
              );
            })}
            {row(
              'Paperwork',
              (p) => {
                const c = COUNTRIES.find((x) => x.code === p.country);
                return c?.gate ? <span className="cmp__gate">{c.gate}</span> : c ? 'Nothing unusual' : '—';
              },
              'what this country adds for an Indian applicant',
            )}
            {row(
              'Money you could use',
              (p) => {
                const f = fundingFor(p);
                return f.length ? (
                  <span className="cmp__money">
                    <b>{f.length} scholarship{f.length === 1 ? '' : 's'}</b>
                    <em>{f.slice(0, 2).map((s) => s.title).join(' · ')}</em>
                  </span>
                ) : (
                  <span className="cmp__none">none entered yet</span>
                );
              },
              'from your own notes, minus the ones you cannot have',
            )}
            {row('Work after', (p) => (p.country ? (WORK_AFTER[p.country] ?? '—') : '—'), `read ${WORK_CHECKED}`)}
            {row('Checked', (p) => (p.checked ? <span className="fin-num">{p.checked}</span> : <span className="cmp__none">never</span>), 'when its figures were last read')}
          </tbody>
        </table>
      </div>
      <p className="sch__foot">Conversions use today's reference rate. Visa and work rules move with politics — the dates above say when each line was read.</p>
    </section>
  );
}
