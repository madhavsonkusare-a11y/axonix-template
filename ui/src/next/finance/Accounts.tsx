/**
 * Accounts, second version — everything that holds money, and how it is paid from.
 *
 * What changed from the first Accounts, and why:
 * - One kind of card for every account. The first version drew some accounts
 *   as tall coloured cards and the rest as table rows, split by whether a
 *   colour had been picked — which said nothing about the account.
 * - Grouped by what the money is for (banks, investments, travel, borrowed),
 *   each group with its own total, under one bar showing how the whole splits.
 * - Every balance sits behind the same veil as the totals.
 * - A standing instruction shows on the card it feeds, with its next date.
 * - Ways to pay are rows, not tiles: the account each one really debits, and
 *   what went through it this month.
 *
 * An account's colour is the owner's choice and stays, as a quiet wash in the
 * card's corner rather than the whole card.
 */
import { Plus } from 'lucide-react';
import { useFinance } from '../../finance/FinanceContext';
import { useFinanceUi } from '../../finance/ui';
import type { Account } from '../../finance/types';
import * as L from '../../finance/ledger';
import { dayLabel, masked, money, moneyIn } from '../../finance/format';
import { accountThing, liftAttrs } from '../lift/things';
import { useDay } from '../scrub/Scrub';
import { BrandMark } from '../../finance/components/BrandMark';
import { Sparkline } from '../../finance/components/Charts';
import { Secret } from '../../finance/components/Secret';
import { PER } from '../../finance/components/SubscriptionsPanel';
import { ShareBar, StackBar } from '../charts';

const METHOD_KIND = { upi: 'UPI', card: 'Card', wallet: 'Wallet' } as const;
const CARD_TYPE = { debit: 'Debit card', credit: 'Credit card', forex: 'Forex card' } as const;

const GROUPS: { id: L.AccountGroup; title: string; tone: 'ink' | 'soft' | 'faint' | 'danger' }[] = [
  { id: 'banks', title: 'Banks and cash', tone: 'ink' },
  { id: 'investments', title: 'Investments', tone: 'soft' },
  { id: 'travel', title: 'Travel', tone: 'faint' },
  { id: 'liabilities', title: 'Borrowed', tone: 'danger' },
];

function AccountCard({ account: a }: { account: Account }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const today = useDay();
  const balance = L.balanceOf(data, a.id);
  const flow = L.accountFlow(data, a.id, L.monthPeriod(today));
  const unset = L.needsBalance(data, a);
  const trend = L.balanceTrend(data, a.id, 30, 8, today);
  const flat = trend.every((v) => v === trend[0]);
  const foreign = a.currency !== 'INR';
  const tail = a.card?.last4 ?? a.last4;
  const from = a.si ? L.accountById(data, a.si.fromAccountId) : undefined;

  return (
    <div
      className="nxf-acct"
      {...liftAttrs(accountThing(a, data), { hold: true })}
      role="button"
      tabIndex={0}
      data-hue={a.hue}
      onClick={() => ui.openDetails({ type: 'account', id: a.id })}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        ui.openDetails({ type: 'account', id: a.id });
      }}
      aria-label={a.name}
    >
      <div className="nxf-acct__top">
        <BrandMark brand={a.brand} fallback={a.name} size={34} />
        <div className="nxf-acct__id">
          <span>{a.name}</span>
          <span>
            {L.KIND_LABEL[a.kind]}
            {a.card && a.kind !== 'forex' && ` · ${CARD_TYPE[a.card.type]}`}
            {foreign && ` · ${a.currency}`}
          </span>
        </div>
        {(a.card?.network || tail) && (
          <span className="nxf-acct__tail fin-num">
            {a.card?.network && <BrandMark brand={a.card.network} size={20} />}
            {tail && masked(tail)}
          </span>
        )}
      </div>

      <div className="nxf-acct__mid">
        {unset ? (
          <span className="nxf-acct__unset">Balance not set</span>
        ) : (
          <div className="nxf-acct__figure">
            <Secret className={balance < 0 ? 'nxf-acct__balance fin-num fin-negative' : 'nxf-acct__balance fin-num'} label={`${a.name} balance`} value={moneyIn(balance, a.currency)} />
            {foreign && <span className="nxf-acct__fx fin-num">≈ {money(Math.round(L.inr(a, balance)))}</span>}
          </div>
        )}
        {!unset && !flat && <Sparkline values={trend} stroke="var(--nx-ink-2)" width={84} height={30} strokeWidth={1.6} className="nxf-acct__trend" />}
      </div>

      <div className="nxf-acct__foot">
        {unset ? (
          <button
            type="button"
            className="fin-pill fin-pill--sm"
            onClick={(e) => {
              e.stopPropagation();
              ui.editAccount({ type: 'account', id: a.id });
            }}
          >
            Set balance
          </button>
        ) : (
          <>
            <span>
              In <b className={flow.in > 0 ? 'fin-num nxf-pos' : 'fin-num'}>{moneyIn(flow.in, a.currency, { signed: flow.in > 0 })}</b>
            </span>
            <span>
              Out <b className="fin-num">{moneyIn(-flow.out, a.currency)}</b>
            </span>
            <span className="nxf-acct__when">this month</span>
          </>
        )}
      </div>

      {a.si && (
        <p className="nxf-acct__si">
          <b className="fin-num">
            {money(a.si.amount)}
            {PER[a.si.frequency]}
          </b>{' '}
          {from ? `from ${from.name}` : 'standing instruction'} · next {dayLabel(L.nextSiDate(a.si, today), today)}
        </p>
      )}
    </div>
  );
}

function ArchivedRow({ account: a }: { account: Account }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  return (
    <button type="button" className="nxf-row" onClick={() => ui.openDetails({ type: 'account', id: a.id })}>
      <BrandMark brand={a.brand} fallback={a.name} size={28} />
      <span className="nxf-row__text">
        <span>{a.name}</span>
        <span>{L.KIND_LABEL[a.kind]}</span>
      </span>
      <span className="nxf-row__end">
        <span className="fin-num">{moneyIn(L.balanceOf(data, a.id), a.currency)}</span>
      </span>
    </button>
  );
}

export default function Accounts() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const month = L.monthPeriod(useDay());
  const live = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);
  const nw = L.netWorth(data);

  const groups = GROUPS.map((g) => {
    const accounts = live.filter((a) => L.groupOf(a) === g.id);
    return { ...g, accounts, total: accounts.reduce((sum, a) => sum + L.balanceInr(data, a), 0) };
  }).filter((g) => g.accounts.length > 0);

  const methods = data.methods.map((m) => ({ m, account: L.accountById(data, m.accountId), spent: L.spentVia(data, m.id, month) }));
  const methodPeak = Math.max(1, ...methods.map((x) => x.spent));

  return (
    <div className="nxf-page">
      <header className="nxf-head">
        <div>
          <h2>Accounts</h2>
          <p>
            {live.length} {live.length === 1 ? 'account' : 'accounts'} · {data.methods.length} ways to pay
          </p>
        </div>
        <button type="button" className="fin-pill fin-pill--outline" onClick={() => ui.importStatement()}>
          Import statement
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => ui.editAccount({ type: 'account' })}>
          Add account
        </button>
      </header>

      {live.length > 0 && (
        <section className="nxf-card nxf-split">
          <div className="nxf-split__lead">
            <p className="nxf-label">Net worth</p>
            <Secret className="nxf-split__amount fin-num" label="Net worth" value={money(nw.total)} />
          </div>
          <div className="nxf-split__bar">
            <StackBar parts={groups.map((g) => ({ label: g.title, value: Math.abs(g.total), tone: g.tone }))} />
            <div className="nxf-split__parts">
              {groups.map((g) => (
                <div className="nxf-part" key={g.id}>
                  <span className="nxf-part__key" data-tone={g.tone} />
                  <span className="nxf-label">{g.title}</span>
                  <Secret className={g.total < 0 ? 'fin-num fin-negative' : 'fin-num'} label={g.title} value={money(Math.round(g.total))} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {live.length === 0 && (
        <section className="nxf-card">
          <div className="fin-empty fin-empty--tall">
            <p className="fin-empty__text">Add the accounts your money sits in: banks, cards, PPF, demat, gold.</p>
            <button type="button" className="fin-pill fin-pill--sm" onClick={() => ui.editAccount({ type: 'account' })}>
              Add the first one
            </button>
          </div>
        </section>
      )}

      {groups.map((g) => (
        <section className="nxf-section" key={g.id}>
          <div className="nxf-section__head">
            <h3>{g.title}</h3>
            <span className="fin-num">{g.accounts.length}</span>
          </div>
          <div className="nxf-accts">
            {g.accounts.map((a) => (
              <AccountCard key={a.id} account={a} />
            ))}
          </div>
        </section>
      ))}

      <section className="nxf-section">
        <div className="nxf-section__head">
          <h3>Ways to pay</h3>
          <p>Where a payment went through, and the account it really came out of.</p>
        </div>
        <div className="nxf-card nxf-methods">
          {methods.map(({ m, account, spent }) => (
            <button key={m.id} type="button" className="nxf-method" onClick={() => ui.openDetails({ type: 'method', id: m.id })}>
              <BrandMark brand={m.brand} fallback={m.name} size={32} />
              <span className="nxf-method__text">
                <span>
                  {m.name} <i>{METHOD_KIND[m.kind]}</i>
                </span>
                <span>
                  {account ? (
                    <>
                      <BrandMark brand={account.brand} fallback={account.name} size={13} />
                      {account.name}
                    </>
                  ) : (
                    'No account'
                  )}
                  {m.handle && ` · ${m.handle}`}
                </span>
              </span>
              <span className="nxf-method__end">
                <span className="fin-num">{spent > 0 ? money(Math.round(spent)) : '—'}</span>
                <ShareBar share={spent / methodPeak} />
              </span>
            </button>
          ))}
          <button type="button" className="nxf-method nxf-method--add" onClick={() => ui.editAccount({ type: 'method' })}>
            <span className="nxf-method__plus">
              <Plus size={16} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <span className="nxf-method__text">
              <span>Add a UPI app, card or wallet</span>
            </span>
          </button>
        </div>
        {methods.length > 0 && <p className="nxf-note">The figure is what went through each one this month.</p>}
      </section>

      {archived.length > 0 && (
        <details className="nxf-archived">
          <summary>Archived · {archived.length}</summary>
          <div className="nxf-card">
            <div className="nxf-rows">
              {archived.map((a) => (
                <ArchivedRow key={a.id} account={a} />
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
