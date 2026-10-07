/**
 * Transactions, second version — the full ledger, read like a statement.
 *
 * Same ledger, same filters (search, kind, account, category, review), same
 * chapters by month and day. What changed, and why:
 * - Rows are a third shorter, so a screen holds a week instead of two days.
 * - The end-of-day balances moved up into the day's own line. They used to
 *   take a row of their own under every day.
 * - Filter to one account and each row shows the balance after it, the way a
 *   bank statement does.
 * - A period filter (this month, last month, 90 days, this year).
 * - What is on screen is always totalled, not only while filtering.
 * - A machine's guess can be confirmed on the row, without opening it.
 * - `/` puts the cursor in the search field.
 *
 * Right-click on a row is the first tracker's own menu (edit, duplicate,
 * confirm, copy amount, delete).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFinance } from '../../finance/FinanceContext';
import { useFinanceUi, type LedgerFilter } from '../../finance/ui';
import type { Transaction } from '../../finance/types';
import * as L from '../../finance/ledger';
import { addDays, dayLabel, money, moneyIn, monthLabel } from '../../finance/format';
import { LiquidSegment } from '../../finance/components/Liquid';
import { BrandMark } from '../../finance/components/BrandMark';
import { PopUpButton } from '../../finance/components/Menu';
import { TxMenu } from '../../finance/frames/Overview';
import { LinkMark, useLinkCount } from '../lift/Links';
import { liftAttrs, txnThing } from '../lift/things';
import { EVERYDAY, isAsOfMark, isExpected } from '../scrub/Lens';
import { refuseChange, shortDay, useAsOf } from '../scrub/Scrub';

type KindFilter = 'all' | 'expense' | 'income' | 'transfer';
type Span = 'all' | 'month' | 'last' | '90' | 'year';
const PAGE = 150;

const SPANS: { value: Span; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: '90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
];

function spanOf(span: Span, today: string): L.Period | null {
  if (span === 'all') return null;
  if (span === 'month') return L.monthPeriod(today);
  if (span === 'last') {
    const before = L.previousPeriod('MONTH', today);
    return { start: before.start, end: addDays(L.monthPeriod(today).start, -1) };
  }
  if (span === '90') return { start: addDays(today, -89), end: today };
  return L.periodOf('YEAR', today);
}

function Row({ t, balanceOn }: { t: Transaction; balanceOn?: string }) {
  const { data, dispatch, undo } = useFinance();
  const ui = useFinanceUi();
  const row = useRef<HTMLDivElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const asOf = useAsOf();
  const links = useLinkCount({ kind: 'txn', id: t.id });
  const account = L.accountById(data, t.accountId);
  const method = L.methodById(data, t.methodId);
  const to = L.accountById(data, t.toAccountId);
  const via = t.kind === 'transfer' ? `${account?.name ?? '?'} → ${to?.name ?? '?'}` : (method?.name ?? account?.name);
  const hue = data.categories.find((c) => c.name === t.category)?.color;
  const after = balanceOn ? L.balanceAfter(data, balanceOn, t) : undefined;
  const side = balanceOn ? L.accountById(data, balanceOn) : undefined;
  const open = () => ui.openDetails({ type: 'transaction', id: t.id });

  const confirm = () => {
    const change = dispatch({ type: 'CONFIRM_TRANSACTIONS', ids: [t.id] });
    toast(`Confirmed ${t.merchant} as ${t.category}`, { action: { label: 'Undo', onClick: () => undo(change) } });
  };

  return (
    <div
      ref={row}
      className="nxf-tx"
      role="button"
      tabIndex={0}
      data-menu-open={menuAt !== null || undefined}
      data-fresh={Date.now() - Date.parse(t.createdAt) < 2500 || undefined}
      data-balance={balanceOn ? true : undefined}
      {...liftAttrs(txnThing(t, data))}
      onClick={open}
      onContextMenu={(e) => {
        e.preventDefault();
        // The menu is all changes; while another day is showing there are none to make.
        if (asOf.live) setMenuAt({ x: e.clientX, y: e.clientY });
        else refuseChange(asOf.day);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          if (asOf.live) setMenuAt({ x: r.left + 48, y: r.bottom - 4 });
        }
      }}
    >
      <BrandMark brand={method?.brand ?? account?.brand} fallback={t.merchant} size={28} />
      <span className="nxf-tx__text">
        <span>
          {t.merchant}
          <LinkMark count={links} />
        </span>
        <span>
          {via}
          {t.note && ` · ${t.note}`}
        </span>
      </span>
      <span className="nxf-tx__cat">
        <i style={{ background: hue ?? 'rgba(242, 242, 240, 0.3)' }} aria-hidden="true" />
        <span>{t.category}</span>
        {t.autoCategorized && asOf.live && (
          <button
            type="button"
            className="nxf-tx__confirm"
            onClick={(e) => {
              e.stopPropagation();
              confirm();
            }}
            aria-label={`Confirm ${t.category} for ${t.merchant}`}
            title="A guess. Confirm it is right"
          >
            <Check size={11} strokeWidth={2.4} aria-hidden="true" /> auto
          </button>
        )}
      </span>
      <span className={t.kind === 'income' ? 'nxf-tx__amount fin-num nxf-pos' : t.kind === 'transfer' ? 'nxf-tx__amount nxf-tx__amount--quiet fin-num' : 'nxf-tx__amount fin-num'}>
        {t.kind === 'transfer' ? moneyIn(Math.abs(t.amount), account?.currency ?? 'INR') : moneyIn(t.amount, account?.currency ?? 'INR', { signed: true })}
      </span>
      {balanceOn && <span className={after !== undefined && after < 0 ? 'nxf-tx__after fin-num fin-negative' : 'nxf-tx__after fin-num'}>{after === undefined ? '' : moneyIn(after, side?.currency ?? 'INR')}</span>}
      {menuAt && <TxMenu t={t} at={menuAt} trigger={row.current} onClose={() => setMenuAt(null)} dispatch={dispatch} undo={undo} />}
    </div>
  );
}

/**
 * Something that has not happened: on a schedule, or an estimate of everyday
 * spending. It stands where it will fall in the ledger, in blue, and is not
 * for pressing: there is nothing behind it to open or change.
 */
function Expected({ t, balanceOn }: { t: Transaction; balanceOn?: string }) {
  const { data } = useFinance();
  const account = L.accountById(data, t.accountId);
  const method = L.methodById(data, t.methodId);
  const to = L.accountById(data, t.toAccountId);
  const estimate = t.id === EVERYDAY;
  const after = balanceOn ? L.balanceAfter(data, balanceOn, t) : undefined;
  const side = balanceOn ? L.accountById(data, balanceOn) : undefined;
  return (
    <div className="nxf-tx" data-expected="" data-balance={balanceOn ? true : undefined} title={estimate ? 'An estimate from your recent daily spending. Nothing is recorded.' : 'On a schedule. Not recorded until it happens.'}>
      <BrandMark brand={method?.brand ?? account?.brand} fallback={t.merchant} size={28} />
      <span className="nxf-tx__text">
        <span>{t.merchant}</span>
        <span>{t.kind === 'transfer' ? `${account?.name ?? '?'} → ${to?.name ?? '?'}` : (method?.name ?? account?.name)}</span>
      </span>
      <span className="nxf-tx__cat">
        <span className="nxf-chip nxf-chip--live">{estimate ? 'Estimate' : 'Expected'}</span>
      </span>
      <span className="nxf-tx__amount fin-num">{t.kind === 'transfer' ? moneyIn(Math.abs(t.amount), account?.currency ?? 'INR') : moneyIn(t.amount, account?.currency ?? 'INR', { signed: true })}</span>
      {balanceOn && <span className="nxf-tx__after fin-num">{after === undefined ? '' : moneyIn(after, side?.currency ?? 'INR')}</span>}
    </div>
  );
}

function Checkpoint({ t }: { t: Transaction }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const account = L.accountById(data, t.accountId);
  return (
    <button type="button" className="nxf-tx nxf-tx--checkpoint" onClick={() => ui.openDetails({ type: 'account', id: t.accountId })}>
      <span className="nxf-tx__mark" aria-hidden="true" />
      <span>
        {account?.name ?? 'Account'} balance set to <b className="fin-num">{moneyIn(t.balanceAfter ?? 0, account?.currency ?? 'INR')}</b>
      </span>
    </button>
  );
}

/** Where each account the day touched stood when the day ended. */
function DayBalances({ date, accounts }: { date: string; accounts: string[] }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  return (
    <span className="nxf-day__balances">
      {accounts.map((id) => {
        const account = L.accountById(data, id);
        if (!account) return null;
        const set = L.hasBalance(data, id);
        const balance = L.balanceOf(data, id, date);
        const shown = set ? moneyIn(balance, account.currency) : 'not set';
        return (
          <button key={id} type="button" className="nxf-daybal" data-empty={!set || undefined} onClick={() => ui.openDetails({ type: 'account', id })} title={`${account.name} at the end of ${dayLabel(date)}`} aria-label={`${account.name} balance at the end of ${dayLabel(date)}: ${shown}`}>
            <BrandMark brand={account.brand} fallback={account.name} size={14} />
            <span className={set && balance < 0 ? 'fin-num fin-negative' : 'fin-num'}>{shown}</span>
          </button>
        );
      })}
    </span>
  );
}

export default function Transactions({ filter, onFilter }: { filter: LedgerFilter; onFilter: (f: LedgerFilter) => void }) {
  const { data, dispatch, undo } = useFinance();
  const ui = useFinanceUi();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(filter.query ?? '');
  // A search handed over from the command palette while this view is already
  // open. Keyed on the filter object, so the same words searched twice still
  // replace whatever was typed here since.
  useEffect(() => {
    if (filter.query !== undefined) setQuery(filter.query);
  }, [filter]);
  const refine = (change: Partial<LedgerFilter>) => onFilter({ ...filter, query: undefined, ...change });
  const [kind, setKind] = useState<KindFilter>('all');
  const [span, setSpan] = useState<Span>('all');
  const [limit, setLimit] = useState(PAGE);
  const asOf = useAsOf();
  const today = asOf.day;

  // `/` — search, as in every list worth searching.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const at = document.activeElement;
      if (at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement || (at instanceof HTMLElement && at.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const period = spanOf(span, today);
  const filtering = !!(query.trim() || kind !== 'all' || span !== 'all' || filter.accountId || filter.category || filter.review);
  const review = L.needsReview(data);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.transactions
      .filter((t) => {
        // A balance worked out for the day being shown is a figure, not an entry.
        if (isAsOfMark(t)) return false;
        if (period && (t.date < period.start || t.date > period.end)) return false;
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
        return `${t.merchant} ${t.note ?? ''} ${t.category} ${Math.abs(t.amount)} ${through}`.toLowerCase().includes(q);
      })
      .sort(L.newestFirst(data));
    // `period` is derived from `span` and `today`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, kind, query, span, today]);

  // What is on screen adds up to, per month and in total.
  const sums = useMemo(() => {
    const months = new Map<string, { in: number; out: number }>();
    let inAll = 0;
    let outAll = 0;
    let count = 0;
    for (const t of rows) {
      if (t.kind !== 'adjustment') count++;
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
    return { months, in: inAll, out: outAll, count };
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

  const guesses = rows.filter((t) => t.autoCategorized);
  const confirmAll = () => {
    const ids = guesses.map((t) => t.id);
    const change = dispatch({ type: 'CONFIRM_TRANSACTIONS', ids });
    toast(`Confirmed ${ids.length} ${ids.length === 1 ? 'category' : 'categories'}`, { action: { label: 'Undo', onClick: () => undo(change) } });
  };

  const clear = () => {
    setQuery('');
    setKind('all');
    setSpan('all');
    onFilter({});
  };

  const scope = filter.accountId ? L.accountById(data, filter.accountId) : undefined;

  return (
    <div className="nxf-page">
      <header className="nxf-head">
        <div>
          <h2>Transactions</h2>
          <p>
            {scope ? `${scope.name} · ` : ''}
            {SPANS.find((s) => s.value === span)?.label}
            {asOf.future && ` · with what is expected by ${shortDay(asOf.day)}`}
            {asOf.past && ` · as it stood at the end of ${shortDay(asOf.day)}`}
            {filtering && (
              <>
                {' · '}
                <button type="button" className="fin-link" onClick={clear}>
                  Clear filters
                </button>
              </>
            )}
          </p>
        </div>
        <button type="button" className="fin-pill fin-pill--outline" onClick={() => ui.importStatement(filter.accountId)}>
          Import statement
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => ui.addTransaction(filter.accountId ? { accountId: filter.accountId } : undefined)}>
          + Add
        </button>
      </header>

      <div className="nxf-ledgerbar">
        <label className="nxf-find">
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Merchant, note, category, account or amount" aria-label="Search transactions" />
          {query ? (
            <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={12} strokeWidth={2} />
            </button>
          ) : (
            <span className="fin-key">/</span>
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

        <div className="nxf-ledgerbar__end">
          <PopUpButton label="Period" value={span} onChange={setSpan} options={SPANS} />
          <PopUpButton
            label="Account"
            value={filter.accountId ?? ''}
            onChange={(accountId) => refine({ accountId: accountId || undefined })}
            options={[{ value: '', label: 'All accounts' }, ...data.accounts.map((a) => ({ value: a.id, label: a.name, icon: <BrandMark brand={a.brand} fallback={a.name} size={16} /> }))]}
          />
          {filter.category && (
            <button type="button" className="nxf-chip nxf-chip--on" onClick={() => refine({ category: undefined })}>
              {filter.category} <X size={11} strokeWidth={2} />
            </button>
          )}
          <button type="button" className={filter.review ? 'nxf-chip nxf-chip--att nxf-chip--pressed' : 'nxf-chip nxf-chip--att'} aria-pressed={!!filter.review} onClick={() => refine({ review: !filter.review })}>
            Needs review {review.length > 0 && <span className="fin-num">{review.length}</span>}
          </button>
        </div>
      </div>

      <div className="nxf-totals">
        <div>
          <p className="nxf-label">Showing</p>
          <span className="fin-num">{sums.count}</span>
        </div>
        <div>
          <p className="nxf-label">Out</p>
          <span className="fin-num">{money(Math.round(sums.out))}</span>
        </div>
        <div>
          <p className="nxf-label">In</p>
          <span className="fin-num nxf-pos">{money(Math.round(sums.in))}</span>
        </div>
        <div>
          <p className="nxf-label">Net</p>
          <span className={sums.in - sums.out < 0 ? 'fin-num fin-negative' : 'fin-num'}>{money(Math.round(sums.in - sums.out), { signed: true })}</span>
        </div>
      </div>

      {filter.review && review.length > 0 && (
        <div className="nxf-reviewbar">
          <p>
            {review.length === 1 ? 'This was' : `These ${review.length} were`} categorised by an import or a guess. Open one to change it, or confirm what is right.
          </p>
          <button type="button" className="fin-pill fin-pill--sm" onClick={confirmAll}>
            <Check size={13} strokeWidth={2} /> Confirm {guesses.length}
          </button>
        </div>
      )}

      <section className="nxf-card nxf-ledger" data-balance={filter.accountId ? true : undefined}>
        {days.length === 0 ? (
          <div className="fin-empty fin-empty--tall">
            <p className="fin-empty__text">{filter.review ? 'Nothing waiting for review.' : filtering ? 'Nothing matches.' : 'No transactions yet.'}</p>
            {!filter.review && !query && (
              <button type="button" className="fin-pill fin-pill--sm" onClick={() => ui.addTransaction()}>
                {filtering ? 'Add one' : 'Add the first one'}
              </button>
            )}
          </div>
        ) : (
          days.map((g, i) => {
            const month = g.date.slice(0, 7);
            const first = month !== days[i - 1]?.date.slice(0, 7);
            const flow = sums.months.get(month);
            return (
              <div className="nxf-day" key={g.date}>
                {first && (
                  <div className="nxf-month">
                    <h3>{monthLabel(g.date)}</h3>
                    {flow && flow.out > 0 && (
                      <span>
                        out <b className="fin-num">{money(Math.round(flow.out))}</b>
                      </span>
                    )}
                    {flow && flow.in > 0 && (
                      <span>
                        in <b className="fin-num nxf-pos">{money(Math.round(flow.in))}</b>
                      </span>
                    )}
                    {filter.accountId && <span className="nxf-month__after">Balance after</span>}
                  </div>
                )}
                <div className="nxf-day__head">
                  <span className="nxf-day__date">{dayLabel(g.date, asOf.today)}</span>
                  <span className="nxf-day__count">
                    {g.items.length} {g.items.length === 1 ? 'entry' : 'entries'}
                  </span>
                  {g.net !== 0 && <span className={g.net < 0 ? 'nxf-day__net fin-num' : 'nxf-day__net fin-num nxf-pos'}>{money(g.net, { signed: true })}</span>}
                  <DayBalances date={g.date} accounts={g.accounts} />
                </div>
                {g.items.map((t) => (t.kind === 'adjustment' ? <Checkpoint key={t.id} t={t} /> : isExpected(t) ? <Expected key={t.id} t={t} balanceOn={filter.accountId} /> : <Row key={t.id} t={t} balanceOn={filter.accountId} />))}
              </div>
            );
          })
        )}
        {rows.length > limit && (
          <button type="button" className="nxf-more" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}
          </button>
        )}
      </section>
    </div>
  );
}
