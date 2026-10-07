/**
 * Accounts & cards.
 *
 * Three layers, in the order money actually moves:
 *   1. wallet cards — accounts promoted to a full aurora card (the ones you
 *      tap or swipe: SBI and ICICI debit, the forex card, the demat)
 *   2. everything else that holds money, as a hairline list
 *   3. payment apps and methods — GPay, WhatsApp Pay, POP, PayPal, Link —
 *      each showing which account it really debits
 */
import { Plus } from 'lucide-react';
import { useFinance } from '../FinanceContext';
import { useFinanceUi } from '../ui';
import type { Account } from '../types';
import * as L from '../ledger';
import { money, moneyIn } from '../format';
import { AccountCard } from '../components/AccountCard';
import { BrandMark } from '../components/BrandMark';

const METHOD_KIND = { upi: 'UPI', card: 'Card', wallet: 'Wallet' } as const;

export default function Accounts() {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const month = L.monthPeriod();
  const live = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);
  const physicalCards = live.filter((a) => a.card);
  const digitalCards = live.filter((a) => !a.card && a.hue);
  const rest = live.filter((a) => !a.hue);
  const nw = L.netWorth(data);

  return (
    <div className="fin-page">
      <header className="fin-page__head">
        <div className="fin-page__lead">
          <h2>Accounts &amp; cards</h2>
          <p>
            {live.length} accounts · {data.methods.length} ways to pay · {money(nw.cash)} in cash, {money(nw.invested)} invested
            {nw.debt !== 0 && `, ${money(Math.abs(nw.debt))} owed`}
          </p>
        </div>
        <div className="fin-page__actions">
          <button type="button" className="fin-pill fin-pill--outline" onClick={() => ui.importStatement()}>
            Import statement
          </button>
          <button type="button" className="fin-pill fin-pill--action" onClick={() => ui.editAccount({ type: 'account' })}>
            Add account
          </button>
        </div>
      </header>

      {(physicalCards.length > 0 || digitalCards.length > 0) && (
        <div className="fin-accounts__layout">
          {physicalCards.length > 0 && (
            <div className="fin-accounts__stack">
              {physicalCards.map((a) => (
                <AccountCard key={a.id} account={a} variant="grid" onOpen={() => ui.openDetails({ type: 'account', id: a.id })} onSetBalance={() => ui.editAccount({ type: 'account', id: a.id })} />
              ))}
            </div>
          )}

          {digitalCards.length > 0 && (
            <div className="fin-accounts__grid">
              {digitalCards.map((a) => (
                <AccountCard key={a.id} account={a} variant="grid" onOpen={() => ui.openDetails({ type: 'account', id: a.id })} onSetBalance={() => ui.editAccount({ type: 'account', id: a.id })} />
              ))}
            </div>
          )}
        </div>
      )}

      {rest.length > 0 && <AccountList title="Savings & investments" accounts={rest} />}

      <section className="fin-accounts__section">
        <div className="fin-section__head">
          <h3>Payment apps &amp; methods</h3>
          <p>Where a payment went through, and the account it really came out of.</p>
        </div>
        <div className="fin-methods">
          {data.methods.map((m) => {
            const account = L.accountById(data, m.accountId);
            const spent = L.spentVia(data, m.id, month);
            return (
              <button key={m.id} type="button" className="fin-methodtile" onClick={() => ui.openDetails({ type: 'method', id: m.id })}>
                <div className="fin-methodtile__top">
                  <BrandMark brand={m.brand} fallback={m.name} size={34} />
                  <span className="fin-methodtile__kind">{METHOD_KIND[m.kind]}</span>
                </div>
                <span className="fin-methodtile__name">{m.name}</span>
                <span className="fin-methodtile__from">
                  {account ? (
                    <>
                      <BrandMark brand={account.brand} fallback={account.name} size={14} />
                      {account.name}
                    </>
                  ) : (
                    'No account'
                  )}
                </span>
                <span className="fin-methodtile__spent fin-num">{spent > 0 ? `${money(spent)} this month` : m.handle ?? 'Nothing this month'}</span>
              </button>
            );
          })}
          <button type="button" className="fin-methodtile fin-methodtile--add" onClick={() => ui.editAccount({ type: 'method' })}>
            <Plus size={18} strokeWidth={1.6} />
            <span>Add a UPI app, card or wallet</span>
          </button>
        </div>
      </section>

      {archived.length > 0 && (
        <details className="fin-archived">
          <summary>Archived · {archived.length}</summary>
          <AccountList title="" accounts={archived} />
        </details>
      )}
    </div>
  );
}

function AccountList({ title, accounts }: { title: string; accounts: Account[] }) {
  const { data } = useFinance();
  const ui = useFinanceUi();
  const month = L.monthPeriod();

  return (
    <section className="fin-accounts__section">
      {title && (
        <div className="fin-section__head">
          <h3>{title}</h3>
        </div>
      )}
      <div className="fin-accounts__list">
        <div className="fin-arow fin-arow--head">
          <span>Account</span>
          <span>Type</span>
          <span>This month</span>
          <span style={{ textAlign: 'right' }}>Balance</span>
        </div>
        {accounts.map((a) => {
          const balance = L.balanceOf(data, a.id);
          const flow = L.accountFlow(data, a.id, month);
          const empty = L.needsBalance(data, a);
          return (
            <button type="button" className="fin-arow fin-arow--button" key={a.id} onClick={() => ui.openDetails({ type: 'account', id: a.id })}>
              <div className="fin-arow__name">
                <BrandMark brand={a.brand} fallback={a.name} size={30} />
                <span>{a.name}</span>
              </div>
              <span className="fin-arow__kind">{L.KIND_LABEL[a.kind]}</span>
              <span className="fin-arow__synced">
                {flow.in || flow.out ? `+${moneyIn(flow.in, a.currency, { bare: false })} · ${moneyIn(-flow.out, a.currency)}` : '—'}
              </span>
              <span className={balance < 0 ? 'fin-arow__balance fin-num fin-negative' : 'fin-arow__balance fin-num'}>
                {empty ? <span className="fin-link">Set balance</span> : moneyIn(balance, a.currency)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
