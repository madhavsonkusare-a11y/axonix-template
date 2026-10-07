/**
 * Figures the new Finance screens need on top of `finance/ledger.ts`.
 *
 * Pure functions over `FinanceData`, like the ledger: no React, no storage,
 * nothing written. Money still crosses currencies only through `L.inr`.
 */
import type { Account, BrandId, FinanceData, Frequency } from '../../finance/types';
import * as L from '../../finance/ledger';
import { MINUS, addDays, dateOf, daysBetween, isoOf, todayIso } from '../../finance/format';

/** `₹4.8L`, `₹36K`, `₹640` — for chart axes, where a full figure will not fit. */
export function compactInr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : '';
  const trim = (n: number) => (n >= 100 || n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1));
  if (abs >= 10_000_000) return `${sign}₹${trim(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${sign}₹${trim(abs / 100_000)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

/** The date behind each value of `L.netWorthSeries`, point for point. */
export function seriesDates(data: FinanceData, range: L.TimeRange, today = todayIso()): string[] {
  const span = { '1W': 6, '1M': 30, '6M': 182, '1Y': 365, All: 0 }[range];
  const first = L.earliestDate(data) ?? today;
  const start = range === 'All' ? first : addDays(today, -span);
  const days = Math.max(1, daysBetween(start, today));
  const count = Math.min(48, days + 1);
  return Array.from({ length: count }, (_, i) => addDays(start, Math.round((i / (count - 1 || 1)) * days)));
}

export interface DaySpend {
  date: string;
  amount: number;
}

/** Spending on each calendar day of a period. A refund lowers its day. */
export function dailySpend(data: FinanceData, p: L.Period): DaySpend[] {
  const days = Math.max(1, daysBetween(p.start, p.end) + 1);
  const sums = new Array<number>(days).fill(0);
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.date < p.start || t.date > p.end) continue;
    sums[daysBetween(p.start, t.date)] -= L.inr(L.accountById(data, t.accountId), t.amount);
  }
  return sums.map((amount, i) => ({ date: addDays(p.start, i), amount }));
}

const running = (rows: DaySpend[]) => {
  let sum = 0;
  return rows.map((r) => (sum += r.amount));
};

export interface Pace {
  /** Running total for this month, one value per day up to today. */
  now: number[];
  /** Running total for the whole of last month. */
  before: number[];
  /** Days on the axis: the longer of the two months. */
  days: number;
  /** Last month's running total at today's day of the month. */
  beforeAtToday: number;
}

/** This month's spending against last month's, day for day. */
export function monthPace(data: FinanceData, today = todayIso()): Pace {
  const d = dateOf(today);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const prevStart = isoOf(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const prevEnd = isoOf(new Date(d.getFullYear(), d.getMonth(), 0));
  const now = running(dailySpend(data, { start: `${today.slice(0, 7)}-01`, end: today }));
  const before = running(dailySpend(data, { start: prevStart, end: prevEnd }));
  return { now, before, days: Math.max(lastDay, before.length), beforeAtToday: before[Math.min(d.getDate(), before.length) - 1] ?? 0 };
}

/** How far through the month today is, 0–1. A budget ahead of this is ahead of pace. */
export function monthElapsed(today = todayIso()): number {
  const d = dateOf(today);
  return d.getDate() / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function daysLeftInMonth(today = todayIso()): number {
  const d = dateOf(today);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate();
}

export interface Due {
  key: string;
  kind: 'subscription' | 'instruction';
  name: string;
  date: string;
  amount: number;
  frequency: Frequency;
  brand?: BrandId;
  /** What it is paid with, or the account an instruction is debited from. */
  via?: string;
  /** Instructions only: the account the money goes into. */
  accountId?: string;
}

/**
 * Everything on a schedule, soonest first: subscriptions, and the standing
 * instructions that feed a PPF or deposit. Both dates are derived from their
 * schedule, so neither goes stale.
 */
export function upcoming(data: FinanceData, today = todayIso()): Due[] {
  const subs: Due[] = data.subscriptions.map((s) => {
    const method = L.methodById(data, s.methodId);
    return { key: `sub-${s.id}`, kind: 'subscription', name: s.name, date: L.nextCharge(s, today), amount: s.amount, frequency: L.subFrequency(s), brand: method?.brand, via: method?.name };
  });
  const instructions: Due[] = data.accounts
    .filter((a) => a.si && !a.archived)
    .map((a) => {
      const si = a.si!;
      return {
        key: `si-${a.id}`,
        kind: 'instruction',
        name: a.name,
        date: L.nextSiDate(si, today),
        amount: si.amount,
        frequency: si.frequency,
        brand: a.brand,
        via: L.accountById(data, si.fromAccountId)?.name,
        accountId: a.id,
      };
    });
  return [...subs, ...instructions].sort((a, b) => a.date.localeCompare(b.date));
}

export interface Holding {
  account: Account;
  /** In rupees, whatever the account's currency. */
  value: number;
  /** Share of everything held (debts excluded), 0–1. */
  share: number;
}

/** Where the money is: live accounts, largest first. */
export function holdings(data: FinanceData): Holding[] {
  const rows = data.accounts.filter((a) => !a.archived).map((account) => ({ account, value: L.balanceInr(data, account) }));
  const held = rows.reduce((sum, r) => sum + (r.value > 0 && !L.isLiability(r.account) ? r.value : 0), 0);
  return rows.sort((a, b) => b.value - a.value).map((r) => ({ ...r, share: held > 0 && r.value > 0 && !L.isLiability(r.account) ? r.value / held : 0 }));
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Fri 2 Oct` — a day as a chart's tooltip names it. */
export function tipDate(iso: string): string {
  const d = dateOf(iso);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

export const monthName = (iso: string) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][dateOf(iso).getMonth()];

/** `today`, `tomorrow`, `in 8 days`. */
export function inDays(iso: string, today = todayIso()): string {
  const n = daysBetween(today, iso);
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}
