/**
 * Digital IDs — Aadhaar, PAN, licence, passport and the rest, one tap from
 * being copied.
 *
 * Why this is not a DigiLocker integration: DigiLocker's Requester API is
 * issued only to organisations onboarded through API Setu (identity + purpose
 * checks), so a personal app cannot sign in to it on the owner's behalf. The
 * useful part for daily life — having the numbers to hand — does not need it;
 * the legally valid copies stay in DigiLocker, and each card says whether one
 * is there. The research note has the full trade-off.
 *
 * Numbers are masked by default and reveal for 20 seconds at a time.
 */
import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useFinance } from '../FinanceContext';
import { useFinanceUi } from '../ui';
import type { DigitalId } from '../types';
import { ID_META, ID_ORDER, cleanId, formatId, maskId } from '../ids';
import { daysBetween, shortDate, spanLabel, todayIso } from '../format';
import { BrandMark } from '../components/BrandMark';
import { openExternal } from '../external';

function expiry(doc: DigitalId, today: string): { label: string; tone: 'ok' | 'soon' | 'gone' } | null {
  if (!doc.expiresOn) return null;
  const left = daysBetween(today, doc.expiresOn);
  if (left < 0) return { label: `Expired ${spanLabel(left)} ago`, tone: 'gone' };
  if (left <= 180) return { label: `Renew · ${spanLabel(left)} left`, tone: 'soon' };
  return { label: `Valid ${spanLabel(left)}`, tone: 'ok' };
}

function IdCard({ doc }: { doc: DigitalId }) {
  const ui = useFinanceUi();
  const [shown, setShown] = useState(false);
  const meta = ID_META[doc.type];
  const exp = expiry(doc, todayIso());

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
    <article className="fin-idcard" data-tone={exp?.tone}>
      <button type="button" className="fin-idcard__open" onClick={() => ui.editId({ id: doc.id })} aria-label={`Edit ${doc.label}`} />
      <div className="fin-idcard__top">
        <BrandMark brand={meta.brand} size={34} />
        <div className="fin-idcard__title">
          <span>{doc.label}</span>
          {doc.holder && <span>{doc.holder}</span>}
        </div>
        {doc.inDigiLocker && (
          <span className="fin-idcard__locker" title="A verified copy is in DigiLocker">
            <BrandMark brand="digilocker" size={16} />
            In DigiLocker
          </span>
        )}
      </div>

      <div className="fin-idcard__number fin-num">{shown ? (doc.type === 'other' ? doc.number : formatId(doc.type, doc.number)) : maskId(doc.type, doc.number)}</div>

      <div className="fin-idcard__foot">
        {exp ? (
          <span className={`fin-idchip fin-idchip--${exp.tone}`}>{exp.label}</span>
        ) : doc.issuedOn ? (
          <span className="fin-idchip">Issued {shortDate(doc.issuedOn)}</span>
        ) : (
          <span className="fin-idchip">No expiry</span>
        )}
        <span className="fin-spacer" />
        <button type="button" className="fin-icon-btn" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide number' : 'Show number'} title={shown ? 'Hide' : 'Show for 20 seconds'}>
          {shown ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
        </button>
        <button type="button" className="fin-icon-btn" onClick={copy} aria-label="Copy number" title="Copy">
          <Copy size={14} strokeWidth={1.8} />
        </button>
      </div>
    </article>
  );
}

export default function DigitalIds() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const have = new Set(data.ids.map((d) => d.type));
  const missing = ID_ORDER.filter((t) => t !== 'other' && !have.has(t));
  const ids = [...data.ids].sort((a, b) => ID_ORDER.indexOf(a.type) - ID_ORDER.indexOf(b.type));
  const expiring = data.ids.filter((d) => expiry(d, todayIso())?.tone !== 'ok' && d.expiresOn).length;

  return (
    <div className="fin-page">
      <header className="fin-page__head">
        <div className="fin-page__lead">
          <h2>Digital IDs</h2>
          <p>
            {ids.length ? `${ids.length} ${ids.length === 1 ? 'document' : 'documents'}` : 'No documents yet'} · kept on this laptop, masked until you ask
            {expiring > 0 && ` · ${expiring} to renew`}
          </p>
        </div>
        <div className="fin-page__actions">
          <button type="button" className="fin-pill fin-pill--action" onClick={() => ui.editId({})}>
            Add ID
          </button>
        </div>
      </header>

      <div className="fin-locker">
        <BrandMark brand="digilocker" size={40} />
        <div className="fin-locker__text">
          <strong>DigiLocker holds the verified copies</strong>
          <span>
            Its API is issued only to registered organisations, so Axonix cannot sign in for you. Keep the numbers here for quick copying; the documents in
            DigiLocker are the ones that are legally valid.
          </span>
        </div>
        <button
          type="button"
          className="fin-locker__url fin-num"
          onClick={() => void openExternal('https://www.digilocker.gov.in/').catch((e) => toast.error(`Could not open DigiLocker: ${String(e)}`))}
          title="Open DigiLocker in your browser"
        >
          <ShieldCheck size={13} strokeWidth={1.8} aria-hidden="true" />
          digilocker.gov.in
        </button>
      </div>

      <div className="fin-ids">
        {ids.map((d) => (
          <IdCard key={d.id} doc={d} />
        ))}
        {missing.map((t) => (
          <button key={t} type="button" className="fin-idcard fin-idcard--ghost" onClick={() => ui.editId({ type: t })}>
            <BrandMark brand={ID_META[t].brand} size={30} />
            <span>
              <Plus size={13} strokeWidth={2} /> {ID_META[t].label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
