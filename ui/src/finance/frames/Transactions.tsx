/**
 * Transactions — the full ledger.
 *
 * Grouped by day, searchable, filterable by kind, account and category, with a
 * review mode for everything a machine categorised. Balance checkpoints are
 * shown in line, quietly, because they explain every jump in a balance.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFinance } from '../FinanceContext';
import { useFinanceUi, type LedgerFilter } from '../ui';
import type { Transaction } from '../types';
import * as L from '../ledger';
import { dayLabel, money, moneyIn, monthLabel, todayIso } from '../format';
import { LiquidSegment } from '../components/Liquid';
import { BrandMark } from '../components/BrandMark';
import { PopUpButton } from '../components/Menu';
import { TxRow } from './Overview';

type KindFilter = 'all' | 'expense' | 'income' | 'transfer';
const PAGE = 150;

export default function Transactions({ filter, onFilter }: { filter: LedgerFilter; onFilter: (f: LedgerFilter) => void }) {
  const { data, dispatch, undo } = useFinance();
  const ui = useFinanceUi();
  const [query, setQuery] = useState(filter.query ?? '');
  // A search handed over from the command palette while this frame is already
  // open. Keyed on the filter object, so the same words searched twice still
  // replace whatever was typed here since; the ledger's own filter changes
  // below drop `query`, so they never overwrite the box.
  useEffect(() => {
    if (filter.query !== undefined) setQuery(filter.query);
  }, [filter]);
  const refine = (change: Partial<LedgerFilter>) => onFilter({ ...filter, query: undefined, ...change });
  const [kind, setKind] = useState<KindFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const today = todayIso();

  const filtering = !!(query.trim() || kind !== 'all' || filter.accountId || filter.category || filter.review);
  const review = L.needsReview(data);
  const month = L.flowOf(data, L.monthPeriod(today));

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.transactions
      .filter((t) => {
        if (filter.review && !t.autoCategorized) return false;
        if (filter.accountId && t.accountId !== filter.accountId && t.toAccountId !== filter.accountId) return false;
        if (filter.category && t.category !== filter.category) return false;
        if (kind !== 'all' && t.kind !== kind) return false;
        if (t.kind === 'adjustment' && (kind !== 'all' || filter.review || filter.category || q)) return false;
        if (!q) return true;
        // Account and payment-method names too, so "gpay" or "icici" finds their payments.
        const acc = L.accountById(data, t.accountId);
        const via = L.methodById(data, t.methodId);
        const through = `${acc?.name ?? ''} ${acc?.brand ?? ''} ${via?.name ?? ''} ${via?.brand ?? ''}`;
        const hay = `${t.merchant} ${t.note ?? ''} ${t.category} ${Math.abs(t.amount)} ${through}`.toLowerCase();
        return hay.includes(q);
      })
      .sort(L.newestFirst(data));
  }, [data, filter, kind, query]);

  // What the filtered view adds up to, per month and in total. The page head
  // speaks for this month; these speak for what is actually on screen.
  const sums = useMemo(() => {
    const months = new Map<string, { in: number; out: number }>();
    let inAll = 0;
    let outAll = 0;
    for (const t of rows) {
      if (!L.isFlow(t)) continue;
      const v = L.inr(L.accountById(data, t.accountId), t.amount);
      const key = t.date.slice(0, 7);
      let m = months.get(key);
      if (!m) months.set(key, (m = { in: 0, out: 0 }));
      if (v >= 0) {
        m.in += v;
        inAll += v;
      } else {
        m.out -= v;
        outAll -= v;
      }
    }
    return { months, in: inAll, out: outAll };
  }, [rows, data]);

  const days = useMemo(() => {
    const groups: { date: string; items: Transaction[]; net: number; accounts: string[] }[] = [];
    for (const t of rows.slice(0, limit)) {
      let g = groups[groups.length - 1];
      if (!g || g.date !== t.date) groups.push((g = { date: t.date, items: [], net: 0, accounts: [] }));
      g.items.push(t);
      if (L.isFlow(t)) g.net += L.inr(L.accountById(data, t.accountId), t.amount);
      // Every account the day touched, in the order they appear — or only the
      // one the ledger is filtered to.
      for (const id of [t.accountId, t.kind === 'transfer' ? t.toAccountId : undefined]) {
        if (id && !g.accounts.includes(id) && (!filter.accountId || id === filter.accountId)) g.accounts.push(id);
      }
    }
    return groups;
  }, [rows, limit, data, filter.accountId]);

  const confirmAll = () => {
    const ids = rows.filter((t) => t.autoCategorized).map((t) => t.id);
    const change = dispatch({ type: 'CONFIRM_TRANSACTIONS', ids });
    toast(`Confirmed ${ids.length} ${ids.length === 1 ? 'category' : 'categories'}`, { action: { label: 'Undo', onClick: () => undo(change) } });
  };

  return (
    <div className="fin-page fin-page--tight">
      <header className="fin-page__head">
        <div className="fin-page__lead">
          <h2>Transactions</h2>
          <p>
            {money(month.out)} out and {money(month.in)} in this month
          </p>
        </div>
        <div className="fin-page__actions">
          <button type="button" className="fin-pill fin-pill--outline" onClick={() => ui.importStatement(filter.accountId)}>
            Import statement
          </button>
          <button type="button" className="fin-pill fin-pill--action" onClick={() => ui.addTransaction(filter.accountId ? { accountId: filter.accountId } : undefined)}>
            + Add
          </button>
        </div>
      </header>

      <div className="fin-ledger__bar">
        <label className="fin-ledger__search">
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Merchant, note, category, account or amount" aria-label="Search transactions" />
          {query && (
            <button type="button" className="fin-icon-btn fin-icon-btn--sm" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </label>

        <LiquidSegment<KindFilter>
          label="Kind"
          mono={false}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'expense', label: 'Spent' },
            { value: 'income', label: 'In' },
            { value: 'transfer', label: 'Transfers' },
          ]}
        />

        <div className="fin-ledger__filters">
          <PopUpButton
            label="Account"
            value={filter.accountId ?? ''}
            onChange={(accountId) => refine({ accountId: accountId || undefined })}
            options={[
              { value: '', label: 'All accounts' },
              ...data.accounts.map((a) => ({ value: a.id, label: a.name, icon: <BrandMark brand={a.brand} fallback={a.name} size={16} /> })),
            ]}
          />
          {filter.category && (
            <button type="button" className="fin-chip fin-chip--accent" onClick={() => refine({ category: undefined })}>
              {filter.category} <X size={11} strokeWidth={2} />
            </button>
          )}
          <button type="button" className="fin-chip-btn" aria-pressed={!!filter.review} onClick={() => refine({ review: !filter.review })}>
            Needs review {review.length > 0 && <span className="fin-num">{review.length}</span>}
          </button>
        </div>
      </div>

      {filtering && rows.length > 0 && (
        <p className="fin-ledger__sum">
          <span>
            {rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}
          </span>
          {sums.out > 0 && (
            <span>
              <em>out</em> <span className="fin-num">{money(sums.out)}</span>
            </span>
          )}
          {sums.in > 0 && (
            <span>
              <em>in</em> <span className="fin-num fin-positive">{money(sums.in)}</span>
            </span>
          )}
          {sums.in > 0 && sums.out > 0 && (
            <span>
              <em>net</em> <span className={sums.in - sums.out < 0 ? 'fin-num fin-negative' : 'fin-num'}>{money(sums.in - sums.out, { signed: true })}</span>
            </span>
          )}
        </p>
      )}

      {filter.review && review.length > 0 && (
        <div className="fin-reviewbar">
          <span className="fin-auto">auto</span>
          <p>
            {review.length === 1 ? 'This was' : `These ${review.length} were`} categorised by an import or a guess. Open one to change it, or confirm what is right.
          </p>
          <button type="button" className="fin-pill fin-pill--sm" onClick={confirmAll}>
            <Check size={13} strokeWidth={2} /> Confirm {rows.filter((t) => t.autoCategorized).length}
          </button>
        </div>
      )}

      <section className="fin-card fin-ledger">
        {days.length === 0 ? (
          <div className="fin-empty fin-empty--tall">
            <p className="fin-empty__text">
              {filter.review ? 'Nothing waiting for review.' : query || kind !== 'all' || filter.accountId || filter.category ? 'Nothing matches.' : 'No transactions yet.'}
            </p>
            {!filter.review && !query && (
              <button type="button" className="fin-pill fin-pill--sm" onClick={() => ui.addTransaction()}>
                Add the first one
              </button>
            )}
          </div>
        ) : (
          days.map((g, i) => (
            <div className="fin-day" key={g.date} data-month-start={g.date.slice(0, 7) !== days[i - 1]?.date.slice(0, 7) || undefined}>
              {g.date.slice(0, 7) !== days[i - 1]?.date.slice(0, 7) && (
                <div className="fin-month">
                  <h3>{monthLabel(g.date)}</h3>
                  <span className="fin-month__flow">
                    {(sums.months.get(g.date.slice(0, 7))?.out ?? 0) > 0 && (
                      <>
                        <em>out</em> <span className="fin-num">{money(sums.months.get(g.date.slice(0, 7))!.out)}</span>
                      </>
                    )}
                    {(sums.months.get(g.date.slice(0, 7))?.in ?? 0) > 0 && (
                      <>
                        <em>in</em> <span className="fin-num fin-positive">{money(sums.months.get(g.date.slice(0, 7))!.in)}</span>
                      </>
                    )}
                  </span>
                </div>
              )}
              <div className="fin-day__head">
                <span className="fin-day__date">{dayLabel(g.date, today)}</span>
                <span className="fin-day__count">
                  {g.items.length} {g.items.length === 1 ? 'entry' : 'entries'}
                </span>
                {g.net !== 0 && <span className={g.net < 0 ? 'fin-num fin-day__net' : 'fin-num fin-day__net fin-positive'}>{money(g.net, { signed: true })}</span>}
              </div>
              {g.items.map((t) =>
                t.kind === 'adjustment' ? <Checkpoint key={t.id} t={t} /> : <TxRow key={t.id} t={t} />,
              )}
              <DayBalances date={g.date} accounts={g.accounts} />
            </div>
          ))
        )}
        {rows.length > limit && (
          <button type="button" className="fin-ledger__more" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}
          </button>
        )}
      </section>
    </div>
  );
}

/**
 * Where each account the day touched stood when the day ended — one figure, or
 * several side by side when the day used more than one account.
 */
function DayBalances({ date, accounts }: { date: string; accounts: string[] }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  if (accounts.length === 0) return null;
  return (
    <div className="fin-day__balances">
      <span className="fin-day__balances-label">End of day</span>
      <span className="fin-day__balances-list">
        {accounts.map((id) => {
          const account = L.accountById(data, id);
          if (!account) return null;
          const set = L.hasBalance(data, id);
          const balance = L.balanceOf(data, id, date);
          const shown = set ? moneyIn(balance, account.currency) : 'not set';
          return (
            <button
              key={id}
              type="button"
              className="fin-daybal"
              data-empty={!set || undefined}
              onClick={() => ui.openDetails({ type: 'account', id })}
              aria-label={`${account.name} balance at the end of ${dayLabel(date)}: ${shown}`}
            >
              <BrandMark brand={account.brand} fallback={account.name} size={16} />
              <span className="fin-daybal__name">{account.name}</span>
              <span className={set && balance < 0 ? 'fin-num fin-negative' : 'fin-num'}>{shown}</span>
            </button>
          );
        })}
      </span>
    </div>
  );
}

function Checkpoint({ t }: { t: Transaction }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const account = L.accountById(data, t.accountId);
  return (
    <button type="button" className="fin-row fin-row--checkpoint" onClick={() => ui.openDetails({ type: 'account', id: t.accountId })}>
      <span />
      <span className="fin-row__merchant">
        <span className="fin-checkpoint__mark" aria-hidden="true" />
        <span>
          {account?.name ?? 'Account'} balance set to {moneyIn(t.balanceAfter ?? 0, account?.currency ?? 'INR')}
        </span>
      </span>
      <span />
      <span />
    </button>
  );
}
