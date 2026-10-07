/**
 * An account rendered as a wallet card.
 *
 * Two sizes from one component: the tall front card of the Overview wallet
 * stack, and the shorter card on Accounts & cards. The bottom row's ink is
 * DARK (`fin-ink`) on purpose — it sits on the bright band of the aurora.
 */
import type { Account } from '../types';
import { useFinance } from '../FinanceContext';
import { KIND_LABEL, accountFlow, balanceOf, balanceTrend, inr, monthPeriod, needsBalance } from '../ledger';
import { masked, money, moneyIn } from '../format';
import { AuroraLayers, auroraClass } from './Aurora';
import { BrandMark } from './BrandMark';
import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Sparkline } from './Charts';
import { Secret } from './Secret';

export function AccountCard({
  account,
  variant,
  onOpen,
  onSetBalance,
}: {
  account: Account;
  variant: 'front' | 'grid';
  onOpen?: () => void;
  onSetBalance?: () => void;
}) {
  const { data } = useFinance();
  const grid = variant === 'grid';
  const balance = balanceOf(data, account.id);
  const flow = accountFlow(data, account.id, monthPeriod());
  const empty = needsBalance(data, account);
  const trend = balanceTrend(data, account.id);
  const flat = trend.every((v) => v === trend[0]);
  const foreign = account.currency !== 'INR';
  const cardLabel = account.card ? `${account.card.type === 'forex' ? 'Forex' : account.card.type === 'credit' ? 'Credit' : 'Debit'} card` : KIND_LABEL[account.kind];

  const isPhysical = !!account.card;
  const classes = [
    auroraClass(account.hue ?? 'blue', grid ? 'fin-acct--grid' : 'fin-wallet__front'),
    isPhysical ? 'fin-acct--physical' : 'fin-acct--digital'
  ].join(' ');

  return (
    <div
      className={classes}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => onOpen && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      aria-label={onOpen ? `${account.name}, ${moneyIn(balance, account.currency)}` : undefined}
    >
      <AuroraLayers />
      <div className="fin-aurora__body">
        <div className="fin-acct__top">
          <BrandMark brand={account.brand} fallback={account.name} size={grid ? 24 : 26} className="fin-acct__brand" />
          <div className="fin-acct__id">
            <span className="fin-acct__name">{account.name}</span>
            {empty ? (
              <span className="fin-acct__balance fin-acct__balance--empty">Balance not set</span>
            ) : (
              <Secret className="fin-acct__balance fin-num fin-num--lg" label={`${account.name} balance`} value={moneyIn(balance, account.currency)} />
            )}
            {foreign && !empty && <span className="fin-acct__fx fin-num">≈ {money(inr(account, balance))}</span>}
          </div>
          <span className="fin-acct__tail">
            {account.card?.network && <BrandMark brand={account.card.network} size={grid ? 22 : 24} className="fin-acct__network" />}
            {account.card?.last4 ? masked(account.card.last4) : account.last4 ? masked(account.last4) : null}
          </span>
        </div>

        <div className="fin-acct__foot fin-ink">
          {empty ? (
            <>
              <div className="fin-acct__flow">
                <span>{KIND_LABEL[account.kind]}</span>
                <span>{account.card && account.kind !== 'forex' ? cardLabel : account.currency}</span>
              </div>
              {onSetBalance && (
                <button
                  type="button"
                  className="fin-acct__action"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetBalance();
                  }}
                >
                  Set balance
                </button>
              )}
            </>
          ) : (
            <>
              <div className="fin-acct__flow">
                <span>In · {grid ? 'month' : 'this month'}</span>
                <span className="fin-num">{moneyIn(flow.in, account.currency, { signed: flow.in > 0 })}</span>
              </div>
              <div className="fin-acct__flow">
                <span>Out</span>
                <span className="fin-num">{moneyIn(-flow.out, account.currency)}</span>
              </div>
              {/* A standing instruction is set up from the account's details, not here. */}
              {!flat && (
                <Sparkline values={trend} stroke="currentColor" width={grid ? 76 : 92} height={grid ? 26 : 30} strokeWidth={grid ? 1.7 : 1.8} className="" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The Overview wallet: a bouncy scrollable stack of cards driven by framer-motion.
 */
export function WalletStack({
  accounts,
  activeId,
  onSelect,
  onOpen,
  wheelZone,
}: {
  accounts: Account[];
  activeId: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  /** The element whose wheel the stack takes over; the stack itself when absent. */
  wheelZone?: React.RefObject<HTMLElement | null>;
}) {
  const index = Math.max(0, accounts.findIndex((a) => a.id === activeId));
  const active = accounts[index];
  const ref = useRef<HTMLDivElement>(null);
  // Read by the wheel listener, so it is not torn down on every flip. It used
  // to be, which reset its "one flip at a time" lock mid-scroll.
  const live = useRef({ accounts, index, onSelect });
  live.current = { accounts, index, onSelect };

  useEffect(() => {
    // The cards area (heading included, when the page passes it in) takes the
    // wheel while there is another card to reach, and hands whole gestures to
    // the page once there is not — the way nested scrollers latch on macOS.
    // The owner is decided on a gesture's FIRST event and kept until the
    // fingers stop. Deciding per event made the stack and the page fight
    // mid-flick; never handing over at all left the area unscrollable.
    const zone = wheelZone?.current ?? ref.current;
    if (!zone) return;

    const GAP = 200; // ms of quiet that ends a gesture
    const STEP = 42; // px of travel per card
    let lastAt = 0;
    let travel = 0;
    let mine = false;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch zoom
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      // Sideways trackpad swipes flip too.
      const delta = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
      if (delta === 0) return;

      const now = performance.now();
      if (now - lastAt > GAP) {
        travel = 0;
        const { accounts: list, index: at } = live.current;
        // A scroll the page had already started arrives uncancelable: it stays
        // with the page.
        mine = e.cancelable && list.length > 1 && (delta > 0 ? at < list.length - 1 : at > 0);
      }
      lastAt = now;
      if (!mine) return;
      e.preventDefault();

      // A long swipe walks through several cards, one per STEP, instead of
      // flipping once and then swallowing the rest of the gesture.
      travel += delta;
      while (Math.abs(travel) >= STEP) {
        const step = travel > 0 ? 1 : -1;
        travel -= step * STEP;
        const { accounts: list, index: at, onSelect: select } = live.current;
        const next = at + step;
        if (next < 0 || next >= list.length) {
          travel = 0;
          break;
        }
        select(list[next].id);
        // The flip has not re-rendered yet; keep the next step in this same
        // gesture counting from where the stack now is.
        live.current = { ...live.current, index: next };
      }
    };

    zone.addEventListener('wheel', onWheel, { passive: false });
    return () => zone.removeEventListener('wheel', onWheel);
  }, [wheelZone]);

  if (!active) return null;

  return (
    <div
      className="fin-wallet"
      ref={ref}
      style={{ position: 'relative' }}
      // The wheel was the only way to reach the cards behind; arrows do it from the keyboard.
      onKeyDown={(e) => {
        const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        const next = index + step;
        if (next < 0 || next >= accounts.length) return;
        e.preventDefault();
        onSelect(accounts[next].id);
      }}
    >
      {accounts.map((a, i) => {
        const offset = (i - index + accounts.length) % accounts.length;
        const isBack = offset > 2;
        
        const zIndex = accounts.length - offset;
        const scale = isBack ? 0.85 : 1 - (offset * 0.04);
        const y = isBack ? -55 : offset * -20;
        const blur = isBack ? 8 : offset * 2;
        const opacity = isBack ? 0 : 1 - (offset * 0.1);
        const pointerEvents = offset === 0 ? 'auto' : 'none';

        // A spring with a little give, because a wheel flick carries momentum —
        // from the arrow keys too.
        return (
          <motion.div
            key={a.id}
            initial={false}
            animate={{ transform: `translateY(${y}px) scale(${scale})`, opacity, filter: `blur(${blur}px)`, zIndex }}
            transition={{ type: 'spring', duration: 0.45, bounce: 0.12 }}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', pointerEvents }}
          >
            <AccountCard account={a} variant="front" onOpen={() => offset === 0 && onOpen(a.id)} />
          </motion.div>
        );
      })}

      {/* Which card of how many, and a way to reach one without the wheel. */}
      {accounts.length > 1 && (
        <div className="fin-wallet__dots">
          {accounts.map((a, i) => (
            <button key={a.id} type="button" aria-current={i === index} aria-label={`Show ${a.name}`} onClick={() => onSelect(a.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
