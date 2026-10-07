/**
 * Scholarships, filtered to you.
 *
 * The list is a view over notes of `kind: scholarship` in this project: what
 * each one covers, when it next closes, and whether you may have it — with the
 * reason spelled out, because a verdict you cannot argue with is useless. Most
 * of these close months before the universities do, which is the whole point of
 * showing them on their own.
 */
import { useMemo, useState } from 'react';
import { ExternalLink, Plus, Search } from 'lucide-react';
import { useNotes } from '../../notes/NotesContext';
import { vault } from '../../notes/backend';
import { todayIso } from '../derive';
import { readProfile } from './profile';
import { LEVEL_LABEL, check, daysTo, nextDeadline, readScholarships, type Level } from './scholarship';

type Filter = 'all' | 'eligible' | 'soon';

const when = (days: number) => (days < 0 ? `closed ${-days}d ago` : days === 0 ? 'closes today' : days === 1 ? 'closes tomorrow' : days < 45 ? `in ${days}d` : days < 400 ? `in ${Math.round(days / 30)}mo` : `in ${Math.round(days / 365)}y`);

export default function Scholarships({ project, onOpenNote }: { project: string; onOpenNote: (target: string) => void }) {
  const { notes, create } = useNotes();
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const today = todayIso();

  const mine = useMemo(() => notes.filter((n) => n.project === project), [notes, project]);
  const profile = useMemo(() => readProfile(mine), [mine]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return readScholarships(mine)
      .map((s) => {
        const deadline = nextDeadline(s, today);
        return { s, deadline, days: deadline ? daysTo(deadline.date, today) : undefined, verdict: check(s, profile, today) };
      })
      .filter(({ s, verdict, days }) => {
        if (filter === 'eligible' && verdict.level === 'no') return false;
        if (filter === 'soon' && !(days !== undefined && days >= 0 && days <= 120)) return false;
        if (q && !s.title.toLowerCase().includes(q) && !(s.provider ?? '').toLowerCase().includes(q) && !s.countries.join(' ').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const ax = a.days === undefined ? 1e6 : a.days < 0 ? 1e5 - a.days : a.days;
        const bx = b.days === undefined ? 1e6 : b.days < 0 ? 1e5 - b.days : b.days;
        return ax - bx;
      });
  }, [mine, profile, filter, query, today]);

  const counts = useMemo(() => {
    const all = readScholarships(mine).map((s) => check(s, profile, today).level);
    return { eligible: all.filter((l) => l === 'eligible').length, borderline: all.filter((l) => l === 'borderline').length, no: all.filter((l) => l === 'no').length, total: all.length };
  }, [mine, profile, today]);

  if (!counts.total) {
    return (
      <div className="prj-dash__empty">
        <h3>No scholarships here yet</h3>
        <p>One note per scholarship — what it covers, who may have it, when it closes. Fill the properties in the form; the list then says whether you may have it, and when it shuts.</p>
        <div className="prj-dash__choices">
          <button type="button" onClick={() => void create({ title: 'New scholarship', kind: 'scholarship', project }).then((path) => path && onOpenNote(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')))}>
            <strong>New scholarship</strong>
            <span>Starts a note with every property ready to fill</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="sch" aria-label="Scholarships">
      <header className="sch__bar">
        <div className="sch__tabs" role="group" aria-label="Filter">
          {([['all', `All ${counts.total}`], ['eligible', `Worth a look ${counts.eligible + counts.borderline}`], ['soon', 'Closing soon']] as const).map(([id, label]) => (
            <button type="button" key={id} data-active={filter === id || undefined} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="tsk-search sch__find">
          <Search size={13} strokeWidth={1.9} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a scholarship" aria-label="Find a scholarship" spellCheck={false} />
        </label>
        {!profile.path && <span className="sch__warn">No profile note yet — every verdict is a guess until there is one.</span>}
        <span className="fin-spacer" />
        <button
          type="button"
          className="fin-pill fin-pill--action fin-pill--sm"
          disabled={adding}
          onClick={() => {
            setAdding(true);
            void create({ title: 'New scholarship', kind: 'scholarship', project })
              .then((path) => path && onOpenNote(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')))
              .finally(() => setAdding(false));
          }}
        >
          <Plus size={13} strokeWidth={2.2} />
          New scholarship
        </button>
      </header>

      <ul className="sch__list">
        {rows.map(({ s, deadline, days, verdict }) => (
          <li key={s.path} className="sch__row" data-level={verdict.level}>
            <button type="button" className="sch__open" onClick={() => onOpenNote(s.title)}>
              <span className="sch__name">
                {s.title}
                {s.countries.length > 0 && <em>{s.countries.join(' · ')}</em>}
              </span>
              <span className="sch__covers">
                {s.amount ?? s.covers.join(', ') ?? ''}
                {s.type && s.type !== 'grant' && <b> · {s.type.replace(/-/g, ' ')}</b>}
              </span>
              <span className="sch__reason">{verdict.reasons[0]}</span>
            </button>
            <span className="sch__right">
              <span className="sch__verdict" data-level={verdict.level}>
                {LEVEL_LABEL[verdict.level]}
              </span>
              {deadline && (
                <span className="sch__when fin-num" data-tone={days !== undefined && days < 0 ? 'past' : days !== undefined && days <= 60 ? 'soon' : undefined} title={`${deadline.date}${deadline.cycle ? ` — ${deadline.cycle}` : ''}`}>
                  {when(days ?? 0)}
                </span>
              )}
              {s.link && (
                <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => vault.openUrl(s.link!)} aria-label={`Open the ${s.title} page`} title={s.link}>
                  <ExternalLink size={12} strokeWidth={1.9} />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="sch__foot">
        Deadlines and rules were read on the date in each note. They move every cycle — open the page before you rely on one.
      </p>
    </section>
  );
}

/** The level a row shows, for the widget's dots. */
export type { Level };
