/**
 * Add / edit a digital ID.
 */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import Sheet, { Field, SheetFooter, useUnsavedChanges } from './Sheet';
import { BrandMark } from './BrandMark';
import { DateField } from './DatePicker';
import { newId, useFinance } from '../FinanceContext';
import type { DigitalId, IdType } from '../types';
import { ID_META, ID_ORDER, cleanId, formatId, isValidId } from '../ids';
import { todayIso } from '../format';

export default function IdSheet({ target, onClose }: { target: { id?: string; type?: IdType } | null; onClose: () => void }) {
  const { data } = useFinance();
  const existing = target?.id ? data.ids.find((d) => d.id === target.id) : undefined;
  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      width={540}
      title={existing ? existing.label : 'Add an ID'}
      subtitle="Stored on this laptop only. Numbers stay masked until you ask."
    >
      {target && <IdForm existing={existing} initialType={target.type} onClose={onClose} />}
    </Sheet>
  );
}

function IdForm({ existing, initialType, onClose }: { existing?: DigitalId; initialType?: IdType; onClose: () => void }) {
  const { dispatch, undo } = useFinance();
  const [doc, setDoc] = useState<DigitalId>(
    () => existing ?? { id: newId('id'), type: initialType ?? 'aadhaar', label: ID_META[initialType ?? 'aadhaar'].label, number: '' },
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const untouched = useRef(JSON.stringify(doc));
  const requestClose = useUnsavedChanges(JSON.stringify(doc) !== untouched.current);
  const meta = ID_META[doc.type];
  const set = (patch: Partial<DigitalId>) => {
    setError(null);
    setDoc((d) => ({ ...d, ...patch }));
  };
  const valid = !doc.number || isValidId(doc.type, doc.number);

  const save = () => {
    if (!doc.number.trim()) return setError('Enter the number.');
    if (!isValidId(doc.type, doc.number)) return setError(`That does not look like a ${meta.label} number — expected ${meta.hint}.`);
    const clean: DigitalId = { ...doc, number: doc.type === 'other' ? doc.number.trim() : cleanId(doc.number), label: doc.label.trim() || meta.label };
    const change = dispatch({ type: 'SAVE_ID', doc: clean });
    toast(existing ? `Saved ${clean.label}` : `Added ${clean.label}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    const change = dispatch({ type: 'DELETE_ID', id: existing.id });
    toast(`Removed ${existing.label}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    onClose();
  };

  return (
    <div className="fin-form" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save()}>
      {!existing && (
        <Field label="Document">
          <div className="fin-cats">
            {ID_ORDER.map((t) => (
              <button key={t} type="button" className="fin-cat fin-cat--brand" aria-pressed={doc.type === t} onClick={() => set({ type: t, label: ID_META[t].label })}>
                <BrandMark brand={ID_META[t].brand} size={18} />
                {ID_META[t].label}
              </button>
            ))}
          </div>
        </Field>
      )}

      {doc.type === 'other' && (
        <Field label="Name">
          <input className="fin-input" value={doc.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Company ID" />
        </Field>
      )}

      <Field label="Number" hint={meta.hint}>
        <div className="fin-input fin-input--affix" data-invalid={!valid}>
          <BrandMark brand={meta.brand} size={22} />
          <input
            className="fin-num fin-idinput"
            value={doc.type === 'other' ? doc.number : formatId(doc.type, doc.number)}
            onChange={(e) => set({ number: e.target.value })}
            placeholder={meta.placeholder}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            aria-label={`${meta.label} number`}
          />
        </div>
      </Field>

      <Field label="Name on the document" hint="Optional">
        <input className="fin-input" value={doc.holder ?? ''} onChange={(e) => set({ holder: e.target.value || undefined })} placeholder="As printed" />
      </Field>

      {meta.expires && (
        <div className="fin-form__grid">
          <Field label="Issued" hint="Optional">
            <DateField label="Issued" value={doc.issuedOn} max={todayIso()} clearable placeholder="Not set" onChange={(issuedOn) => set({ issuedOn })} />
          </Field>
          <Field label="Valid until">
            <DateField label="Valid until" value={doc.expiresOn} min={doc.issuedOn} clearable placeholder="Not set" onChange={(expiresOn) => set({ expiresOn })} />
          </Field>
        </div>
      )}

      <label className="fin-toggle">
        <input type="checkbox" checked={!!doc.inDigiLocker} onChange={(e) => set({ inDigiLocker: e.target.checked })} />
        <span className="fin-toggle__track" aria-hidden="true" />
        <BrandMark brand="digilocker" size={20} />
        <span>A verified copy is in my DigiLocker</span>
      </label>

      {error && <p className="fin-error" role="alert">{error}</p>}

      <SheetFooter>
        {existing &&
          (confirm ? (
            <span className="fin-confirm">
              Remove this ID?
              <button type="button" className="fin-link fin-link--danger" onClick={remove}>Remove</button>
              <button type="button" className="fin-link" onClick={() => setConfirm(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="fin-link fin-link--danger" onClick={() => setConfirm(true)}>
              Remove
            </button>
          ))}
        <span className="fin-spacer" />
        <button type="button" className="fin-pill" onClick={(e) => requestClose(e.currentTarget)}>Cancel</button>
        <button type="button" className="fin-pill fin-pill--action" onClick={save}>{existing ? 'Save' : 'Add ID'}</button>
      </SheetFooter>
    </div>
  );
}
