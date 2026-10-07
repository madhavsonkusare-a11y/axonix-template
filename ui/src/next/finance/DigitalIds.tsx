/**
 * Digital IDs, second version — the numbers to hand, and what needs renewing.
 *
 * Still not a DigiLocker integration (its API is for onboarded organisations),
 * still masked until asked, still a 20-second reveal.
 *
 * What changed from the first Digital IDs, and why:
 * - Renewals come first. A licence five months from expiry was one chip among
 *   many; now anything that lapses is listed by date, with how long is left.
 * - Opening a card no longer drops straight into the editor: the card's own
 *   buttons show and copy, and Edit is a button like them.
 * - Documents not added yet are a row of small "add" chips. As full-size ghost
 *   cards they filled half the page with things that are not there.
 * - The DigiLocker explanation moved to the side: it is read once.
 */
import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useFinance } from '../../finance/FinanceContext';
import { useFinanceUi } from '../../finance/ui';
import type { DigitalId } from '../../finance/types';
import { ID_META, ID_ORDER, cleanId, formatId, maskId } from '../../finance/ids';
import { dayLabel, daysBetween, shortDate, spanLabel } from '../../finance/format';
import { idThing, liftAttrs } from '../lift/things';
import { useDay } from '../scrub/Scrub';
import { BrandMark } from '../../finance/components/BrandMark';
import { openExternal } from '../../finance/external';
import { Meter } from '../charts';

type Tone = 'ok' | 'soon' | 'gone';

function expiry(doc: DigitalId, today: string): { label: string; tone: Tone; left: number } | null {
  if (!doc.expiresOn) return null;
  const left = daysBetween(today, doc.expiresOn);
  if (left < 0) return { label: `Expired ${spanLabel(left)} ago`, tone: 'gone', left };
  if (left <= 180) return { label: `Renew · ${spanLabel(left)} left`, tone: 'soon', left };
  return { label: `Valid ${spanLabel(left)}`, tone: 'ok', left };
}

function IdCard({ doc }: { doc: DigitalId }) {
  const ui = useFinanceUi();
  const [shown, setShown] = useState(false);
  const meta = ID_META[doc.type];
  const exp = expiry(doc, useDay());

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), 20_000);
    return () => clearTimeout(t);
  }, [shown]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(doc.type === 'other' ? doc.number : cleanId(doc.number));
      toast(`${doc.label} number copied`);
    } catch {
      toast.error('The clipboard is not available here.');
    }
  };

  return (
    <article className="nxf-id" data-tone={exp?.tone} {...liftAttrs(idThing(doc), { hold: true })}>
      <div className="nxf-id__top">
        <BrandMark brand={meta.brand} size={32} />
        <div className="nxf-id__title">
          <span>{doc.label}</span>
          {doc.holder && <span>{doc.holder}</span>}
        </div>
        {doc.inDigiLocker && (
          <span className="nxf-id__locker" title="A verified copy is in DigiLocker">
            <BrandMark brand="digilocker" size={14} />
            DigiLocker
          </span>
        )}
      </div>

      <button type="button" className="nxf-id__number fin-num" onClick={copy} title="Copy the number" data-shown={shown || undefined}>
        {shown ? (doc.type === 'other' ? doc.number : formatId(doc.type, doc.number)) : maskId(doc.type, doc.number)}
      </button>

      <div className="nxf-id__foot">
        {exp ? <span className={`nxf-chip nxf-id__chip--${exp.tone}`}>{exp.label}</span> : <span className="nxf-chip nxf-id__chip">{doc.issuedOn ? `Issued ${shortDate(doc.issuedOn)}` : 'No expiry'}</span>}
        <span className="nxf-id__space" />
        <button type="button" className="nx-iconbtn" onClick={() => setShown((s) => !s)} aria-label={shown ? `Hide ${doc.label} number` : `Show ${doc.label} number`} title={shown ? 'Hide' : 'Show for 20 seconds'}>
          {shown ? <EyeOff size={15} strokeWidth={1.7} /> : <Eye size={15} strokeWidth={1.7} />}
        </button>
        <button type="button" className="nx-iconbtn" onClick={copy} aria-label={`Copy ${doc.label} number`} title="Copy">
          <Copy size={15} strokeWidth={1.7} />
        </button>
        <button type="button" className="nx-iconbtn" onClick={() => ui.editId({ id: doc.id })} aria-label={`Edit ${doc.label}`} title="Edit">
          <Pencil size={15} strokeWidth={1.7} />
        </button>
      </div>
    </article>
  );
}

/** Everything with an end date, soonest first. */
function Renewals({ ids }: { ids: DigitalId[] }) {
  const ui = useFinanceUi();
  const today = useDay();
  const dated = ids
    .filter((d) => d.expiresOn)
    .map((d) => ({ d, exp: expiry(d, today)! }))
    .sort((a, b) => a.exp.left - b.exp.left);

  return (
    <section className="nxf-card">
      <div className="nxf-card__head">
        <h3>Renewals</h3>
        {dated.some((x) => x.exp.tone !== 'ok') && <span className="nxf-chip nxf-chip--att fin-num">{dated.filter((x) => x.exp.tone !== 'ok').length}</span>}
      </div>
      {dated.length === 0 ? (
        <p className="fin-empty__text">Nothing here has an expiry date. A licence or passport shows up once it is added with one.</p>
      ) : (
        <div className="nxf-renewals">
          {dated.map(({ d, exp }) => {
            // The bar is the document's life used up, when its issue date is known.
            const life = d.issuedOn && d.expiresOn ? daysBetween(d.issuedOn, d.expiresOn) : 0;
            const used = life > 0 ? daysBetween(d.issuedOn!, today) : 0;
            return (
              <button type="button" className="nxf-renewal" key={d.id} data-tone={exp.tone} onClick={() => ui.editId({ id: d.id })}>
                <span className="nxf-renewal__head">
                  <span>{d.label}</span>
                  <span className="fin-num">{exp.left < 0 ? `${spanLabel(exp.left)} ago` : `${spanLabel(exp.left)} left`}</span>
                </span>
                {life > 0 && <Meter value={Math.min(used, life)} limit={life} />}
                <small>
                  {exp.left < 0 ? 'Expired' : 'Expires'} {dayLabel(d.expiresOn!, today)}
                </small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function DigitalIds() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const today = useDay();
  const have = new Set(data.ids.map((d) => d.type));
  const missing = ID_ORDER.filter((t) => t !== 'other' && !have.has(t));
  const ids = [...data.ids].sort((a, b) => ID_ORDER.indexOf(a.type) - ID_ORDER.indexOf(b.type));
  const expiring = data.ids.filter((d) => d.expiresOn && expiry(d, today)?.tone !== 'ok').length;

  return (
    // Nothing on this page is read off the screen when it is lifted: a number could be showing.
    <div className="nxf-page" data-lift-private="">
      <header className="nxf-head">
        <div>
          <h2>Digital IDs</h2>
          <p>
            {ids.length ? `${ids.length} ${ids.length === 1 ? 'document' : 'documents'}` : 'No documents yet'} · kept on this laptop, masked until you ask
            {expiring > 0 && (
              <>
                {' · '}
                <span className="nxf-att">{expiring} to renew</span>
              </>
            )}
          </p>
        </div>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => ui.editId({})}>
          Add ID
        </button>
      </header>

      <div className="nxf-grid">
        <div className="nxf-span-8 nxf-idcol">
          {ids.length === 0 ? (
            <section className="nxf-card">
              <div className="fin-empty fin-empty--tall">
                <p className="fin-empty__text">Keep your Aadhaar, PAN, licence and passport numbers here, one tap from being copied.</p>
                <button type="button" className="fin-pill fin-pill--sm" onClick={() => ui.editId({})}>
                  Add the first one
                </button>
              </div>
            </section>
          ) : (
            <div className="nxf-ids">
              {ids.map((d) => (
                <IdCard key={d.id} doc={d} />
              ))}
            </div>
          )}

          {missing.length > 0 && (
            <div className="nxf-missing">
              <span className="nxf-label">Not added yet</span>
              {missing.map((t) => (
                <button key={t} type="button" className="nxf-missing__add" onClick={() => ui.editId({ type: t })}>
                  <BrandMark brand={ID_META[t].brand} size={18} />
                  {ID_META[t].label}
                  <Plus size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="nxf-span-4 nxf-stack">
          <Renewals ids={ids} />
          <section className="nxf-card nxf-locker">
            <div className="nxf-locker__top">
              <BrandMark brand="digilocker" size={30} />
              <h3>DigiLocker holds the verified copies</h3>
            </div>
            <p className="nxf-note">
              Its API is issued only to registered organisations, so Axonix cannot sign in for you. Keep the numbers here for quick copying; the documents in DigiLocker are the ones that
              are legally valid.
            </p>
            <button
              type="button"
              className="nxf-source"
              onClick={() => void openExternal('https://www.digilocker.gov.in/').catch((e) => toast.error(`Could not open DigiLocker: ${String(e)}`))}
              title="Open DigiLocker in your browser"
            >
              <span>
                <span>
                  <ShieldCheck size={13} strokeWidth={1.8} aria-hidden="true" /> digilocker.gov.in
                </span>
              </span>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
