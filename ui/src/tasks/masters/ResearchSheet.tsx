/**
 * Where Axonix is allowed to look things up, and the two keys it needs.
 *
 * The keys are the owner's own — made once, free, on the provider's site — and
 * they live in Windows Credential Manager, never in a file. This sheet only
 * ever says whether one is set.
 */
import { useEffect, useState } from 'react';
import { Check, ExternalLink, TriangleAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Sheet, { Field, SheetFooter } from '../../finance/components/Sheet';
import { vault } from '../../notes/backend';
import { canResearch, research, type KeyState } from './research';

const SOURCES = [
  { name: 'OpenAlex', what: 'Researchers, labs and what they publish on — how advisors are found', terms: 'CC0 data; a free key since Feb 2026', link: 'https://openalex.org/' },
  { name: 'College Scorecard', what: 'US institutions and fields of study: cost, completion, earnings', terms: 'US public domain; free key from api.data.gov', link: 'https://collegescorecard.ed.gov/data/api/' },
  { name: 'ROR', what: 'One canonical id per institution, to join the sources on', terms: 'CC0, no key', link: 'https://ror.org/' },
  { name: 'Universities list', what: 'University names, countries and domains, for autocomplete', terms: 'MIT', link: 'https://github.com/Hipo/university-domains-list' },
  { name: 'Frankfurter', what: 'Daily reference rates, to show a fee in rupees', terms: 'Open, no key', link: 'https://frankfurter.app/' },
  { name: 'A page you paste', what: 'One page, once, after its robots.txt says yes', terms: 'No crawling, nothing behind a login', link: '' },
];

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export default function ResearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [keys, setKeys] = useState<KeyState>({ openalex: false, scorecard: false });
  const [typed, setTyped] = useState<{ openalex: string; scorecard: string }>({ openalex: '', scorecard: '' });
  const [cache, setCache] = useState<{ files: number; bytes: number }>({ files: 0, bytes: 0 });
  const [tested, setTested] = useState<Record<string, string>>({});

  /**
   * Proving a key works without anyone reading it back: one real call through
   * the main process, which is the only place the key is ever handled.
   */
  const test = async (name: 'openalex' | 'scorecard') => {
    setTested((t) => ({ ...t, [name]: 'Asking…' }));
    try {
      if (name === 'openalex') {
        const r = (await research.openalex('institutions', { search: 'Delft University of Technology', per_page: '1' })) as { results?: { display_name?: string }[] };
        setTested((t) => ({ ...t, openalex: r.results?.[0]?.display_name ? `Works — found ${r.results[0].display_name}` : 'Answered, but found nothing' }));
      } else {
        const r = (await research.scorecard({ 'school.name': 'Purdue', fields: 'id,school.name', per_page: '1' })) as { results?: { 'school.name'?: string }[] };
        setTested((t) => ({ ...t, scorecard: r.results?.[0]?.['school.name'] ? `Works — found ${r.results[0]['school.name']}` : 'Answered, but found nothing' }));
      }
    } catch (e) {
      setTested((t) => ({ ...t, [name]: e instanceof Error ? e.message : String(e) }));
    }
  };

  useEffect(() => {
    if (!open || !canResearch) return;
    void research.keys().then(setKeys).catch(() => undefined);
    void research.cache().then(setCache).catch(() => undefined);
  }, [open]);

  const save = async (name: 'openalex' | 'scorecard') => {
    try {
      setKeys(await research.setKey(name, typed[name]));
      setTyped((t) => ({ ...t, [name]: '' }));
      toast(typed[name].trim() ? 'Key saved to Windows Credential Manager.' : 'Key removed.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Research sources" subtitle="What Axonix may look up, and with whose key" width={640}>
      <div className="nts-prop">
        {!canResearch && <p className="fin-error">Looking things up needs the desktop app; the dev server has no bridge to the internet.</p>}

        <section className="nts-prop__group">
          <h3>Your keys</h3>
          <p className="fin-hint">Both are free and take a minute. They are stored the way your passwords are, and Axonix never shows them again.</p>
          <div className="nts-prop__fields">
            <Field label="OpenAlex" hint={keys.openalex ? 'Set' : 'Not set — advisor search will be rate-limited without it'}>
              <div className="nts-prop__row">
                <input className="fin-input fin-input--sm" type="password" value={typed.openalex} onChange={(e) => setTyped((t) => ({ ...t, openalex: e.target.value }))} placeholder={keys.openalex ? '••••••••' : 'Paste the key'} autoComplete="off" />
                <button type="button" className="fin-pill fin-pill--sm" onClick={() => void save('openalex')} disabled={!canResearch}>
                  <Check size={12} strokeWidth={2.4} />
                  Save
                </button>
                <button type="button" className="fin-pill fin-pill--sm" onClick={() => void test('openalex')} disabled={!canResearch}>
                  Test
                </button>
              </div>
              {tested.openalex && <p className="fin-hint rsc-test" data-bad={/works/i.test(tested.openalex) ? undefined : true}>{!/works/i.test(tested.openalex) && <TriangleAlert size={11} strokeWidth={2.2} />}{tested.openalex}</p>}
            </Field>
            <Field label="College Scorecard" hint={keys.scorecard ? 'Set' : 'Not set — US cost and outcome data stays unavailable'}>
              <div className="nts-prop__row">
                <input className="fin-input fin-input--sm" type="password" value={typed.scorecard} onChange={(e) => setTyped((t) => ({ ...t, scorecard: e.target.value }))} placeholder={keys.scorecard ? '••••••••' : 'Paste the key'} autoComplete="off" />
                <button type="button" className="fin-pill fin-pill--sm" onClick={() => void save('scorecard')} disabled={!canResearch}>
                  <Check size={12} strokeWidth={2.4} />
                  Save
                </button>
                <button type="button" className="fin-pill fin-pill--sm" onClick={() => void test('scorecard')} disabled={!canResearch}>
                  Test
                </button>
              </div>
              {tested.scorecard && <p className="fin-hint rsc-test" data-bad={/works/i.test(tested.scorecard) ? undefined : true}>{!/works/i.test(tested.scorecard) && <TriangleAlert size={11} strokeWidth={2.2} />}{tested.scorecard}</p>}
            </Field>
          </div>
        </section>

        <section className="nts-prop__group">
          <h3>Where it may look</h3>
          <ul className="rsc-list">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <div>
                  <strong>{s.name}</strong>
                  <p>{s.what}</p>
                  <em>{s.terms}</em>
                </div>
                {s.link && (
                  <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => vault.openUrl(s.link)} aria-label={`Open ${s.name}`} title={s.link}>
                    <ExternalLink size={12} strokeWidth={1.9} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="fin-hint">Nothing else is fetched, whatever asks. One request at a time, a second apart, each cached so the pages work offline.</p>
        </section>

        <section className="nts-prop__group">
          <h3>What has been kept</h3>
          <div className="nts-prop__row">
            <span className="fin-hint">
              {cache.files} answers cached · <span className="fin-num">{size(cache.bytes)}</span>
            </span>
            <button
              type="button"
              className="fin-pill fin-pill--sm"
              disabled={!canResearch || cache.files === 0}
              onClick={() => void research.cache('clear').then(setCache).then(() => toast('Cache emptied.'))}
            >
              <Trash2 size={12} strokeWidth={2} />
              Empty it
            </button>
          </div>
        </section>
      </div>

      <SheetFooter>
        <span className="fin-spacer" />
        <button type="button" className="fin-pill" onClick={onClose}>
          Close
        </button>
      </SheetFooter>
    </Sheet>
  );
}
