/**
 * Finance state: one reducer, persisted, with a single level of undo.
 *
 * Mounted above the launcher (in `App`) rather than inside the tracker, so the
 * Home tile shows the same live net worth the tracker does.
 *
 * Saves are debounced and their outcome is tracked, so the rail can say
 * "Saved 11:42" — or that saving failed — instead of a fixed "Synced".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Account, Budget, Category, DigitalId, FinanceData, PaymentMethod, StandingInstruction, Subscription, Transaction } from './types';
import { demoData, loadData, saveData, starterData } from './repo';
import { desktop } from './desktop';
import { todayIso } from './format';
import { balanceOf, needsBalance } from './ledger';

export type Draft<T extends { id: string }> = Omit<T, 'id'> & { id?: string };

export type FinanceAction =
  | { type: 'SET_DATA'; data: FinanceData }
  | { type: 'SAVE_TRANSACTION'; tx: Draft<Transaction> }
  | { type: 'DELETE_TRANSACTION'; id: string }
  | { type: 'ADD_TRANSACTIONS'; txs: Transaction[] }
  | { type: 'CONFIRM_TRANSACTIONS'; ids: string[] }
  /** `balance` (with an `id`) sets the balance in the same change, so one undo reverts both. */
  | { type: 'SAVE_ACCOUNT'; account: Draft<Account>; balance?: number }
  | { type: 'DELETE_ACCOUNT'; id: string }
  | { type: 'SET_BALANCE'; accountId: string; balance: number; date?: string }
  /** `si` undefined removes the standing instruction. Touches nothing but that one field. */
  | { type: 'SET_SI'; accountId: string; si?: StandingInstruction }
  | { type: 'SAVE_METHOD'; method: Draft<PaymentMethod> }
  | { type: 'DELETE_METHOD'; id: string }
  | { type: 'SAVE_CATEGORY'; category: Draft<Category> }
  | { type: 'DELETE_CATEGORY'; id: string }
  | { type: 'SET_BUDGET'; budget: Budget }
  | { type: 'SAVE_SUBSCRIPTION'; subscription: Draft<Subscription> }
  | { type: 'DELETE_SUBSCRIPTION'; id: string }
  | { type: 'SAVE_ID'; doc: Draft<DigitalId> }
  | { type: 'DELETE_ID'; id: string }
  | { type: 'LOAD_DEMO' }
  | { type: 'RESET' };

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function upsert<T extends { id: string }>(list: T[], item: Draft<T>, prefix: string): T[] {
  if (item.id && list.some((x) => x.id === item.id)) {
    return list.map((x) => (x.id === item.id ? ({ ...x, ...item } as T) : x));
  }
  return [...list, { ...item, id: item.id ?? newId(prefix) } as T];
}

function reducer(state: FinanceData, action: FinanceAction): FinanceData {
  switch (action.type) {
    case 'SET_DATA':
      return action.data;

    case 'SAVE_TRANSACTION': {
      const tx = { ...action.tx, createdAt: action.tx.createdAt || new Date().toISOString() };
      return { ...state, transactions: upsert(state.transactions, tx, 'tx') };
    }
    case 'DELETE_TRANSACTION':
      return { ...state, transactions: state.transactions.filter((t) => t.id !== action.id) };
    case 'ADD_TRANSACTIONS':
      return { ...state, transactions: [...state.transactions, ...action.txs] };
    case 'CONFIRM_TRANSACTIONS': {
      const ids = new Set(action.ids);
      return {
        ...state,
        transactions: state.transactions.map((t) => (ids.has(t.id) ? { ...t, autoCategorized: false } : t)),
      };
    }

    case 'SAVE_ACCOUNT': {
      const next = { ...state, accounts: upsert(state.accounts, action.account, 'acct') };
      const id = action.account.id;
      return id && action.balance !== undefined
        ? reducer(next, { type: 'SET_BALANCE', accountId: id, balance: action.balance })
        : next;
    }
    case 'DELETE_ACCOUNT':
      return {
        ...state,
        accounts: state.accounts.filter((a) => a.id !== action.id),
        methods: state.methods.filter((m) => m.accountId !== action.id),
        transactions: state.transactions.filter((t) => t.accountId !== action.id && t.toAccountId !== action.id),
      };

    case 'SET_BALANCE': {
      // A checkpoint, not an overwrite — see the model notes in types.ts.
      // Skip only a no-op correction. The FIRST balance is always recorded,
      // even ₹0 — otherwise "0" is indistinguishable from "never set".
      const account = state.accounts.find((a) => a.id === action.accountId);
      if (!account) return state;
      const current = balanceOf(state, action.accountId);
      const hasHistory = !needsBalance(state, account);
      if (hasHistory && Math.abs(current - action.balance) < 0.005) return state;
      const checkpoint: Transaction = {
        id: newId('cp'),
        kind: 'adjustment',
        date: action.date ?? todayIso(),
        amount: 0,
        balanceAfter: action.balance,
        accountId: action.accountId,
        merchant: 'Balance set',
        category: 'Balance',
        createdAt: new Date().toISOString(),
      };
      return { ...state, transactions: [...state.transactions, checkpoint] };
    }

    case 'SET_SI':
      return {
        ...state,
        accounts: state.accounts.map((a) => {
          if (a.id !== action.accountId) return a;
          const { si: _previous, ...rest } = a;
          return action.si ? { ...rest, si: action.si } : rest;
        }),
      };

    case 'SAVE_METHOD':
      return { ...state, methods: upsert(state.methods, action.method, 'm') };
    case 'DELETE_METHOD':
      return {
        ...state,
        methods: state.methods.filter((m) => m.id !== action.id),
        transactions: state.transactions.map((t) => (t.methodId === action.id ? { ...t, methodId: undefined } : t)),
        // A subscription paid with the deleted method keeps everything but that link.
        subscriptions: state.subscriptions.map((s) => (s.methodId === action.id ? { ...s, methodId: undefined } : s)),
      };

    case 'SAVE_CATEGORY':
      return { ...state, categories: upsert(state.categories, action.category, 'cat') };
    case 'DELETE_CATEGORY':
      return { ...state, categories: state.categories.filter((c) => c.id !== action.id) };

    case 'SET_BUDGET': {
      const rest = state.budgets.filter((b) => b.category !== action.budget.category);
      return { ...state, budgets: action.budget.limit > 0 ? [...rest, action.budget] : rest };
    }

    case 'SAVE_SUBSCRIPTION':
      return { ...state, subscriptions: upsert(state.subscriptions, action.subscription, 'sub') };
    case 'DELETE_SUBSCRIPTION':
      return { ...state, subscriptions: state.subscriptions.filter((s) => s.id !== action.id) };

    case 'SAVE_ID':
      return { ...state, ids: upsert(state.ids, action.doc, 'id') };
    case 'DELETE_ID':
      return { ...state, ids: state.ids.filter((d) => d.id !== action.id) };

    case 'LOAD_DEMO':
      return demoData();
    case 'RESET':
      // Keeps the setup — accounts, payment methods, categories, subscriptions —
      // and drops history. Subscriptions used to be wiped here too.
      return { ...starterData(), accounts: state.accounts, methods: state.methods, categories: state.categories, subscriptions: state.subscriptions };
  }
}

export type SaveStatus = { state: 'idle' } | { state: 'saved'; at: Date } | { state: 'error'; message: string };

export interface FinanceContextValue {
  data: FinanceData;
  /** Returns a change number, for `undo`. */
  dispatch: (action: FinanceAction) => number;
  loading: boolean;
  save: SaveStatus;
  /**
   * Set when the saved file could not be read. Saving is then OFF for the whole
   * run, and the screens must say so — otherwise the empty starter state looks
   * exactly like the owner's data being deleted.
   */
  loadError: string | null;
  /** Try the last failed save again, now. */
  retrySave: () => void;
  /**
   * Reverts change `change` — but only while it is still the latest one, so an
   * Undo button on an old toast can never roll back something newer.
   */
  undo: (change: number) => void;
}

/** Exported so Scrub can show the same data as of another day (next/scrub/Lens.tsx). */
export const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceStateProvider({ children }: { children: ReactNode }) {
  const [data, rawDispatch] = useReducer(reducer, undefined, starterData);
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveStatus>({ state: 'idle' });
  const latest = useRef(data);
  latest.current = data;
  const history = useRef<{ change: number; before: FinanceData } | null>(null);
  const counter = useRef(0);

  // If the saved file cannot be read, saving stays OFF for the whole run: the
  // alternative is writing the empty starter state over data that may be
  // perfectly recoverable. The startup backup still holds the original.
  const [loadError, setLoadError] = useState<string | null>(null);
  const blocked = useRef(true);
  // The data exactly as read at launch. Writing it straight back changed
  // nothing but still rewrote the file and showed "Saved" on every launch.
  const onDisk = useRef<FinanceData | null>(null);
  blocked.current = loading || loadError !== null;

  useEffect(() => {
    let live = true;
    loadData()
      .then((loaded) => {
        if (!live) return;
        onDisk.current = loaded;
        rawDispatch({ type: 'SET_DATA', data: loaded });
      })
      .catch((e) => {
        if (!live) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setSave({ state: 'error', message: 'Your saved data could not be read, so nothing will be saved this session.' });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  // Writes are serialised and always write the LATEST data when they run. Two
  // overlapping writes could otherwise finish out of order and leave the older
  // one on disk.
  const writing = useRef<Promise<void>>(Promise.resolve());
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  const writeNow = useCallback((): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const run = writing.current.then(async () => {
      if (!dirty.current || blocked.current) return;
      dirty.current = false;
      try {
        await saveData(latest.current);
        setSave({ state: 'saved', at: new Date() });
      } catch (e) {
        dirty.current = true;
        setSave({ state: 'error', message: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    });
    writing.current = run.catch(() => undefined);
    return run;
  }, []);

  // Debounced write. Skipped until the first load settles, or the empty
  // starter state would overwrite the file before it had been read.
  useEffect(() => {
    if (loading || loadError !== null || data === onDisk.current) return;
    // Forgotten after the first real change, so undoing back to the launch
    // state (the same object) is still written.
    onDisk.current = null;
    dirty.current = true;
    timer.current = window.setTimeout(() => void writeNow().catch(() => undefined), 250);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [data, loading, loadError, writeNow]);

  // Closing the window inside the 250ms debounce used to drop the last change.
  // The close now waits (up to 3s) for the pending write.
  useEffect(() => desktop?.onClosing(() => writeNow().catch(() => undefined)), [writeNow]);

  const retrySave = useCallback(() => {
    dirty.current = true;
    void writeNow().catch(() => undefined);
  }, [writeNow]);

  const dispatch = useCallback((action: FinanceAction) => {
    const change = ++counter.current;
    history.current = { change, before: latest.current };
    rawDispatch(action);
    return change;
  }, []);

  const undo = useCallback((change: number) => {
    const h = history.current;
    if (!h || h.change !== change || change !== counter.current) {
      // Saying nothing made the Undo button look broken.
      toast('That can’t be undone any more — something else changed after it.');
      return;
    }
    rawDispatch({ type: 'SET_DATA', data: h.before });
    history.current = null;
  }, []);

  const value = useMemo(
    () => ({ data, dispatch, loading, save, loadError, retrySave, undo }),
    [data, dispatch, loading, save, loadError, retrySave, undo],
  );
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance must be used within FinanceStateProvider');
  return ctx;
}
