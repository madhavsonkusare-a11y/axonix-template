/**
 * Add / edit an account or a payment method — two small forms behind one sheet.
 *
 * The balance field writes a checkpoint rather than overwriting a stored
 * number (see the model notes in `types.ts`), so it is safe to correct a
 * balance at any time without disturbing history.
 */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import Sheet, { Field, SheetFooter, useUnsavedChanges } from './Sheet';
import { BrandMark } from './BrandMark';
import { LiquidSegment } from './Liquid';
import { PopUpButton } from './Menu';
import { newId, useFinance } from '../FinanceContext';
import type { Account, AccountKind, BrandId, CardInfo, Hue, MethodKind, PaymentMethod } from '../types';
import { ACCOUNT_BRANDS, BRANDS, METHOD_BRANDS } from '../brands';
import { KIND_LABEL, balanceOf, needsBalance } from '../ledger';
import { CURRENCIES, currencySymbol, moneyIn, todayIso } from '../format';

export type AccountTarget = { type: 'account'; id?: string } | { type: 'method'; id?: string; accountId?: string };

export default function AccountSheet({ target, onClose }: { target: AccountTarget | null; onClose: () => void }) {
  const { data } = useFinance();
  const isMethod = target?.type === 'method';
  const exists = target?.id
    ? isMethod
      ? data.methods.some((m) => m.id === target.id)
      : data.accounts.some((a) => a.id === target.id)
    : false;

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      width={560}
      title={isMethod ? (exists ? 'Payment method' : 'Add a payment method') : exists ? 'Account' : 'Add an account'}
      subtitle={
        isMethod
          ? 'UPI apps, cards and wallets move money out of an account.'
          : 'Somewhere money sits — a bank, a demat, a forex card.'
      }
    >
      {target?.type === 'account' && <AccountForm id={target.id} onClose={onClose} />}
      {target?.type === 'method' && <MethodForm id={target.id} accountId={target.accountId} onClose={onClose} />}
    </Sheet>
  );
}

const KINDS: AccountKind[] = ['savings', 'salary', 'current', 'demat', 'provident', 'gold', 'deposit', 'forex', 'wallet', 'cash', 'credit', 'loan'];
const HUES: (Hue | 'none')[] = ['none', 'blue', 'violet', 'green', 'amber'];
/** What each swatch is called. `violet` is drawn light blue (no purple in Axonix), and says so. */
const HUE_NAME: Record<Hue | 'none', string> = { none: 'No card colour', blue: 'Blue', violet: 'Light blue', green: 'Green', amber: 'Amber' };
const NETWORKS: NonNullable<CardInfo['network']>[] = ['rupay', 'visa', 'mastercard'];

function BrandPicker({ brands, value, onChange }: { brands: BrandId[]; value?: BrandId; onChange: (b?: BrandId) => void }) {
  return (
    <div className="fin-brandpick" role="radiogroup">
      {brands.map((b) => (
        <button key={b} type="button" role="radio" aria-checked={value === b} onClick={() => onChange(value === b ? undefined : b)} title={BRANDS[b].name}>
          <BrandMark brand={b} size={30} />
        </button>
      ))}
    </div>
  );
}

function AccountForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const { data, dispatch, undo } = useFinance();
  const existing = id ? data.accounts.find((a) => a.id === id) : undefined;
  const current = existing ? balanceOf(data, existing.id) : 0;
  const unset = !existing || needsBalance(data, existing);

  const [a, setA] = useState<Account>(
    () => existing ?? { id: newId('acct'), name: '', kind: 'savings', currency: 'INR', createdAt: todayIso() },
  );
  const [balance, setBalance] = useState(unset ? '' : String(Math.round(current * 100) / 100));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const untouched = useRef(JSON.stringify([a, balance]));
  const requestClose = useUnsavedChanges(JSON.stringify([a, balance]) !== untouched.current);
  const set = (patch: Partial<Account>) => {
    setError(null);
    setA((x) => ({ ...x, ...patch }));
  };

  const hasCard = !!a.card;
  // Anything that hangs off the account makes it "used", and a used account is
  // archived rather than deleted. Balance checkpoints used to be ignored here,
  // so an account with only a balance was deleted for good — taking its
  // balance history and every payment method that debits it with it.
  const used = existing
    ? data.transactions.some((t) => t.accountId === existing.id || t.toAccountId === existing.id) ||
      data.methods.some((m) => m.accountId === existing.id) ||
      data.accounts.some((a) => a.si?.fromAccountId === existing.id)
    : false;

  const save = () => {
    if (!a.name.trim()) return setError('Give the account a name.');
    if (a.currency !== 'INR' && !a.fxRate) return setError(`Enter today's rate — rupees per 1 ${a.currency} — so it counts toward net worth.`);
    const parsed = balance.trim() === '' ? undefined : Number(balance.replace(/,/g, ''));
    if (parsed !== undefined && Number.isNaN(parsed)) return setError('The balance is not a number.');
    const change = dispatch({ type: 'SAVE_ACCOUNT', account: { ...a, name: a.name.trim() }, balance: parsed });
    toast(existing ? `Saved ${a.name}` : `Added ${a.name}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    const change = used
      ? dispatch({ type: 'SAVE_ACCOUNT', account: { ...existing, archived: !existing.archived } })
      : dispatch({ type: 'DELETE_ACCOUNT', id: existing.id });
    toast(used ? (existing.archived ? `Restored ${existing.name}` : `Archived ${existing.name}`) : `Deleted ${existing.name}`, {
      action: { label: 'Undo', onClick: () => undo(change) },
    });
    onClose();
  };

  return (
    <div className="fin-form" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save()}>
      <div className="fin-form__ident">
        <BrandMark brand={a.brand} fallback={a.name || 'New'} size={44} />
        <input className="fin-input fin-input--title" value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Account name" autoFocus={!existing} aria-label="Account name" />
      </div>

      <Field label="Institution">
        <BrandPicker
          brands={ACCOUNT_BRANDS}
          value={a.brand}
          // A NEW account picked as EPF is a provident fund; an existing account's type is never changed for it.
          onChange={(brand) => set(brand === 'epfo' && !existing ? { brand, kind: 'provident', name: a.name || 'EPF' } : { brand })}
        />
      </Field>

      <Field label="Type">
        <div className="fin-cats">
          {KINDS.map((k) => (
            <button key={k} type="button" className="fin-cat" aria-pressed={a.kind === k} onClick={() => set({ kind: k })}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </Field>

      <div className="fin-form__grid">
        <Field label="Balance today" hint={unset ? 'As your bank app shows it now' : `now ${moneyIn(current, a.currency)}`}>
          <div className="fin-input fin-input--affix">
            <span className="fin-num">{currencySymbol(a.currency).trim()}</span>
            <input className="fin-num" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value.replace(/[^\d.,-]/g, ''))} placeholder="0" aria-label="Balance" />
          </div>
        </Field>
        <Field label="Currency">
          <PopUpButton
            className="fin-popup--field"
            label="Currency"
            value={a.currency}
            onChange={(currency) => set({ currency, fxRate: currency === 'INR' ? undefined : a.fxRate })}
            options={CURRENCIES.map((c) => ({ value: c, label: `${c} · ${currencySymbol(c).trim()}` }))}
          />
        </Field>
      </div>

      {a.currency !== 'INR' && (
        <Field label={`Rate`} hint="Typed by hand — there is no live rate feed">
          <div className="fin-input fin-input--affix">
            <span className="fin-num">₹</span>
            <input className="fin-num" inputMode="decimal" value={a.fxRate ?? ''} onChange={(e) => set({ fxRate: Number(e.target.value.replace(/[^\d.]/g, '')) || undefined })} placeholder="84.60" aria-label="Rupees per unit" />
            <span className="fin-input__suffix">per 1 {a.currency}</span>
          </div>
        </Field>
      )}

      <Field label="Card" hint={hasCard ? undefined : 'None'}>
        <div className="fin-cardrow">
          <LiquidSegment
            label="Card type"
            mono={false}
            value={a.card?.type ?? 'none'}
            options={[
              { value: 'none', label: 'No card' },
              { value: 'debit', label: 'Debit' },
              { value: 'credit', label: 'Credit' },
              { value: 'forex', label: 'Forex' },
            ]}
            onChange={(v) => set({ card: v === 'none' ? undefined : { ...a.card, type: v } })}
          />
          {hasCard && (
            <>
              <div className="fin-brandpick fin-brandpick--sm" role="radiogroup" aria-label="Card network">
                {NETWORKS.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={a.card?.network === n} onClick={() => set({ card: { ...a.card!, network: a.card?.network === n ? undefined : n } })} title={BRANDS[n].name}>
                    <BrandMark brand={n} size={26} />
                  </button>
                ))}
              </div>
              <input className="fin-input fin-input--last4 fin-num" value={a.card?.last4 ?? ''} maxLength={4} inputMode="numeric" onChange={(e) => set({ card: { ...a.card!, last4: e.target.value.replace(/\D/g, '') || undefined } })} placeholder="Last 4" aria-label="Card last four digits" />
            </>
          )}
        </div>
      </Field>

      <Field label="Show as a wallet card">
        <div className="fin-huepick" role="radiogroup">
          {HUES.map((h) => (
            <button key={h} type="button" role="radio" aria-checked={(a.hue ?? 'none') === h} className={`fin-huepick__swatch fin-huepick__swatch--${h}`} onClick={() => set({ hue: h === 'none' ? undefined : h })} aria-label={HUE_NAME[h]} title={HUE_NAME[h]} />
          ))}
        </div>
      </Field>

      {error && <p className="fin-error" role="alert">{error}</p>}

      <SheetFooter>
        {existing &&
          (confirm ? (
            <span className="fin-confirm">
              {used ? (existing.archived ? 'Restore it?' : 'Hide it from lists?') : 'Delete for good?'}
              <button type="button" className="fin-link fin-link--danger" onClick={remove}>
                {used ? (existing.archived ? 'Restore' : 'Archive') : 'Delete'}
              </button>
              <button type="button" className="fin-link" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="fin-link fin-link--danger" onClick={() => setConfirm(true)}>
              {used ? (existing.archived ? 'Restore' : 'Archive') : 'Delete'}
            </button>
          ))}
        <span className="fin-spacer" />
        <button type="button" className="fin-pill" onClick={(e) => requestClose(e.currentTarget)}>
          Cancel
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={save}>
          {existing ? 'Save' : 'Add account'}
        </button>
      </SheetFooter>
    </div>
  );
}

function MethodForm({ id, accountId, onClose }: { id?: string; accountId?: string; onClose: () => void }) {
  const { data, dispatch, undo } = useFinance();
  const existing = id ? data.methods.find((m) => m.id === id) : undefined;
  const [m, setM] = useState<PaymentMethod>(
    () => existing ?? { id: newId('m'), name: '', kind: 'upi', accountId: accountId ?? data.accounts[0]?.id ?? '' },
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const untouched = useRef(JSON.stringify(m));
  const requestClose = useUnsavedChanges(JSON.stringify(m) !== untouched.current);
  const set = (patch: Partial<PaymentMethod>) => {
    setError(null);
    setM((x) => ({ ...x, ...patch }));
  };

  const save = () => {
    const name = m.name.trim() || (m.brand ? BRANDS[m.brand].name : '');
    if (!name) return setError('Give it a name, or pick an app.');
    if (!m.accountId) return setError('Choose the account it pays from.');
    const change = dispatch({ type: 'SAVE_METHOD', method: { ...m, name } });
    toast(existing ? `Saved ${name}` : `Added ${name}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    const change = dispatch({ type: 'DELETE_METHOD', id: existing.id });
    toast(`Removed ${existing.name}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    onClose();
  };

  return (
    <div className="fin-form" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save()}>
      <div className="fin-form__ident">
        <BrandMark brand={m.brand} fallback={m.name || 'New'} size={44} />
        <input className="fin-input fin-input--title" value={m.name} onChange={(e) => set({ name: e.target.value })} placeholder={m.brand ? BRANDS[m.brand].name : 'Name'} aria-label="Name" />
      </div>

      <Field label="App or card">
        <BrandPicker brands={METHOD_BRANDS} value={m.brand} onChange={(brand) => set({ brand, name: existing || m.name ? m.name : '' })} />
      </Field>

      <Field label="Kind">
        <LiquidSegment<MethodKind>
          label="Kind"
          mono={false}
          value={m.kind}
          options={[
            { value: 'upi', label: 'UPI app' },
            { value: 'card', label: 'Card' },
            { value: 'wallet', label: 'Wallet' },
          ]}
          onChange={(kind) => set({ kind })}
        />
      </Field>

      <Field label="Pays from">
        <div className="fin-chiprow">
          {data.accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <button key={a.id} type="button" className="fin-paychip" aria-pressed={m.accountId === a.id} onClick={() => set({ accountId: a.id })}>
                <BrandMark brand={a.brand} fallback={a.name} size={20} />
                <span>{a.name}</span>
              </button>
            ))}
        </div>
      </Field>

      {m.kind === 'upi' && (
        <Field label="UPI ID" hint="Optional">
          <input className="fin-input fin-num" value={m.handle ?? ''} onChange={(e) => set({ handle: e.target.value.trim() || undefined })} placeholder="name@okaxis" spellCheck={false} />
        </Field>
      )}

      {error && <p className="fin-error" role="alert">{error}</p>}

      <SheetFooter>
        {existing &&
          (confirm ? (
            <span className="fin-confirm">
              Remove? Past payments keep their account.
              <button type="button" className="fin-link fin-link--danger" onClick={remove}>
                Remove
              </button>
              <button type="button" className="fin-link" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="fin-link fin-link--danger" onClick={() => setConfirm(true)}>
              Remove
            </button>
          ))}
        <span className="fin-spacer" />
        <button type="button" className="fin-pill" onClick={(e) => requestClose(e.currentTarget)}>
          Cancel
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={save}>
          {existing ? 'Save' : 'Add'}
        </button>
      </SheetFooter>
    </div>
  );
}
