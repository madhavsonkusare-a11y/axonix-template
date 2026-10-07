/**
 * Add / edit a transaction.
 *
 * Built for the common case to be one line and one keystroke: type
 * "250 swiggy gpay", press Enter. The structured fields underneath show the
 * parser's reading and stay editable, so a wrong guess is a click, not a
 * wrong row. Everything is reachable from the keyboard; Ctrl+Enter saves from
 * any field, Ctrl+Shift+Enter saves and starts another.
 *
 * Saving is a human confirming what is on screen — so it clears the
 * `autoCategorized` flag, including on an imported row being reviewed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CornerDownLeft, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import Sheet, { Field, SheetFooter, useUnsavedChanges } from './Sheet';
import { BrandMark } from './BrandMark';
import { LiquidSegment } from './Liquid';
import { CalendarPopover } from './DatePicker';
import { useFinance } from '../FinanceContext';
import type { Account, PaymentMethod, Transaction, TxKind } from '../types';
import { parseEntry } from '../parse';
import { accountById, balanceOf, knownMerchants, lastCheckpoint, learnedCategory, methodById } from '../ledger';
import { addDays, currencySymbol, dayLabel, moneyIn, todayIso } from '../format';

type EntryKind = Exclude<TxKind, 'adjustment'>;

interface Form {
  kind: EntryKind;
  amount: string;
  merchant: string;
  category: string;
  date: string;
  methodId?: string;
  accountId?: string;
  toAccountId?: string;
  toAmount: string;
  note: string;
}

export interface TransactionPreset {
  kind?: EntryKind;
  accountId?: string;
  methodId?: string;
  /** Transfers: where the money goes — e.g. a standing instruction's account. */
  toAccountId?: string;
  amount?: number;
  merchant?: string;
  category?: string;
  date?: string;
}

const KIND_OPTIONS = [
  { value: 'expense' as const, label: 'Expense' },
  { value: 'income' as const, label: 'Income' },
  { value: 'transfer' as const, label: 'Transfer' },
];

function lastUsedMethod(txs: Transaction[]): string | undefined {
  let best: Transaction | undefined;
  for (const t of txs) if (t.methodId && (!best || t.createdAt > best.createdAt)) best = t;
  return best?.methodId;
}

export default function TransactionSheet({
  open,
  onClose,
  editId,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  editId?: string;
  preset?: TransactionPreset;
}) {
  const editing = editId ? true : false;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? 'Edit transaction' : 'New transaction'}
      width={580}
      className="fin-txsheet"
    >
      <TransactionForm onClose={onClose} editId={editId} preset={preset} />
    </Sheet>
  );
}

function TransactionForm({ onClose, editId, preset }: { onClose: () => void; editId?: string; preset?: TransactionPreset }) {
  const { data, dispatch, undo } = useFinance();
  const existing = editId ? data.transactions.find((t) => t.id === editId) : undefined;
  const today = todayIso();

  const blank = (): Form => {
    const methodId = preset?.methodId ?? (preset?.accountId || preset?.kind === 'transfer' ? undefined : lastUsedMethod(data.transactions) ?? data.methods[0]?.id);
    return {
      kind: preset?.kind ?? 'expense',
      amount: preset?.amount !== undefined ? String(preset.amount) : '',
      merchant: preset?.merchant ?? '',
      category: preset?.category ?? '',
      date: preset?.date ?? today,
      methodId,
      accountId: preset?.accountId ?? methodById(data, methodId)?.accountId ?? data.accounts[0]?.id,
      toAccountId: preset?.toAccountId,
      toAmount: '',
      note: '',
    };
  };

  const [form, setForm] = useState<Form>(() =>
    existing
      ? {
          kind: existing.kind === 'adjustment' ? 'expense' : existing.kind,
          amount: String(Math.abs(existing.amount)),
          merchant: existing.merchant,
          category: existing.category,
          date: existing.date,
          methodId: existing.methodId,
          accountId: existing.accountId,
          toAccountId: existing.toAccountId,
          toAmount: existing.toAmount !== undefined ? String(existing.toAmount) : '',
          note: existing.note ?? '',
        }
      : blank(),
  );
  const [quick, setQuick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Anything typed or changed since the sheet opened would be lost on close.
  const untouched = useRef(JSON.stringify(form));
  const requestClose = useUnsavedChanges(quick.trim() !== '' || JSON.stringify(form) !== untouched.current, existing ? 'Discard changes' : 'Discard this entry');
  // "Save & new" keeps the sheet open, and toasts draw beneath a modal — so
  // the confirmation for that path lives inside the sheet.
  const [saved, setSaved] = useState<{ label: string; change: number } | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  const pickChip = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState<DOMRect | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (existing ? amountRef : quickRef).current?.focus();
    // Focus once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<Form>) => {
    setError(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  const account = accountById(data, form.accountId);
  const toAccount = accountById(data, form.toAccountId);
  const currency = account?.currency ?? 'INR';
  const categories = data.categories.filter((c) => c.kind === (form.kind === 'income' ? 'income' : 'expense'));
  const merchants = useMemo(() => knownMerchants(data), [data]);
  const liveAccounts = data.accounts.filter((a) => !a.archived);

  /* ---------- quick line ---------- */

  const applyQuick = (text: string) => {
    setQuick(text);
    setError(null);
    if (!text.trim()) {
      setForm(blank());
      return;
    }
    const p = parseEntry(text, data, today);
    setForm((f) => {
      const base = blank();
      const next: Form = {
        ...base,
        note: f.note,
        kind: p.kind,
        amount: p.amount !== undefined ? String(p.amount) : '',
        merchant: p.merchant,
        category: p.category ?? '',
        date: p.date ?? today,
      };
      if (p.kind === 'transfer') {
        next.methodId = undefined;
        next.accountId = p.accountId ?? base.accountId;
        next.toAccountId = p.toAccountId;
      } else if (p.methodId || p.accountId) {
        next.methodId = p.methodId;
        next.accountId = p.accountId;
      } else if (p.kind === 'income') {
        next.methodId = undefined;
      }
      return next;
    });
  };

  const onMerchantBlur = () => {
    if (form.category || !form.merchant || form.kind === 'transfer') return;
    const learned = learnedCategory(data, form.merchant);
    if (learned) set({ category: learned });
  };

  /* ---------- save ---------- */

  const amount = Number(form.amount.replace(/,/g, ''));

  // A balance typed on a later day already contains this entry, so saving it
  // will not move that balance. Said out loud, because otherwise it looks broken.
  const checkpoint = form.accountId ? lastCheckpoint(data, form.accountId) : undefined;
  const backdated = checkpoint && form.date < checkpoint.date && !existing ? checkpoint : undefined;
  const crossCurrency = form.kind === 'transfer' && account && toAccount && account.currency !== toAccount.currency;

  // Suggest what arrives on the other side from the rate typed into whichever
  // account is not in rupees.
  const suggestedToAmount = (() => {
    if (!crossCurrency || !amount) return undefined;
    if (account!.currency === 'INR' && toAccount!.fxRate) return +(amount / toAccount!.fxRate).toFixed(2);
    if (toAccount!.currency === 'INR' && account!.fxRate) return Math.round(amount * account!.fxRate);
    return undefined;
  })();

  const save = (another: boolean) => {
    if (!amount || amount <= 0) return setError('Enter an amount.');
    if (!form.accountId || !account) return setError(form.kind === 'income' ? 'Choose where it arrived.' : 'Choose how it was paid.');
    if (form.kind === 'transfer') {
      if (!form.toAccountId) return setError('Choose where the money went.');
      if (form.toAccountId === form.accountId) return setError('A transfer needs two different accounts.');
    }
    const toAmount = crossCurrency ? Number(form.toAmount) || suggestedToAmount : amount;
    if (form.kind === 'transfer' && crossCurrency && !toAmount) return setError(`Enter how much arrived in ${toAccount!.currency}.`);

    const signed = form.kind === 'income' ? amount : -amount;
    const merchant =
      form.merchant.trim() ||
      (form.kind === 'transfer' ? `To ${toAccount?.name ?? 'account'}` : form.category || (form.kind === 'income' ? 'Income' : 'Expense'));

    const tx: Transaction = {
      id: existing?.id ?? '',
      kind: form.kind,
      date: form.date || today,
      amount: signed,
      accountId: form.accountId,
      toAccountId: form.kind === 'transfer' ? form.toAccountId : undefined,
      toAmount: form.kind === 'transfer' ? toAmount : undefined,
      methodId: form.kind === 'transfer' ? undefined : form.methodId,
      merchant,
      category: form.kind === 'transfer' ? 'Transfer' : form.category || (form.kind === 'income' ? 'Other income' : 'Everything else'),
      note: form.note.trim() || undefined,
      source: existing?.source ?? (quick.trim() ? 'quick' : 'manual'),
      autoCategorized: false,
      createdAt: existing?.createdAt ?? '',
    };
    const { id, ...draft } = tx;
    const change = dispatch({ type: 'SAVE_TRANSACTION', tx: id ? tx : draft });

    const label = `${moneyIn(Math.abs(signed), currency)} · ${merchant}`;
    toast(existing ? `Saved ${label}` : `Added ${label}`, {
      action: { label: 'Undo', onClick: () => undo(change) },
    });

    if (another) {
      setSaved({ label, change });
      setQuick('');
      const fresh = blank();
      untouched.current = JSON.stringify(fresh);
      setForm(fresh);
      quickRef.current?.focus();
    } else {
      onClose();
    }
  };

  const remove = () => {
    if (!existing) return;
    const change = dispatch({ type: 'DELETE_TRANSACTION', id: existing.id });
    toast(`Deleted ${existing.merchant}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save(e.shiftKey);
    }
  };

  /* ---------- payment chips ---------- */

  const pickMethod = (m: PaymentMethod) => set({ methodId: m.id, accountId: m.accountId });
  const pickAccount = (a: Account) => set({ methodId: undefined, accountId: a.id });

  const methodChips = form.kind === 'income' ? data.methods.filter((m) => m.kind === 'wallet') : data.methods;
  const accountChips = liveAccounts.filter((a) => form.kind !== 'expense' || !['provident', 'demat', 'gold', 'deposit'].includes(a.kind));

  return (
    <div className="fin-txform" onKeyDown={onKeyDown}>
      {!existing && (
        <label className="fin-quick">
          <Sparkles size={15} strokeWidth={1.7} aria-hidden="true" />
          <input
            ref={quickRef}
            value={quick}
            onChange={(e) => applyQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                save(e.shiftKey);
              }
            }}
            placeholder="Type it: 250 swiggy gpay yesterday"
            aria-label="Quick entry"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="fin-key" aria-hidden="true">
            <CornerDownLeft size={11} strokeWidth={2} />
          </span>
        </label>
      )}

      <div className="fin-txform__top">
        <LiquidSegment
          label="Transaction type"
          options={KIND_OPTIONS}
          value={form.kind}
          mono={false}
          onChange={(kind) =>
            set({
              kind,
              category: '',
              methodId: kind === 'transfer' ? undefined : form.methodId,
              toAccountId: kind === 'transfer' ? form.toAccountId : undefined,
            })
          }
        />
        <div className="fin-dates" role="group" aria-label="Date">
          {[today, addDays(today, -1)].map((d) => (
            <button key={d} type="button" className="fin-chip-btn" aria-pressed={form.date === d} onClick={() => set({ date: d })}>
              {dayLabel(d, today)}
            </button>
          ))}
          <button
            ref={pickChip}
            type="button"
            className="fin-chip-btn fin-chip-btn--date"
            aria-pressed={form.date !== today && form.date !== addDays(today, -1)}
            aria-haspopup="dialog"
            aria-expanded={picking !== null}
            onClick={() => (picking ? setPicking(null) : pickChip.current && setPicking(pickChip.current.getBoundingClientRect()))}
          >
            {form.date !== today && form.date !== addDays(today, -1) ? dayLabel(form.date, today) : 'Pick'}
          </button>
          {picking && (
            <CalendarPopover
              anchor={picking}
              trigger={pickChip.current}
              value={form.date}
              max={today}
              label="Date"
              onPick={(date) => date && set({ date })}
              onClose={() => setPicking(null)}
            />
          )}
        </div>
      </div>

      <div className="fin-amount">
        <span className="fin-amount__symbol fin-num">{currencySymbol(currency).trim()}</span>
        <input
          ref={amountRef}
          className="fin-amount__input fin-num"
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => set({ amount: e.target.value.replace(/[^\d.,]/g, '') })}
          placeholder="0"
          aria-label="Amount"
        />
        {form.kind !== 'transfer' && (
          <input
            className="fin-amount__merchant"
            list="fin-merchants"
            value={form.merchant}
            onChange={(e) => set({ merchant: e.target.value })}
            onBlur={onMerchantBlur}
            placeholder={form.kind === 'income' ? 'From whom' : 'Where'}
            aria-label={form.kind === 'income' ? 'Payer' : 'Merchant'}
          />
        )}
        <datalist id="fin-merchants">
          {merchants.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      {form.kind === 'transfer' ? (
        <div className="fin-transfer">
          <Field label="From">
            <ChipRow>
              {liveAccounts.map((a) => (
                <PayChip key={a.id} on={form.accountId === a.id} onClick={() => set({ accountId: a.id })} brand={a.brand} name={a.name} meta={moneyIn(balanceOf(data, a.id), a.currency)} />
              ))}
            </ChipRow>
          </Field>
          <div className="fin-transfer__arrow" aria-hidden="true">
            <ArrowRight size={14} strokeWidth={1.8} />
          </div>
          <Field label="To">
            <ChipRow>
              {liveAccounts
                .filter((a) => a.id !== form.accountId)
                .map((a) => (
                  <PayChip key={a.id} on={form.toAccountId === a.id} onClick={() => set({ toAccountId: a.id })} brand={a.brand} name={a.name} meta={a.currency !== 'INR' ? a.currency : undefined} />
                ))}
            </ChipRow>
          </Field>
          {crossCurrency && (
            <Field label={`Arrived in ${toAccount!.currency}`} hint={suggestedToAmount ? `≈ ${moneyIn(suggestedToAmount, toAccount!.currency)} at the saved rate` : 'No rate saved on either account'}>
              <input
                className="fin-input fin-num"
                inputMode="decimal"
                value={form.toAmount}
                onChange={(e) => set({ toAmount: e.target.value.replace(/[^\d.]/g, '') })}
                placeholder={suggestedToAmount ? String(suggestedToAmount) : '0'}
              />
            </Field>
          )}
        </div>
      ) : (
        <>
          <Field label={form.kind === 'income' ? 'Received in' : 'Paid with'} hint={account && form.methodId ? `from ${account.name}` : undefined}>
            <ChipRow>
              {methodChips.map((m) => (
                <PayChip key={m.id} on={form.methodId === m.id} onClick={() => pickMethod(m)} brand={m.brand} name={m.name} />
              ))}
              {methodChips.length > 0 && <span className="fin-chiprow__break">or straight from an account</span>}
              {accountChips.map((a) => (
                <PayChip key={a.id} on={!form.methodId && form.accountId === a.id} onClick={() => pickAccount(a)} brand={a.brand} name={a.name} />
              ))}
            </ChipRow>
          </Field>

          <Field label="Category">
            <div className="fin-cats">
              {categories.map((c) => (
                <button key={c.id} type="button" className="fin-cat" aria-pressed={form.category === c.name} onClick={() => set({ category: form.category === c.name ? '' : c.name })}>
                  <span className="fin-cat__dot" style={{ background: c.color }} aria-hidden="true" />
                  {c.name}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}

      <input className="fin-note" value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="Add a note" aria-label="Note" />

      {backdated && !error && (
        <p className="fin-hint fin-hint--note">
          {account!.name}’s balance was set {backdated.date >= addDays(today, -1) ? dayLabel(backdated.date, today).toLowerCase() : `on ${dayLabel(backdated.date, today)}`}, after this — so it already includes this payment and will not change.
        </p>
      )}

      {error && (
        <p className="fin-error" role="alert">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="fin-saved-line" role="status">
          Added {saved.label}
          <button type="button" className="fin-link" onClick={() => { undo(saved.change); setSaved(null); }}>
            Undo
          </button>
        </p>
      )}

      <SheetFooter>
        {existing &&
          (confirmDelete ? (
            <span className="fin-confirm">
              Delete this transaction?
              <button type="button" className="fin-link fin-link--danger" onClick={remove}>
                Delete
              </button>
              <button type="button" className="fin-link" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="fin-link fin-link--danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ))}
        <span className="fin-txform__keys" aria-hidden="true">
          <span className="fin-key">Ctrl ↵</span> save
          {!existing && (
            <>
              <span className="fin-key">Ctrl ⇧ ↵</span> save &amp; new
            </>
          )}
        </span>
        <button type="button" className="fin-pill" onClick={(e) => requestClose(e.currentTarget)}>
          Cancel
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => save(false)}>
          {existing ? 'Save' : amount > 0 ? `Add ${moneyIn(amount, currency)}` : 'Add'}
        </button>
      </SheetFooter>
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="fin-chiprow">{children}</div>;
}

function PayChip({ on, onClick, brand, name, meta }: { on: boolean; onClick: () => void; brand?: Account['brand']; name: string; meta?: string }) {
  return (
    <button type="button" className="fin-paychip" aria-pressed={on} onClick={onClick}>
      <BrandMark brand={brand} fallback={name} size={20} />
      <span>{name}</span>
      {meta && <span className="fin-paychip__meta fin-num">{meta}</span>}
    </button>
  );
}
