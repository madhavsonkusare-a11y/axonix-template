/**
 * Details for an account, a payment method or a transaction — what opens when
 * you click a card, a payment-app tile or a transaction row.
 *
 * Reading comes first and editing is one step away: the sheet shows balance,
 * card, this month's flow, recent activity and the official sites, with Edit
 * in the footer. Links open in the system browser (see `external.ts`).
 */
import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { confirmAlert } from './Alert';
import Sheet, { Field, SheetFooter } from './Sheet';
import { BrandMark } from './BrandMark';
import { LiquidSegment } from './Liquid';
import { DateField } from './DatePicker';
import type { TransactionPreset } from './TransactionSheet';
import { useFinance } from '../FinanceContext';
import { useFinanceUi } from '../ui';
import type { Account, BrandId, FinanceData, PaymentMethod, SiFrequency, Transaction } from '../types';
import { BRANDS, type BrandLink } from '../brands';
import * as L from '../ledger';
import { addDays, clockOf, dayLabel, masked, money, moneyIn, todayIso } from '../format';
import { hostOf, openExternal } from '../external';

export type DetailTarget = { type: 'account' | 'method' | 'transaction'; id: string };

const CARD_TYPE = { debit: 'Debit card', credit: 'Credit card', forex: 'Forex card' } as const;
const METHOD_KIND = { upi: 'UPI app', card: 'Card', wallet: 'Wallet' } as const;

export default function DetailSheet({ target, onClose, extra }: { target: DetailTarget | null; onClose: () => void; /** Shown under a transaction's details (what it is linked to, in the new shell). */ extra?: ReactNode }) {
  const { data } = useFinance();
  const account = target?.type === 'account' ? L.accountById(data, target.id) : undefined;
  const method = target?.type === 'method' ? L.methodById(data, target.id) : undefined;
  const tx = target?.type === 'transaction' ? data.transactions.find((t) => t.id === target.id && t.kind !== 'adjustment') : undefined;
  const subject = account ?? method;
  const txAccount = tx ? L.accountById(data, tx.accountId) : undefined;
  const txMark = tx ? L.methodById(data, tx.methodId)?.brand ?? txAccount?.brand : undefined;

  if (tx) {
    return (
      <Sheet
        open={target !== null}
        onClose={onClose}
        width={560}
        className="fin-detail"
        title={
          <span className="fin-detail__title">
            <BrandMark brand={txMark} fallback={tx.merchant} size={36} />
            <span>
              {tx.merchant}
              <small>{tx.kind === 'transfer' ? 'Transfer' : tx.category}</small>
            </span>
          </span>
        }
      >
        <TransactionDetails tx={tx} onClose={onClose} extra={extra} />
      </Sheet>
    );
  }

  return (
    <Sheet
      open={target !== null && !!subject}
      onClose={onClose}
      width={600}
      className="fin-detail"
      title={
        subject ? (
          <span className="fin-detail__title">
            <BrandMark brand={subject.brand} fallback={subject.name} size={36} />
            <span>
              {subject.name}
              <small>{account ? `${L.KIND_LABEL[account.kind]} · ${account.currency}` : method ? METHOD_KIND[method.kind] : ''}</small>
            </span>
          </span>
        ) : (
          ''
        )
      }
    >
      {account && <AccountDetails account={account} onClose={onClose} />}
      {method && <MethodDetails method={method} onClose={onClose} />}
    </Sheet>
  );
}

const SOURCE_LABEL = { manual: 'Added by hand', quick: 'Added with quick entry', import: 'Imported from a statement', phone: 'Captured on the phone' } as const;

/**
 * A transaction, read-only: what, when, through what, and what the balance
 * was right after it. Editing is a button away, as for accounts.
 */
function TransactionDetails({ tx, onClose, extra }: { tx: Transaction; onClose: () => void; extra?: ReactNode }) {
  const { data, dispatch, undo } = useFinance();
  const ui = useFinanceUi();
  const today = todayIso();
  const account = L.accountById(data, tx.accountId);
  const to = L.accountById(data, tx.toAccountId);
  const method = L.methodById(data, tx.methodId);
  const currency = account?.currency ?? 'INR';
  const transfer = tx.kind === 'transfer';

  const go = (fn: () => void) => {
    onClose();
    fn();
  };

  const amount = transfer ? moneyIn(Math.abs(tx.amount), currency) : moneyIn(tx.amount, currency, { signed: true });
  const verb = transfer ? 'Moved' : tx.kind === 'income' ? 'Received' : 'Spent';
  const source = SOURCE_LABEL[tx.source ?? 'manual'];
  const added = tx.source !== 'import' && tx.createdAt ? `, ${clockOf(tx.createdAt)}` : '';
  const touched = [account, transfer ? to : undefined].filter((a): a is Account => !!a);

  const remove = async () => {
    const ok = await confirmAlert({
      title: 'Delete this transaction?',
      message: `${tx.merchant}, ${amount.replace(/^[+\u2212]/, '')} on ${dayLabel(tx.date, today)}. You can undo it straight after.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const change = dispatch({ type: 'DELETE_TRANSACTION', id: tx.id });
    toast(`Deleted ${tx.merchant}`, { action: { label: 'Undo', onClick: () => undo(change) } });
    onClose();
  };

  const confirm = () => {
    const change = dispatch({ type: 'CONFIRM_TRANSACTIONS', ids: [tx.id] });
    toast(`Confirmed ${tx.merchant} as ${tx.category}`, { action: { label: 'Undo', onClick: () => undo(change) } });
  };

  return (
    <div className="fin-form">
      <section className="fin-detail__hero">
        <span className="fin-label">{verb}</span>
        <span className={tx.kind === 'income' ? 'fin-detail__amount fin-num fin-positive' : 'fin-detail__amount fin-num'}>{amount}</span>
        <span className="fin-detail__sub">
          {dayLabel(tx.date, today)} · {source}
          {added}
        </span>
      </section>

      <div className="fin-detail__facts">
        <Fact words label={transfer ? 'From' : tx.kind === 'income' ? 'Into' : 'Paid with'} value={(transfer ? account?.name : method?.name ?? account?.name) ?? 'Unknown'} brand={transfer ? account?.brand : method?.brand ?? account?.brand} />
        {transfer ? (
          <Fact words label="To" value={to?.name ?? 'Unknown'} brand={to?.brand} />
        ) : (
          method && account && <Fact words label="From account" value={account.name} brand={account.brand} />
        )}
        {!transfer && <Fact words label="Category" value={tx.category} />}
      </div>

      {tx.autoCategorized && !transfer && (
        <div className="fin-reviewbar">
          <span className="fin-auto">auto</span>
          <p>Filed under {tx.category} by an import or a guess.</p>
          <button type="button" className="fin-pill fin-pill--sm" onClick={confirm}>
            Confirm
          </button>
        </div>
      )}

      <DetailSection title={touched.length > 1 ? 'Balances after this' : 'Balance after this'}>
        <div className="fin-detail__rows">
          {touched.map((a) => {
            const after = L.balanceAfter(data, a.id, tx);
            const set = L.hasBalance(data, a.id);
            return (
              <button key={a.id} type="button" className="fin-detail__row" onClick={() => go(() => ui.openDetails({ type: 'account', id: a.id }))}>
                <span className="fin-detail__row-main fin-detail__row-main--brand">
                  <BrandMark brand={a.brand} fallback={a.name} size={22} />
                  <span>
                    <span>{a.name}</span>
                    <span>
                      {set
                        ? `after ${moneyIn(Math.abs(a.id === to?.id ? tx.toAmount ?? tx.amount : tx.amount), a.currency)} ${(transfer ? a.id === to?.id : tx.kind === 'income') ? 'came in' : 'went out'}`
                        : 'No balance set on this account yet'}
                    </span>
                  </span>
                </span>
                {set && after !== undefined ? (
                  <span className={after < 0 ? 'fin-num fin-negative' : 'fin-num'}>{moneyIn(after, a.currency)}</span>
                ) : (
                  <span className="fin-hint">Not set</span>
                )}
              </button>
            );
          })}
        </div>
      </DetailSection>

      {tx.note && (
        <DetailSection title={tx.source === 'import' ? 'From the statement' : 'Note'}>
          <p className="fin-detail__note">{tx.note}</p>
        </DetailSection>
      )}

      {extra && <div className="nx-extra">{extra}</div>}

      <SheetFooter>
        <button type="button" className="fin-link fin-link--danger" onClick={() => void remove()}>
          Delete
        </button>
        <span className="fin-spacer" />
        <button
          type="button"
          className="fin-pill"
          onClick={() =>
            go(() =>
              ui.addTransaction({
                kind: tx.kind === 'adjustment' ? 'expense' : tx.kind,
                accountId: tx.accountId,
                methodId: tx.methodId,
                toAccountId: tx.toAccountId,
                amount: Math.abs(tx.amount),
                merchant: tx.merchant,
                category: transfer ? undefined : tx.category,
                date: today,
              }),
            )
          }
        >
          Duplicate
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => go(() => ui.editTransaction(tx.id))}>
          Edit
        </button>
      </SheetFooter>
    </div>
  );
}

function recentFor(data: FinanceData, match: (t: Transaction) => boolean, limit = 5): Transaction[] {
  return data.transactions
    .filter((t) => t.kind !== 'adjustment' && match(t))
    .sort(L.newestFirst(data))
    .slice(0, limit);
}

function AccountDetails({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const today = todayIso();
  const empty = L.needsBalance(data, account);
  const balance = L.balanceOf(data, account.id);
  const flow = L.accountFlow(data, account.id, L.monthPeriod(today));
  const checkpoint = L.lastCheckpoint(data, account.id);
  const methods = data.methods.filter((m) => m.accountId === account.id);
  const recent = recentFor(data, (t) => t.accountId === account.id || t.toAccountId === account.id);

  const go = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <div className="fin-form">
      <section className="fin-detail__hero">
        <span className="fin-label">Balance</span>
        {empty ? (
          <span className="fin-detail__amount fin-detail__amount--empty">Not set yet</span>
        ) : (
          <span className={balance < 0 ? 'fin-detail__amount fin-num fin-negative' : 'fin-detail__amount fin-num'}>{moneyIn(balance, account.currency)}</span>
        )}
        <span className="fin-detail__sub">
          {empty
            ? 'Set it once from Edit — every transaction after that moves it.'
            : [
                account.currency !== 'INR' && `≈ ${money(L.inr(account, balance))} at ₹${account.fxRate ?? 0}`,
                checkpoint && `last set ${checkpoint.date >= addDays(today, -1) ? dayLabel(checkpoint.date, today).toLowerCase() : `on ${dayLabel(checkpoint.date, today)}`}`,
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
      </section>

      <div className="fin-detail__facts">
        <Fact label="In this month" value={moneyIn(flow.in, account.currency, { signed: flow.in > 0 })} tone={flow.in > 0 ? 'positive' : undefined} />
        <Fact label="Out this month" value={moneyIn(-flow.out, account.currency)} />
        {account.card ? (
          <Fact
            label={CARD_TYPE[account.card.type]}
            value={account.card.last4 ? masked(account.card.last4) : 'No number saved'}
            brand={account.card.network}
          />
        ) : (
          account.last4 && <Fact label="Account" value={masked(account.last4)} />
        )}
      </div>

      {L.takesSi(account) && <SiSection account={account} onRecord={(preset) => go(() => ui.addTransaction(preset))} />}

      {methods.length > 0 && (
        <DetailSection title="Pays out through">
          <div className="fin-chiprow">
            {methods.map((m) => (
              <button key={m.id} type="button" className="fin-paychip" onClick={() => go(() => ui.openDetails({ type: 'method', id: m.id }))}>
                <BrandMark brand={m.brand} fallback={m.name} size={20} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
        </DetailSection>
      )}

      <Recent
        rows={recent}
        onRow={(id) => go(() => ui.openDetails({ type: 'transaction', id }))}
        onAll={() => go(() => ui.go('transactions', { accountId: account.id }))}
      />

      <Links brand={account.brand} />

      <SheetFooter>
        <span className="fin-spacer" />
        <button type="button" className="fin-pill" onClick={() => go(() => ui.editAccount({ type: 'account', id: account.id }))}>
          Edit account
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => go(() => ui.addTransaction({ accountId: account.id }))}>
          Add transaction
        </button>
      </SheetFooter>
    </div>
  );
}

function MethodDetails({ method, onClose }: { method: PaymentMethod; onClose: () => void }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const account = L.accountById(data, method.accountId);
  const month = L.monthPeriod();
  const spent = L.spentVia(data, method.id, month);
  const count = L.flowOf(data, month, (t) => t.methodId === method.id).count;
  const recent = recentFor(data, (t) => t.methodId === method.id);

  const go = (fn: () => void) => {
    onClose();
    fn();
  };

  const copyHandle = async () => {
    if (!method.handle) return;
    try {
      await navigator.clipboard.writeText(method.handle);
      toast('UPI ID copied');
    } catch {
      toast.error('The clipboard is not available here.');
    }
  };

  return (
    <div className="fin-form">
      <section className="fin-detail__hero">
        <span className="fin-label">Spent through it this month</span>
        <span className="fin-detail__amount fin-num">{money(spent)}</span>
        <span className="fin-detail__sub">
          {count} {count === 1 ? 'payment' : 'payments'}
        </span>
      </section>

      <div className="fin-detail__facts">
        {account ? (
          <button type="button" className="fin-fact fin-fact--button" onClick={() => go(() => ui.openDetails({ type: 'account', id: account.id }))}>
            <span className="fin-fact__label">Pays from</span>
            <span className="fin-fact__value">
              <BrandMark brand={account.brand} fallback={account.name} size={18} />
              {account.name}
            </span>
          </button>
        ) : (
          <Fact label="Pays from" value="No account" />
        )}
        {method.handle && (
          <button type="button" className="fin-fact fin-fact--button" onClick={copyHandle} title="Copy">
            <span className="fin-fact__label">UPI ID</span>
            <span className="fin-fact__value fin-num">
              {method.handle}
              <Copy size={12} strokeWidth={1.8} />
            </span>
          </button>
        )}
      </div>

      <Recent
        rows={recent}
        onRow={(id) => go(() => ui.openDetails({ type: 'transaction', id }))}
        onAll={account ? () => go(() => ui.go('transactions', { accountId: account.id })) : undefined}
      />

      <Links brand={method.brand} />

      <SheetFooter>
        <span className="fin-spacer" />
        <button type="button" className="fin-pill" onClick={() => go(() => ui.editAccount({ type: 'method', id: method.id }))}>
          Edit
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => go(() => ui.addTransaction({ methodId: method.id, accountId: method.accountId }))}>
          Add transaction
        </button>
      </SheetFooter>
    </div>
  );
}

const SI_WORDS: Record<SiFrequency, string> = { monthly: 'every month', quarterly: 'every quarter', yearly: 'every year' };
const SI_OPTIONS: { value: SiFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];
const BANK_KINDS: Account['kind'][] = ['savings', 'salary', 'current'];

/**
 * The standing instruction that pays into this account — PPF, RD. Read first,
 * edit in place. Saving only writes `account.si`; it never creates a
 * transaction on its own. "Record this debit" opens a prefilled transfer the
 * owner confirms, because the bank, not the app, decides whether it went through.
 */
function SiSection({ account, onRecord }: { account: Account; onRecord: (preset: TransactionPreset) => void }) {
  const { data, dispatch, undo } = useFinance();
  const today = todayIso();
  const si = account.si;
  const banks = data.accounts.filter((a) => !a.archived && a.id !== account.id && a.currency === 'INR' && BANK_KINDS.includes(a.kind));

  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notice, setNotice] = useState<{ text: string; change: number } | null>(null);
  const [form, setForm] = useState({ amount: '', from: '', frequency: 'monthly' as SiFrequency, date: today });
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setForm({
      amount: si ? String(si.amount) : '',
      from: si?.fromAccountId ?? banks[0]?.id ?? '',
      frequency: si?.frequency ?? 'monthly',
      date: si ? L.nextSiDate(si, today) : today,
    });
    setError(null);
    setConfirmRemove(false);
    setNotice(null);
    setEditing(true);
  };

  const save = () => {
    const amount = Number(form.amount.replace(/[,\s₹]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter the amount the bank moves each time.');
    if (!form.from) return setError('Choose the account the bank debits.');
    if (!form.date) return setError('Choose the next debit date.');
    const change = dispatch({
      type: 'SET_SI',
      accountId: account.id,
      si: { amount: Math.round(amount * 100) / 100, fromAccountId: form.from, frequency: form.frequency, anchorDate: form.date },
    });
    setEditing(false);
    setNotice({ text: si ? 'Standing instruction updated' : 'Standing instruction saved', change });
  };

  const remove = () => {
    const change = dispatch({ type: 'SET_SI', accountId: account.id });
    setConfirmRemove(false);
    setNotice({ text: 'Standing instruction removed', change });
  };

  const noticeLine = notice && (
    <p className="fin-saved-line" role="status">
      {notice.text}
      <button type="button" className="fin-link" onClick={() => { undo(notice.change); setNotice(null); }}>
        Undo
      </button>
    </p>
  );

  if (editing) {
    return (
      <DetailSection title={si ? 'Edit standing instruction' : 'Set up a standing instruction'}>
        <div className="fin-si fin-si--form">
          <div className="fin-si__grid">
            <Field label="Amount">
              <label className="fin-input fin-input--affix">
                <span>₹</span>
                <input
                  className="fin-num"
                  inputMode="decimal"
                  placeholder="5,000"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  autoFocus
                  aria-label="Amount"
                />
              </label>
            </Field>
            <Field label="Next debit">
              <DateField label="Next debit" value={form.date} onChange={(date) => date && setForm({ ...form, date })} />
            </Field>
          </div>
          <Field label="Repeats">
            <LiquidSegment<SiFrequency> label="Repeats" mono={false} value={form.frequency} onChange={(frequency) => setForm({ ...form, frequency })} options={SI_OPTIONS} />
          </Field>
          <Field label="Debited from">
            {banks.length === 0 ? (
              <p className="fin-hint">Add a savings or salary account first — the SI needs one to debit.</p>
            ) : (
              <div className="fin-chiprow">
                {banks.map((b) => (
                  <button key={b.id} type="button" className="fin-paychip" aria-pressed={form.from === b.id} onClick={() => setForm({ ...form, from: b.id })}>
                    <BrandMark brand={b.brand} fallback={b.name} size={20} />
                    <span>{b.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
          {error && <p className="fin-error">{error}</p>}
          <div className="fin-si__actions">
            <button type="button" className="fin-pill fin-pill--sm fin-pill--light" onClick={save}>
              {si ? 'Save changes' : 'Save SI'}
            </button>
            <button type="button" className="fin-pill fin-pill--sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      </DetailSection>
    );
  }

  if (!si) {
    return (
      <DetailSection title="Standing instruction">
        <div className="fin-si fin-si--empty">
          <p className="fin-hint">None set up. Add the SI your bank runs and the next debit shows here — it stays out of Subscriptions.</p>
          <button type="button" className="fin-pill fin-pill--sm" onClick={startEdit}>
            Set up SI
          </button>
        </div>
        {noticeLine}
      </DetailSection>
    );
  }

  const from = L.accountById(data, si.fromAccountId);
  const next = L.nextSiDate(si, today);

  return (
    <DetailSection
      title="Standing instruction"
      aside={
        <button type="button" className="fin-link" onClick={startEdit}>
          Edit
        </button>
      }
    >
      <div className="fin-si">
        <div className="fin-si__lead">
          <span className="fin-si__amount fin-num">{money(si.amount)}</span>
          <span className="fin-si__cadence">{SI_WORDS[si.frequency]}</span>
        </div>
        <div className="fin-si__meta">
          <span>
            <BrandMark brand={from?.brand} fallback={from?.name ?? '?'} size={18} />
            {from ? `From ${from.name}` : 'From an account that no longer exists'}
          </span>
          <span>Next debit {next === today ? 'today' : dayLabel(next, today)}</span>
        </div>
        <div className="fin-si__actions">
          <button
            type="button"
            className="fin-pill fin-pill--sm"
            onClick={() =>
              onRecord({ kind: 'transfer', accountId: si.fromAccountId, toAccountId: account.id, amount: si.amount, merchant: `${account.name} SI`, date: L.lastSiDate(si, today) ?? today })
            }
          >
            Record this debit
          </button>
          {confirmRemove ? (
            <span className="fin-confirm">
              Remove this SI?
              <button type="button" className="fin-link fin-link--danger" onClick={remove}>
                Remove
              </button>
              <button type="button" className="fin-link" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="fin-link fin-link--danger" onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
        </div>
      </div>
      {noticeLine}
    </DetailSection>
  );
}

function Fact({ label, value, brand, tone, words }: { label: string; value: string; brand?: BrandId; tone?: 'positive'; words?: boolean }) {
  // Figures in the number face; names and categories (`words`) in the text face.
  const face = words ? 'fin-fact__value fin-fact__value--words' : 'fin-fact__value fin-num';
  return (
    <div className="fin-fact">
      <span className="fin-fact__label">{label}</span>
      <span className={tone === 'positive' ? `${face} fin-positive` : face}>
        {brand && <BrandMark brand={brand} size={20} />}
        {value}
      </span>
    </div>
  );
}

function DetailSection({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="fin-detail__section">
      <div className="fin-field__label">
        <span>{title}</span>
        {aside && <span className="fin-field__hint">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Recent({ rows, onRow, onAll }: { rows: Transaction[]; onRow: (id: string) => void; onAll?: () => void }) {
  const { data } = useFinance();
  const today = todayIso();
  return (
    <DetailSection
      title="Recent activity"
      aside={
        onAll && rows.length > 0 ? (
          <button type="button" className="fin-link" onClick={onAll}>
            See all
          </button>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <p className="fin-hint">Nothing recorded yet.</p>
      ) : (
        <div className="fin-detail__rows">
          {rows.map((t) => {
            const acct = L.accountById(data, t.accountId);
            const amount = t.kind === 'transfer' ? moneyIn(Math.abs(t.amount), acct?.currency ?? 'INR') : moneyIn(t.amount, acct?.currency ?? 'INR', { signed: true });
            return (
              <button key={t.id} type="button" className="fin-detail__row" onClick={() => onRow(t.id)}>
                <span className="fin-detail__row-main">
                  <span>{t.merchant}</span>
                  <span>
                    {dayLabel(t.date, today)} · {t.kind === 'transfer' ? 'Transfer' : t.category}
                  </span>
                </span>
                <span className={t.kind === 'income' ? 'fin-num fin-positive' : 'fin-num'}>{amount}</span>
              </button>
            );
          })}
        </div>
      )}
    </DetailSection>
  );
}

function Links({ brand }: { brand?: BrandId }) {
  const links: BrandLink[] = brand ? BRANDS[brand].links ?? [] : [];
  if (links.length === 0) return null;
  const open = (url: string) => openExternal(url).catch((e) => toast.error(`Could not open the link: ${String(e)}`));
  return (
    <DetailSection title="Official sites">
      <div className="fin-detail__links">
        {links.map((l) => (
          <button key={l.url} type="button" className="fin-weblink" onClick={() => void open(l.url)}>
            <BrandMark brand={brand} size={22} />
            <span className="fin-weblink__text">
              <span>{l.label}</span>
              <span className="fin-num">{hostOf(l.url)}</span>
            </span>
            <ArrowUpRight size={15} strokeWidth={1.8} />
          </button>
        ))}
      </div>
    </DetailSection>
  );
}
