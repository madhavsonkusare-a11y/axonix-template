/**
 * Discover — which universities actually work on what you want to study.
 *
 * Not a directory of marketing pages: OpenAlex is asked which institutions
 * published on your topics in the last five years, the answer is filtered to
 * universities in the countries you care about, and each row can become a
 * programme note with its OpenAlex id already on it. The papers are the
 * evidence; the brochure comes later, from the page you paste.
 *
 * Counts are works since 2021 mentioning the topic in title or abstract. They
 * measure *activity*, not teaching quality, and that is exactly how the row
 * reads them out.
 */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Plus, Search, Telescope } from 'lucide-react';
import { toast } from 'sonner';
import { useNotes } from '../../notes/NotesContext';
import { vault } from '../../notes/backend';
import { COUNTRIES, COUNTRY_NAME } from '../application';
import { readProfile } from './profile';
import { readProgrammes } from './programme';
import { canResearch, research } from './research';

interface Row {
  id: string;
  name: string;
  country?: string;
  works: number;
  homepage?: string;
  type?: string;
}

const SINCE = 2021;

export default function Discover({ project, onOpenNote }: { project: string; onOpenNote: (target: string) => void }) {
  const { notes, create, saved } = useNotes();
  const mine = useMemo(() => notes.filter((n) => n.project === project), [notes, project]);
  const profile = useMemo(() => readProfile(mine), [mine]);
  const have = useMemo(() => new Set(readProgrammes(mine).map((p) => (p.uni ?? p.title).toLowerCase())), [mine]);

  const [topic, setTopic] = useState(profile.topics[0] ?? '');
  const [countries, setCountries] = useState<string[]>(profile.countries.length ? profile.countries : []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (!topic && profile.topics[0]) setTopic(profile.topics[0]);
  }, [profile.topics, topic]);

  const look = async () => {
    const q = topic.trim();
    if (!q) {
      toast('Say what to look for — a topic, not a university.');
      return;
    }
    setBusy(true);
    try {
      const filter = [`title_and_abstract.search:${q}`, `publication_year:>${SINCE - 1}`];
      if (countries.length) filter.push(`institutions.country_code:${countries.map((c) => c.toLowerCase()).join('|')}`);
      const grouped = (await research.openalex('works', { filter: filter.join(','), group_by: 'authorships.institutions.lineage', per_page: '200' })) as {
        group_by?: { key: string; key_display_name: string; count: number }[];
      };
      const top = (grouped.group_by ?? []).filter((g) => g.key.startsWith('https://openalex.org/I')).slice(0, 40);
      if (!top.length) {
        setRows([]);
        return;
      }
      const details = (await research.openalex('institutions', {
        filter: `ids.openalex:${top.map((g) => g.key).join('|')}`,
        per_page: '50',
        select: 'id,display_name,country_code,type,homepage_url',
      })) as { results?: { id: string; display_name: string; country_code?: string; type?: string; homepage_url?: string }[] };
      const byId = new Map((details.results ?? []).map((r) => [r.id, r]));
      setRows(
        top
          .map((g) => {
            const d = byId.get(g.key);
            return { id: g.key, name: d?.display_name ?? g.key_display_name, country: d?.country_code?.toUpperCase(), works: g.count, homepage: d?.homepage_url, type: d?.type };
          })
          // Universities only: the labs and space agencies are not places to apply.
          .filter((r) => r.type === 'education' && (!countries.length || (r.country && countries.includes(r.country))))
          .slice(0, 20),
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** A row becomes a programme note, with what we already know written in. */
  const shortlist = async (row: Row) => {
    setAdding(row.id);
    try {
      const path = await create({ title: `${row.name} — ${topic}`, kind: 'programme', project });
      if (!path) return;
      const note = await vault.read(path);
      const { setFields } = await import('../../notes/notefile');
      const text = setFields(note.text, {
        uni: row.name,
        country: row.country ?? null,
        openalex_id: row.id,
        link: row.homepage ?? null,
        source: `https://openalex.org/works?filter=title_and_abstract.search:${encodeURIComponent(topic)}`,
        checked: new Date().toISOString().slice(0, 10),
        status: 'considering',
      });
      const written = await vault.write(path, text, note.text);
      saved(written.path, written.text);
      toast(`${row.name} is on the list — fill in the programme and its deadlines.`);
      onOpenNote(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, ''));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(null);
    }
  };

  const toggleCountry = (code: string) => setCountries((cs) => (cs.includes(code) ? cs.filter((c) => c !== code) : [...cs, code]));

  if (!canResearch) {
    return (
      <div className="prj-dash__empty">
        <h3>Discover needs the desktop app</h3>
        <p>The dev server has no bridge to the internet. Open Axonix itself and this looks up who publishes on your topics.</p>
      </div>
    );
  }

  return (
    <section className="dsc" aria-label="Discover universities">
      <header className="dsc__bar">
        <label className="tsk-search dsc__topic">
          <Search size={13} strokeWidth={1.9} aria-hidden="true" />
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void look();
            }}
            placeholder="rocket propulsion · composite materials"
            aria-label="Topic to look for"
            spellCheck={false}
          />
        </label>
        <button type="button" className="fin-pill fin-pill--action fin-pill--sm" onClick={() => void look()} disabled={busy}>
          <Telescope size={13} strokeWidth={2} />
          {busy ? 'Looking…' : 'Look'}
        </button>
        <div className="dsc__countries" role="group" aria-label="Countries">
          {COUNTRIES.map((c) => (
            <button type="button" key={c.code} data-active={countries.includes(c.code) || undefined} onClick={() => toggleCountry(c.code)}>
              {c.code}
            </button>
          ))}
          {countries.length > 0 && (
            <button type="button" className="dsc__clear" onClick={() => setCountries([])}>
              Anywhere
            </button>
          )}
        </div>
      </header>

      {profile.topics.length > 1 && (
        <div className="dsc__hints">
          <span>Your topics</span>
          {profile.topics.map((t) => (
            <button type="button" key={t} onClick={() => setTopic(t)} data-active={t === topic || undefined}>
              {t}
            </button>
          ))}
        </div>
      )}

      {rows === null ? (
        <p className="fin-hint dsc__idle">Ask for a topic. Axonix counts what each university has published on it since {SINCE} and shows the ones actually working on it.</p>
      ) : rows.length === 0 ? (
        <p className="fin-hint dsc__idle">Nothing came back for that. Try broader words, or clear the country filter.</p>
      ) : (
        <ol className="dsc__list">
          {rows.map((r) => {
            const known = have.has(r.name.toLowerCase());
            return (
              <li key={r.id}>
                <span className="dsc__rank fin-num">{r.works}</span>
                <span className="dsc__who">
                  <strong>{r.name}</strong>
                  <em>
                    {r.country ? (COUNTRY_NAME[r.country] ?? r.country) : 'Unknown country'} · papers on “{topic}” since {SINCE}
                  </em>
                </span>
                {r.homepage && (
                  <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => vault.openUrl(r.homepage!)} aria-label={`Open ${r.name}`} title={r.homepage}>
                    <ExternalLink size={12} strokeWidth={1.9} />
                  </button>
                )}
                <button type="button" className="fin-pill fin-pill--sm" disabled={known || adding === r.id} onClick={() => void shortlist(r)}>
                  <Plus size={12} strokeWidth={2.2} />
                  {known ? 'On the list' : adding === r.id ? 'Adding…' : 'Shortlist'}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="sch__foot">Counts are papers, not teaching. They say who is active in the field — the programme, its fees and its deadline still come off the university's own page.</p>
    </section>
  );
}
