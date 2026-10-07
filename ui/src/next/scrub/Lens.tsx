/**
 * The lens every module reads through while the day is not today.
 *
 * It stands between the real state (finance, tasks) and the screens. On today
 * it passes everything through untouched. On another day it hands the screens
 * a copy of the data as of that day and refuses every change:
 *
 * - **Finance, looking back:** every entry after that day is left out, and an
 *   account whose balance was set later gets its balance for that day worked
 *   out from the full ledger, so every figure on screen is the figure at the
 *   end of that day.
 * - **Finance, looking ahead:** what is on a schedule between now and then is
 *   added as *expected* entries (subscriptions, standing instructions), plus
 *   one line for everyday spending at the recent daily rate. Nothing else is
 *   guessed: no income is assumed.
 * - **Tasks, looking back:** a task made later is left out; one finished or
 *   started later is shown as it stood.
 * - **Storeroom, looking back:** what was kept later is left out (`StoreLens`,
 *   placed inside the module because the room's state lives there).
 *
 * Notes are the exception and say so: a note keeps one text and no history, so
 * the library is narrowed to what had been written by that day, but an open
 * note reads, and can be edited, as it is today.
 *
 * The copy is only ever read. The real state is never replaced with it:
 * `dispatch` and every task change are swapped for a refusal, so there is no
 * path from this copy to the owner's files.
 */
import { useContext, useMemo, type ReactNode } from 'react';
import { FinanceContext, type FinanceContextValue } from '../../finance/FinanceContext';
import type { FinanceData, Transaction } from '../../finance/types';
import * as L from '../../finance/ledger';
import { addDays, daysBetween } from '../../finance/format';
import { StoreroomContext, type StoreroomValue } from '../../storeroom/StoreroomContext';
import { TasksContext, type TasksValue } from '../../tasks/TasksContext';
import type { Task } from '../../tasks/types';
import { refuseChange, useAsOf } from './Scrub';

/** An entry that has not happened: on a schedule, or estimated. */
export const isExpected = (t: { id: string }) => t.id.startsWith('exp:');
/** A balance worked out for the day being shown; never listed as an entry. */
export const isAsOfMark = (t: { id: string }) => t.id.startsWith('asof:');
export const EVERYDAY = 'exp:everyday';

/* ------------------------------------------------------------------ */
/* finance                                                             */
/* ------------------------------------------------------------------ */

function financeBack(data: FinanceData, day: string): FinanceData {
  const kept = data.transactions.filter((t) => t.date <= day);
  // An account whose only balance checkpoints are later would lose its anchor:
  // give it the balance the full ledger works out for that day.
  const marks: Transaction[] = [];
  for (const a of data.accounts) {
    const later = data.transactions.some((t) => t.kind === 'adjustment' && t.accountId === a.id && t.date > day);
    if (!later) continue;
    marks.push({
      id: `asof:${a.id}`,
      kind: 'adjustment',
      date: day,
      amount: 0,
      accountId: a.id,
      balanceAfter: L.balanceOf(data, a.id, day),
      merchant: 'Balance on this day',
      category: 'Adjustment',
      createdAt: `${day}T23:59:59.999Z`,
    });
  }
  return { ...data, transactions: [...kept, ...marks] };
}

/** Rupees a day spent lately on things that are not on a schedule. Zero without two weeks of history. */
export function everydayRate(data: FinanceData, today: string): { perDay: number; accountId?: string } {
  const first = L.earliestDate(data);
  if (!first) return { perDay: 0 };
  const basis = Math.min(30, daysBetween(first, today));
  if (basis < 14) return { perDay: 0 };
  const scheduled = new Set(data.subscriptions.map((s) => s.name.trim().toLowerCase()));
  const start = addDays(today, -basis);
  const byAccount = new Map<string, number>();
  let out = 0;
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.date <= start || t.date > today || scheduled.has(t.merchant.trim().toLowerCase())) continue;
    const v = -L.inr(L.accountById(data, t.accountId), t.amount);
    out += v;
    byAccount.set(t.accountId, (byAccount.get(t.accountId) ?? 0) + v);
  }
  const accountId = [...byAccount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { perDay: Math.max(0, out) / basis, accountId };
}

function financeAhead(data: FinanceData, day: string, today: string): FinanceData {
  const expected: Transaction[] = [];
  const from = addDays(today, 1);
  const fallback = data.accounts.find((a) => !a.archived)?.id ?? '';

  for (const s of data.subscriptions) {
    const method = L.methodById(data, s.methodId);
    for (let due = L.nextDue(s.nextCharge, L.subFrequency(s), from); due <= day; due = L.nextDue(s.nextCharge, L.subFrequency(s), addDays(due, 1))) {
      expected.push({ id: `exp:sub:${s.id}:${due}`, kind: 'expense', date: due, amount: -s.amount, accountId: method?.accountId ?? fallback, methodId: s.methodId, merchant: s.name, category: 'Subscriptions', createdAt: `${due}T00:00:00.000Z` });
    }
  }
  for (const a of data.accounts) {
    const si = a.si;
    if (!si || a.archived) continue;
    for (let due = L.nextDue(si.anchorDate, si.frequency, from); due <= day; due = L.nextDue(si.anchorDate, si.frequency, addDays(due, 1))) {
      expected.push({ id: `exp:si:${a.id}:${due}`, kind: 'transfer', date: due, amount: -si.amount, toAmount: si.amount, accountId: si.fromAccountId, toAccountId: a.id, merchant: a.name, category: 'Transfer', createdAt: `${due}T00:00:00.000Z` });
    }
  }
  const rate = everydayRate(data, today);
  const everyday = Math.round(rate.perDay * daysBetween(today, day));
  if (everyday > 0 && rate.accountId) {
    expected.push({ id: EVERYDAY, kind: 'expense', date: day, amount: -everyday, accountId: rate.accountId, merchant: 'Everyday spending', category: 'Estimated', createdAt: `${day}T00:00:00.000Z` });
  }
  return expected.length ? { ...data, transactions: [...data.transactions, ...expected] } : data;
}

/* ------------------------------------------------------------------ */
/* tasks                                                               */
/* ------------------------------------------------------------------ */

function tasksBack(tasks: Task[], day: string): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.created && t.created.slice(0, 10) > day) continue;
    const doneBy = t.done && t.done.slice(0, 10) <= day;
    const startedBy = t.started && t.started.slice(0, 10) <= day;
    if (t.state === 'done' && !doneBy) out.push({ ...t, state: startedBy ? 'doing' : 'todo', done: undefined });
    else if (t.state === 'doing' && !startedBy && t.started) out.push({ ...t, state: 'todo', started: undefined });
    else out.push(t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the provider                                                        */
/* ------------------------------------------------------------------ */

export default function Lens({ off, children }: { /** A first-version screen is showing: it reads the real state. */ off?: boolean; children: ReactNode }) {
  const asOf = useAsOf();
  const finance = useContext(FinanceContext);
  const tasks = useContext(TasksContext);
  const through = off || asOf.live;
  const { day, today, past } = asOf;

  const financeData = useMemo(() => (through || !finance ? null : past ? financeBack(finance.data, day) : financeAhead(finance.data, day, today)), [through, finance, past, day, today]);
  const financeValue = useMemo<FinanceContextValue | null>(() => {
    if (!finance || !financeData) return finance;
    return {
      ...finance,
      data: financeData,
      dispatch: () => {
        refuseChange(day);
        return -1;
      },
      undo: () => refuseChange(day),
    };
  }, [finance, financeData, day]);

  const taskList = useMemo(() => (through || !tasks ? null : past ? tasksBack(tasks.tasks, day) : tasks.tasks), [through, tasks, past, day]);
  const tasksValue = useMemo<TasksValue | null>(() => {
    if (!tasks || !taskList) return tasks;
    const refuse = async () => {
      refuseChange(day);
      return null;
    };
    return {
      ...tasks,
      tasks: taskList,
      byId: new Map(taskList.map((t) => [t.id, t])),
      create: refuse,
      update: refuse,
      updateMany: refuse,
      trash: refuse,
      trashMany: refuse,
      createProject: async () => {
        refuseChange(day);
        return false;
      },
      renameProject: refuse,
      undo: () => refuseChange(day),
    };
  }, [tasks, taskList, day]);

  // The same two providers whether or not the day is today, so nothing below
  // is torn down and rebuilt when the ruler moves off today or comes back.
  return (
    <FinanceContext.Provider value={financeValue}>
      <TasksContext.Provider value={tasksValue}>{children}</TasksContext.Provider>
    </FinanceContext.Provider>
  );
}

/** The same for the Storeroom, whose state lives inside its own module. */
export function StoreLens({ children }: { children: ReactNode }) {
  const { day, past, live } = useAsOf();
  const store = useContext(StoreroomContext);
  const value = useMemo<StoreroomValue | null>(() => {
    if (!store || live) return store;
    const refuse = async () => refuseChange(day);
    return {
      ...store,
      items: past ? store.items.filter((i) => i.created.slice(0, 10) <= day) : store.items,
      intake: refuse,
      keepFromSocial: refuse,
      trash: refuse,
      recapture: refuse,
      update: async () => {
        refuseChange(day);
        return null;
      },
    };
  }, [store, live, past, day]);
  return <StoreroomContext.Provider value={value}>{children}</StoreroomContext.Provider>;
}
