/**
 * Settings → Subscriptions.
 *
 * Each row reads first (name, amount and cadence, the card or app it's charged
 * to, the next charge), and editing opens in place. The next charge is derived
 * from the schedule, so nothing here rewrites the owner's data as time
 * passes. "Record" opens a prefilled expense for the owner to confirm; nothing
 * is logged automatically. Removal asks first and can be undone. The Undo
 * lives in the sheet, because toasts draw beneath modals.
 */
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Field } from './Sheet';
import { BrandMark } from './BrandMark';
import { LiquidSegment } from './Liquid';
import { DateField } from './DatePicker';
import type { TransactionPreset } from './TransactionSheet';
import { useFinance } from '../FinanceContext';
import type { Frequency, Subscription } from '../types';
import * as L from '../ledger';
import { addDays, dayLabel, rupees, todayIso } from '../format';

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];
export const PER: Record<Frequency, string> = { monthly: '/mo', quarterly: '/qtr', yearly: '/yr' };
const RECORD_WINDOW_DAYS = 7;
const EVERY: Record<Frequency, string> = { monthly: 'every month', quarterly: 'every quarter', yearly: 'every year' };

/** `today`, `yesterday`, or `Mon 14 OCT` — only the relative words go lower case, mid-sentence. */
function when(iso: string, today: string): string {
  const label = dayLabel(iso, today);
  return label === 'Today' || label === 'Yesterday' ? label.toLowerCase() : label;
}

export default function SubscriptionsPanel({ onRecord }: { onRecord: (preset: TransactionPreset) => void }) {
  const { data, dispatch, undo } = useFinance();
  const today = todayIso();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; change: number } | null>(null);

  const subs = [...data.subscriptions].sort((a, b) => L.nextCharge(a, today).localeCompare(L.nextCharge(b, today)));
  const monthly = L.subscriptionsMonthly(data);

  const saved = (text: string, change: number) => {
    setEditing(null);
    setNotice({ text, change });
  };

  const remove = (s: Subscription) => {
    const change = dispatch({ type: 'DELETE_SUBSCRIPTION', id: s.id });
    setConfirming(null);
    setNotice({ text: `Removed ${s.name}`, change });
  };

  return (
    <section className="fin-set">
      <header className="fin-set__head">
        <h3>Subscriptions</h3>
        <p>
          {subs.length === 0
            ? 'Recurring charges you pay. Each shows its next charge on Overview; nothing is logged until you record it.'
            : `${subs.length} ${subs.length === 1 ? 'subscription' : 'subscriptions'} · ${rupees(Math.round(monthly * 100) / 100)} a month on average`}
        </p>
      </header>

      <div className="fin-set__rows">
        {subs.length === 0 && editing !== 'new' && <p className="fin-hint">None yet.</p>}
        {subs.map((s) =>
          editing === s.id ? (
            <SubscriptionForm key={s.id} initial={s} onSaved={saved} onCancel={() => setEditing(null)} />
          ) : (
            <SubscriptionRow
              key={s.id}
              s={s}
              today={today}
              confirming={confirming === s.id}
              onEdit={() => {
                setNotice(null);
                setConfirming(null);
                setEditing(s.id);
              }}
              onAskRemove={() => setConfirming(s.id)}
              onKeep={() => setConfirming(null)}
              onRemove={() => remove(s)}
              onRecord={onRecord}
            />
          ),
        )}
        {editing === 'new' ? (
          <SubscriptionForm onSaved={saved} onCancel={() => setEditing(null)} />
        ) : (
          <button
            type="button"
            className="fin-set__add"
            onClick={() => {
              setNotice(null);
              setEditing('new');
            }}
          >
            <Plus size={14} strokeWidth={1.8} /> Add a subscription
          </button>
        )}
      </div>

      {notice && (
        <p className="fin-saved-line" role="status">
          {notice.text}
          <button type="button" className="fin-link" onClick={() => { undo(notice.change); setNotice(null); }}>
            Undo
          </button>
        </p>
      )}
    </section>
  );
}

function SubscriptionRow({
  s,
  today,
  confirming,
  onEdit,
  onAskRemove,
  onKeep,
  onRemove,
  onRecord,
}: {
  s: Subscription;
  today: string;
  confirming: boolean;
  onEdit: () => void;
  onAskRemove: () => void;
  onKeep: () => void;
  onRemove: () => void;
  onRecord: (preset: TransactionPreset) => void;
}) {
  const { data } = useFinance();
  const method = L.methodById(data, s.methodId);
  const frequency = L.subFrequency(s);
  const next = L.nextCharge(s, today);
  // Only a charge from the last week is offered for recording; older cycles
  // were either logged some other way or happened before the owner added it.
  const last = L.lastCharge(s, today);
  const due = last && last >= addDays(today, -RECORD_WINDOW_DAYS) ? last : undefined;
  const paid = L.paidThisCycle(data, s, today);

  const record = () =>
    onRecord({
      kind: 'expense',
      methodId: method?.id,
      accountId: method?.accountId,
      amount: s.amount,
      merchant: s.name,
      category: 'Subscriptions',
      date: due ?? today,
    });

  return (
    <div className="fin-set__row fin-sub">
      {/* The subscription's own initial, not the card's logo — "Netflix" should not wear ICICI's mark. */}
      <BrandMark fallback={s.name} size={30} />
      <div className="fin-sub__main">
        <span className="fin-sub__name">{s.name}</span>
        <span className="fin-sub__meta">
          <span className="fin-num">{rupees(s.amount)}</span> {EVERY[frequency]}
          {method && (
            <>
              <span aria-hidden="true"> · </span>
              <BrandMark brand={method.brand} fallback={method.name} size={14} />
              {method.name}
            </>
          )}
        </span>
      </div>

      {confirming ? (
        <span className="fin-confirm">
          Remove {s.name}?
          <button type="button" className="fin-link fin-link--danger" onClick={onRemove}>
            Remove
          </button>
          <button type="button" className="fin-link" onClick={onKeep}>
            Keep
          </button>
        </span>
      ) : (
        <>
          <div className="fin-sub__when">
            <span>{next === today ? 'Due today' : `Next ${when(next, today)}`}</span>
            {paid ? (
              <span className="fin-positive">Recorded {when(paid.date, today)}</span>
            ) : due ? (
              <button type="button" className="fin-link" onClick={record} title="Opens a prefilled expense to confirm">
                {due >= addDays(today, -1) ? `Record ${when(due, today)}’s charge` : `Record the ${when(due, today)} charge`}
              </button>
            ) : !last ? (
              <span className="fin-sub__first">First charge ahead</span>
            ) : null}
          </div>
          <button type="button" className="fin-icon-btn" onClick={onEdit} aria-label={`Edit ${s.name}`} title="Edit">
            <Pencil size={13} strokeWidth={1.7} />
          </button>
          <button type="button" className="fin-icon-btn" onClick={onAskRemove} aria-label={`Remove ${s.name}`} title="Remove">
            <Trash2 size={13} strokeWidth={1.7} />
          </button>
        </>
      )}
    </div>
  );
}

function SubscriptionForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Subscription;
  onSaved: (text: string, change: number) => void;
  onCancel: () => void;
}) {
  const { data, dispatch } = useFinance();
  const today = todayIso();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    amount: initial ? String(initial.amount) : '',
    frequency: initial ? L.subFrequency(initial) : ('monthly' as Frequency),
    date: initial ? L.nextCharge(initial, today) : today,
    methodId: initial?.methodId ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => {
    setError(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  const save = () => {
    const name = form.name.trim();
    // Paise are kept: "649.50" is ₹649.50, not ₹64,950.
    const amount = Number(form.amount.replace(/[,\s₹]/g, ''));
    if (!name) return setError('Give it a name — the one on your statement works best.');
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter what each charge costs.');
    if (!form.date) return setError('Choose the next charge date.');
    const change = dispatch({
      type: 'SAVE_SUBSCRIPTION',
      subscription: {
        ...(initial ? { id: initial.id } : {}),
        name,
        amount: Math.round(amount * 100) / 100,
        frequency: form.frequency,
        nextCharge: form.date,
        methodId: form.methodId || undefined,
      },
    });
    onSaved(initial ? `Saved ${name}` : `Added ${name}`, change);
  };

  return (
    <div className="fin-sub__form" onKeyDown={(e) => e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && save()}>
      <div className="fin-sub__grid">
        <Field label="Name">
          <input className="fin-input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Netflix" autoFocus aria-label="Name" />
        </Field>
        <Field label="Each charge">
          <label className="fin-input fin-input--affix">
            <span>₹</span>
            <input className="fin-num" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="649" aria-label="Amount" />
          </label>
        </Field>
      </div>
      <div className="fin-sub__grid">
        <Field label="Next charge">
          <DateField label="Next charge" value={form.date} onChange={(date) => date && set({ date })} />
        </Field>
        <Field label="Repeats">
          <LiquidSegment<Frequency> label="Repeats" mono={false} value={form.frequency} onChange={(frequency) => set({ frequency })} options={FREQUENCY_OPTIONS} />
        </Field>
      </div>
      <Field label="Charged to">
        <div className="fin-chiprow">
          {data.methods.map((m) => (
            <button key={m.id} type="button" className="fin-paychip" aria-pressed={form.methodId === m.id} onClick={() => set({ methodId: form.methodId === m.id ? '' : m.id })}>
              <BrandMark brand={m.brand} fallback={m.name} size={20} />
              <span>{m.name}</span>
            </button>
          ))}
          {data.methods.length === 0 && <p className="fin-hint">Add a card or UPI app in Accounts & cards to pick it here.</p>}
        </div>
      </Field>
      {error && <p className="fin-error">{error}</p>}
      <div className="fin-si__actions">
        <button type="button" className="fin-pill fin-pill--sm fin-pill--light" onClick={save}>
          {initial ? 'Save changes' : 'Add subscription'}
        </button>
        <button type="button" className="fin-pill fin-pill--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
