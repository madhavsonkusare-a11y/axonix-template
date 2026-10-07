/**
 * Derived figures. Every number on a finance screen comes from here.
 *
 * Pure functions over `FinanceData` — no React, no storage. The previous
 * implementation had two drifting copies of these helpers (in `data.ts` and
 * `repo.ts`); this is the only one now.
 *
 * Money crosses currencies exactly once, in `inr()`, using the rate typed into
 * the account. Transfers and balance checkpoints move money between buckets
 * but are never income or spending, so every flow figure filters on `isFlow`.
 */
import type { Account, AccountKind, FinanceData, Frequency, PaymentMethod, StandingInstruction, Subscription, Transaction } from './types';
import { addDays, dateOf, daysBetween, isoOf, shortDate, todayIso } from './format';

/* ------------------------------------------------------------------ */
/* classification                                                      */
/* ------------------------------------------------------------------ */

export const isFlow = (t: Transaction) => t.kind === 'expense' || t.kind === 'income';
export const isLiability = (a: Account) => a.kind === 'credit' || a.kind === 'loan';

const INVESTED: AccountKind[] = ['provident', 'demat', 'gold', 'deposit'];
export const isInvested = (a: Account) => INVESTED.includes(a.kind);

export const KIND_LABEL: Record<AccountKind, string> = {
  savings: 'Savings', salary: 'Salary', current: 'Current',
  provident: 'Provident fund', demat: 'Demat', gold: 'Digital gold', deposit: 'Fixed deposit',
  forex: 'Forex card', wallet: 'Wallet', cash: 'Cash',
  credit: 'Credit card', loan: 'Loan',
};

export type AccountGroup = 'banks' | 'investments' | 'travel' | 'liabilities';

export function groupOf(a: Account): AccountGroup {
  if (isLiability(a)) return 'liabilities';
  if (isInvested(a)) return 'investments';
  if (a.kind === 'forex') return 'travel';
  return 'banks';
}

/** Ordering key for entries on one account: day first, then entry time. */
const order = (a: Transaction, b: Transaction) =>
  a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date);

const isAfter = (t: Transaction, anchor: Transaction) =>
  t.date > anchor.date || (t.date === anchor.date && t.createdAt > anchor.createdAt);

/* ------------------------------------------------------------------ */
/* index                                                               */
/*                                                                     */
/* Built once per data object and cached: the net-worth chart asks for */
/* every account's balance at ~50 dates, which is quadratic otherwise. */
/* ------------------------------------------------------------------ */

interface Move { t: Transaction; delta: number }

interface Index {
  accounts: Map<string, Account>;
  methods: Map<string, PaymentMethod>;
  moves: Map<string, Move[]>;
  checkpoints: Map<string, Transaction[]>;
}

const cache = new WeakMap<FinanceData, Index>();

function index(data: FinanceData): Index {
  const hit = cache.get(data);
  if (hit) return hit;

  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const methods = new Map(data.methods.map((m) => [m.id, m]));
  const moves = new Map<string, Move[]>();
  const checkpoints = new Map<string, Transaction[]>();
  const push = <T,>(map: Map<string, T[]>, key: string, v: T) => {
    const list = map.get(key);
    if (list) list.push(v);
    else map.set(key, [v]);
  };

  for (const t of data.transactions) {
    if (t.kind === 'adjustment') {
      push(checkpoints, t.accountId, t);
      continue;
    }
    push(moves, t.accountId, { t, delta: t.amount });
    if (t.kind === 'transfer' && t.toAccountId) {
      push(moves, t.toAccountId, { t, delta: t.toAmount ?? Math.abs(t.amount) });
    }
  }
  for (const list of moves.values()) list.sort((a, b) => order(a.t, b.t));
  for (const list of checkpoints.values()) list.sort(order);

  const built = { accounts, methods, moves, checkpoints };
  cache.set(data, built);
  return built;
}

export const accountById = (data: FinanceData, id?: string) => (id ? index(data).accounts.get(id) : undefined);
export const methodById = (data: FinanceData, id?: string) => (id ? index(data).methods.get(id) : undefined);

/* ------------------------------------------------------------------ */
/* balances                                                            */
/* ------------------------------------------------------------------ */

/**
 * Balance in the account's own currency, at the end of `at` (default: now).
 *
 * The latest checkpoint on or before `at` anchors it, plus every later
 * movement. Before the first checkpoint the balance is walked BACK from it,
 * so an imported statement older than the day the balance was set still draws
 * a correct history instead of starting from zero.
 */
export function balanceOf(data: FinanceData, accountId: string, at?: string): number {
  const { moves, checkpoints } = index(data);
  const list = moves.get(accountId) ?? [];
  const cps = checkpoints.get(accountId) ?? [];
  const inRange = (t: Transaction) => !at || t.date <= at;

  let anchor: Transaction | undefined;
  for (const cp of cps) if (inRange(cp)) anchor = cp;

  if (anchor) {
    let sum = anchor.balanceAfter ?? 0;
    for (const m of list) if (inRange(m.t) && isAfter(m.t, anchor)) sum += m.delta;
    return sum;
  }

  const first = cps[0];
  if (first && at) {
    let sum = first.balanceAfter ?? 0;
    for (const m of list) if (m.t.date > at && !isAfter(m.t, first)) sum -= m.delta;
    return sum;
  }

  let sum = 0;
  for (const m of list) if (inRange(m.t)) sum += m.delta;
  return sum;
}

/**
 * Balance on `accountId` right after `t`, in the account's currency, or
 * undefined when `t` does not touch that account.
 *
 * Same rules as `balanceOf`, but cut at the transaction rather than at the end
 * of its day, so each of several payments on one day shows its own figure.
 * Entries that share a timestamp (a statement's rows all import at the start
 * of their day) keep the order they were saved in.
 */
export function balanceAfter(data: FinanceData, accountId: string, t: Transaction): number | undefined {
  const { moves, checkpoints } = index(data);
  const list = moves.get(accountId) ?? [];
  const at = list.findIndex((m) => m.t === t);
  if (at < 0) return undefined;
  const cps = checkpoints.get(accountId) ?? [];

  let anchor: Transaction | undefined;
  for (const cp of cps) if (!isAfter(cp, t)) anchor = cp;
  if (anchor) {
    let sum = anchor.balanceAfter ?? 0;
    for (let i = 0; i <= at; i++) if (isAfter(list[i].t, anchor)) sum += list[i].delta;
    return sum;
  }

  const first = cps[0];
  if (first) {
    // The balance was set later: walk back from it.
    let sum = first.balanceAfter ?? 0;
    for (let i = at + 1; i < list.length; i++) if (!isAfter(list[i].t, first)) sum -= list[i].delta;
    return sum;
  }

  let sum = 0;
  for (let i = 0; i <= at; i++) sum += list[i].delta;
  return sum;
}

/**
 * Newest-first order for lists: the exact reverse of the order balances are
 * counted in. Entries sharing a timestamp (a statement's rows) fall back to
 * reverse save order; comparing timestamps alone left their order arbitrary,
 * so reading down a day the "balance after" figures did not step in sequence.
 */
export function newestFirst(data: FinanceData): (a: Transaction, b: Transaction) => number {
  const saved = new Map(data.transactions.map((t, i) => [t, i]));
  return (a, b) =>
    a.date !== b.date ? b.date.localeCompare(a.date) : a.createdAt !== b.createdAt ? b.createdAt.localeCompare(a.createdAt) : (saved.get(b) ?? 0) - (saved.get(a) ?? 0);
}

/** Whether a balance was ever set on the account — without one, figures are relative to zero. */
export const hasBalance = (data: FinanceData, accountId: string) => (index(data).checkpoints.get(accountId)?.length ?? 0) > 0;

/** Any amount on `account`, in rupees. A forex balance without a rate counts as zero. */
export function inr(account: Account | undefined, amount: number): number {
  if (!account || account.currency === 'INR') return amount;
  return amount * (account.fxRate ?? 0);
}

export const balanceInr = (data: FinanceData, a: Account, at?: string) => inr(a, balanceOf(data, a.id, at));

/** The most recent balance checkpoint on an account. */
export const lastCheckpoint = (data: FinanceData, accountId: string): Transaction | undefined => {
  const cps = index(data).checkpoints.get(accountId);
  return cps?.[cps.length - 1];
};

/** `true` until the owner has told us what is in the account. */
export const needsBalance = (data: FinanceData, a: Account) =>
  !(index(data).checkpoints.get(a.id)?.length) && !(index(data).moves.get(a.id)?.length);

export interface NetWorth { total: number; invested: number; cash: number; debt: number }

export function netWorth(data: FinanceData, at?: string): NetWorth {
  let invested = 0, cash = 0, debt = 0;
  for (const a of data.accounts) {
    const v = balanceInr(data, a, at);
    if (isLiability(a)) debt += v;
    else if (isInvested(a)) invested += v;
    else cash += v;
  }
  return { total: invested + cash + debt, invested, cash, debt };
}

/* ------------------------------------------------------------------ */
/* net-worth history                                                   */
/* ------------------------------------------------------------------ */

export type TimeRange = '1W' | '1M' | '6M' | '1Y' | 'All';
export const TIME_RANGES: TimeRange[] = ['1W', '1M', '6M', '1Y', 'All'];

export interface Series {
  values: number[];
  ticks: string[];
  start: number;
  end: number;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function earliestDate(data: FinanceData): string | undefined {
  let min: string | undefined;
  for (const t of data.transactions) if (!min || t.date < min) min = t.date;
  return min;
}

export function netWorthSeries(data: FinanceData, range: TimeRange, today = todayIso()): Series {
  // A week is the last seven days including today: one point per day.
  const span = { '1W': 6, '1M': 30, '6M': 182, '1Y': 365, All: 0 }[range];
  const first = earliestDate(data) ?? today;
  const start = range === 'All' ? first : addDays(today, -span);
  const days = Math.max(1, daysBetween(start, today));
  const count = Math.min(48, days + 1);

  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = addDays(start, Math.round((i / (count - 1 || 1)) * days));
    values.push(netWorth(data, at).total);
  }

  const ticks: string[] = [];
  if (range === '1W') {
    // One label per day, under its own point: seven even steps, so evenly
    // spaced labels land exactly on them. Six labels would skip days.
    for (let i = 0; i <= days; i++) {
      const d = dateOf(addDays(start, i));
      ticks.push(`${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}`);
    }
    return { values, ticks, start: values[0] ?? 0, end: values[values.length - 1] ?? 0 };
  }
  // Otherwise six evenly spaced labels — the design's tick row. Up to about
  // seven months they are dates: month names at even spacing skipped a month
  // on 6M (MAR APR MAY JUL AUG SEP), which read as missing data.
  for (let i = 0; i < 6; i++) {
    const d = dateOf(addDays(start, Math.round((i / 5) * days)));
    ticks.push(days <= 220 ? shortDate(isoOf(d)) : range === 'All' && days > 730 ? String(d.getFullYear()) : MONTHS[d.getMonth()]);
  }

  return { values, ticks, start: values[0] ?? 0, end: values[values.length - 1] ?? 0 };
}

/** Scale a series into the hero chart's fixed 980x196 viewBox. */
export function chartPoints(values: number[], width = 980, height = 196, top = 38, bottom = 12): [number, number][] {
  if (values.length === 0) return [[0, height - bottom], [width, height - bottom]];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v, i) => [
    values.length === 1 ? width : (i / (values.length - 1)) * width,
    // A flat series sits low, where a baseline reads as "nothing yet" rather than a level.
    max === min ? height * 0.72 : top + (1 - (v - min) / span) * (height - top - bottom),
  ]);
}

/** 0-1 normalised, for sparklines. */
export function normalise(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((v) => (max === min ? 0.5 : (v - min) / (max - min)));
}

/* ------------------------------------------------------------------ */
/* periods + flows                                                     */
/* ------------------------------------------------------------------ */

export type SpendRange = 'WEEK' | 'MONTH' | 'YEAR';
export interface Period { start: string; end: string }

export function periodOf(range: SpendRange, today = todayIso()): Period {
  const d = dateOf(today);
  if (range === 'WEEK') {
    const monday = (d.getDay() + 6) % 7;
    return { start: addDays(today, -monday), end: today };
  }
  if (range === 'MONTH') return { start: `${today.slice(0, 7)}-01`, end: today };
  return { start: `${today.slice(0, 4)}-01-01`, end: today };
}

export const monthPeriod = (today = todayIso()) => periodOf('MONTH', today);

/** The same span, one step back — last week / last month / last year to date. */
export function previousPeriod(range: SpendRange, today = todayIso()): Period {
  const cur = periodOf(range, today);
  if (range === 'WEEK') return { start: addDays(cur.start, -7), end: addDays(today, -7) };
  const d = dateOf(today);
  if (range === 'MONTH') {
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
    return { start: isoOf(prev), end: isoOf(new Date(prev.getFullYear(), prev.getMonth(), Math.min(d.getDate(), last))) };
  }
  return { start: `${d.getFullYear() - 1}-01-01`, end: `${d.getFullYear() - 1}${today.slice(4)}` };
}

const within = (t: Transaction, p: Period) => t.date >= p.start && t.date <= p.end;

/** Calendar days in a period, both ends included. */
export const daysInPeriod = (p: Period) => Math.max(1, daysBetween(p.start, p.end) + 1);

export interface Flow { in: number; out: number; net: number; count: number }

export function flowOf(data: FinanceData, p: Period, filter?: (t: Transaction) => boolean): Flow {
  const { accounts } = index(data);
  let income = 0, out = 0, count = 0;
  for (const t of data.transactions) {
    if (!isFlow(t) || !within(t, p) || (filter && !filter(t))) continue;
    const v = inr(accounts.get(t.accountId), t.amount);
    // An expense with a positive amount is a refund against that category:
    // it reduces spending rather than counting as income.
    if (t.kind === 'income') income += v;
    else out -= v;
    count++;
  }
  return { in: income, out, net: income - out, count };
}

export interface MonthFlow { month: string; in: number; out: number }

export function monthlySeries(data: FinanceData, months = 6, today = todayIso()): MonthFlow[] {
  const d = dateOf(today);
  const result: MonthFlow[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const first = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const f = flowOf(data, { start: isoOf(first), end: isoOf(last) });
    result.push({ month: MONTHS[first.getMonth()], in: f.in, out: f.out });
  }
  return result;
}

export interface CategoryTotal { label: string; amount: number; color: string }

const NEUTRAL = 'rgba(255,255,255,.32)';

/** Spending by category, largest first, folded to `limit` rows plus "Everything else". */
export function categoryTotals(data: FinanceData, p: Period, limit = 4): CategoryTotal[] {
  const { accounts } = index(data);
  const totals = new Map<string, number>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || !within(t, p)) continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) - inr(accounts.get(t.accountId), t.amount));
  }
  const color = new Map(data.categories.map((c) => [c.name, c.color]));
  const rows = [...totals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, amount]) => ({ label, amount, color: color.get(label) ?? NEUTRAL }));

  const head = rows.filter((r) => r.label !== 'Everything else').slice(0, limit);
  const rest = rows.filter((r) => !head.includes(r)).reduce((s, r) => s + r.amount, 0);
  return rest > 0 ? [...head, { label: 'Everything else', amount: rest, color: NEUTRAL }] : head;
}

export function spentIn(data: FinanceData, category: string, p: Period): number {
  return flowOf(data, p, (t) => t.kind === 'expense' && t.category === category).out;
}

export function topMerchants(data: FinanceData, p: Period, limit = 5): { name: string; amount: number; count: number }[] {
  const { accounts } = index(data);
  const totals = new Map<string, { name: string; amount: number; count: number }>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || !within(t, p)) continue;
    const key = t.merchant.trim().toLowerCase();
    const row = totals.get(key) ?? { name: t.merchant.trim(), amount: 0, count: 0 };
    row.amount -= inr(accounts.get(t.accountId), t.amount);
    row.count++;
    totals.set(key, row);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** Spending per weekday, Monday first. */
export function byWeekday(data: FinanceData, p: Period): { day: string; amount: number }[] {
  const { accounts } = index(data);
  const sums = new Array(7).fill(0);
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || !within(t, p)) continue;
    sums[(dateOf(t.date).getDay() + 6) % 7] -= inr(accounts.get(t.accountId), t.amount);
  }
  return ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => ({ day, amount: Math.max(0, sums[i]) }));
}

/** Money that left through one payment method in a period. */
export function spentVia(data: FinanceData, methodId: string, p: Period): number {
  return flowOf(data, p, (t) => t.methodId === methodId).out;
}

export function accountFlow(data: FinanceData, accountId: string, p: Period): { in: number; out: number } {
  const list = index(data).moves.get(accountId) ?? [];
  let income = 0, out = 0;
  for (const m of list) {
    if (!within(m.t, p)) continue;
    if (m.delta > 0) income += m.delta;
    else out -= m.delta;
  }
  return { in: income, out };
}

/** Balance over the last `days`, for an on-card sparkline. */
export function balanceTrend(data: FinanceData, accountId: string, days = 30, points = 8, today = todayIso()): number[] {
  const values: number[] = [];
  for (let i = 0; i < points; i++) {
    values.push(balanceOf(data, accountId, addDays(today, -Math.round(days * (1 - i / (points - 1))))));
  }
  return normalise(values);
}

/* ------------------------------------------------------------------ */
/* review queue, budgets, subscriptions, forecast                      */
/* ------------------------------------------------------------------ */

export const needsReview = (data: FinanceData) => data.transactions.filter((t) => t.autoCategorized);

export function overLimit(data: FinanceData, p = monthPeriod()): number {
  return data.budgets.filter((b) => spentIn(data, b.category, p) > b.limit).length;
}

/* subscriptions ---------------------------------------------------- */

/** Subscriptions saved before frequencies existed were all monthly. */
export const subFrequency = (s: Subscription): Frequency => s.frequency ?? 'monthly';

/** What a subscription costs per month on average: a ₹1,200 yearly plan is ₹100. */
export const monthlyCost = (s: Subscription) => s.amount / FREQUENCY_MONTHS[subFrequency(s)];

export const subscriptionsMonthly = (data: FinanceData) => data.subscriptions.reduce((sum, s) => sum + monthlyCost(s), 0);

/** The next charge on or after today — derived, so it never goes stale. */
export const nextCharge = (s: Subscription, today = todayIso()) => nextDue(s.nextCharge, subFrequency(s), today);

/** The most recent charge date that has arrived, if any. */
export const lastCharge = (s: Subscription, today = todayIso()) => lastDue(s.nextCharge, subFrequency(s), today);

/**
 * The expense that paid the current cycle, if the owner recorded one: same
 * name as the merchant, dated from a few days before the charge date on.
 */
export function paidThisCycle(data: FinanceData, s: Subscription, today = todayIso()): Transaction | undefined {
  const due = lastCharge(s, today);
  if (!due) return undefined;
  const from = addDays(due, -3);
  const key = normaliseMerchant(s.name);
  let best: Transaction | undefined;
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.date < from || normaliseMerchant(t.merchant) !== key) continue;
    if (!best || t.date > best.date) best = t;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* standing instructions                                               */
/* ------------------------------------------------------------------ */

export const FREQUENCY_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };
export const SI_MONTHS = FREQUENCY_MONTHS;

/**
 * Accounts that take a standing instruction: PPF and deposits (RDs). EPF is
 * excluded — it is funded by payroll deduction, not by a bank SI.
 */
export const takesSi = (a: Account) => (a.kind === 'provident' || a.kind === 'deposit') && a.brand !== 'epfo';

/**
 * The first debit on or after `today`. Steps from the anchor in whole months,
 * keeping its day — clamped to short months, so a 31st SI lands on 30 Sep and
 * goes back to 31 Oct rather than drifting to the 30th for good.
 */
export function nextDue(anchor: string, frequency: Frequency, today = todayIso()): string {
  const { at, k } = scheduleCursor(anchor, frequency, today);
  return at(k);
}

/** The most recent date on the schedule on or before `today`, or undefined if the first is still ahead. */
export function lastDue(anchor: string, frequency: Frequency, today = todayIso()): string | undefined {
  const { at, k } = scheduleCursor(anchor, frequency, today);
  if (at(k) === today) return today;
  return k > 0 ? at(k - 1) : undefined;
}

export const nextSiDate = (si: StandingInstruction, today = todayIso()) => nextDue(si.anchorDate, si.frequency, today);
export const lastSiDate = (si: StandingInstruction, today = todayIso()) => lastDue(si.anchorDate, si.frequency, today);

/** `at(k)` is the k-th date from the anchor; `k` is the first one on or after `today`. */
function scheduleCursor(anchor: string, frequency: Frequency, today: string) {
  const [y, m, d] = anchor.split('-').map(Number);
  const step = FREQUENCY_MONTHS[frequency];
  const at = (k: number) => {
    const month = m - 1 + k * step;
    const last = new Date(y, month + 1, 0).getDate();
    return isoOf(new Date(y, month, Math.min(d, last)));
  };
  // Jump near today, then walk: an anchor years back costs a handful of steps.
  const monthsAway = (Number(today.slice(0, 4)) - y) * 12 + (Number(today.slice(5, 7)) - m);
  let k = Math.max(0, Math.floor(monthsAway / step) - 1);
  while (at(k) < today) k++;
  return { at, k };
}

export interface Forecast { amount: number; change: number; points: [number, number][]; projectedFrom: number; basisDays: number }

/**
 * Month-end projection from the trailing daily average net flow.
 *
 * Returns `null` without 45 days of history: a projection built on a week of
 * data is a guess wearing a number's clothes.
 */
export function forecast(data: FinanceData, today = todayIso()): Forecast | null {
  const first = earliestDate(data);
  if (!first) return null;
  const history = daysBetween(first, today);
  if (history < 45) return null;

  const basisDays = Math.min(90, history);
  const f = flowOf(data, { start: addDays(today, -basisDays), end: today });
  const perDay = f.net / basisDays;

  const d = dateOf(today);
  const monthEnd = isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const left = daysBetween(today, monthEnd);
  const now = netWorth(data, today).total;
  const amount = now + perDay * left;

  const pastDays = 14;
  const values: number[] = [];
  for (let i = pastDays; i >= 1; i -= 2) values.push(netWorth(data, addDays(today, -i)).total);
  values.push(now);
  const projectedFrom = values.length - 1;
  const steps = Math.max(1, Math.round(left / 4));
  for (let i = 1; i <= steps; i++) values.push(now + perDay * (left * (i / steps)));

  return {
    amount,
    change: amount - now,
    points: chartPoints(values, 300, 50, 6, 6),
    projectedFrom,
    basisDays,
  };
}

/* ------------------------------------------------------------------ */
/* categorisation memory                                               */
/* ------------------------------------------------------------------ */

const normaliseMerchant = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The category the owner last CONFIRMED for this merchant, if any. */
export function learnedCategory(data: FinanceData, merchant: string): string | undefined {
  const key = normaliseMerchant(merchant);
  if (!key) return undefined;
  let best: Transaction | undefined;
  for (const t of data.transactions) {
    if (t.autoCategorized || !isFlow(t) || normaliseMerchant(t.merchant) !== key) continue;
    if (!best || order(best, t) < 0) best = t;
  }
  return best?.category;
}

/** Merchants seen before, most frequent first — the payee autocomplete. */
export function knownMerchants(data: FinanceData, limit = 60): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const t of data.transactions) {
    if (!isFlow(t)) continue;
    const key = normaliseMerchant(t.merchant);
    if (!key) continue;
    const row = counts.get(key) ?? { name: t.merchant.trim(), n: 0 };
    row.n++;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((r) => r.name);
}
