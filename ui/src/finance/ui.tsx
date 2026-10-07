/**
 * Tracker-wide UI intents — open a sheet, jump to a frame — so any frame can
 * say "add a transaction here" without threading callbacks through every card.
 * `FinanceApp` owns the state and provides the implementation.
 */
import { createContext, useContext } from 'react';
import type { IdType } from './types';
import type { TransactionPreset } from './components/TransactionSheet';
import type { AccountTarget } from './components/AccountSheet';
import type { DetailTarget } from './components/DetailSheet';

export type Frame = 'overview' | 'spending' | 'transactions' | 'accounts' | 'invest' | 'plan' | 'ids' | 'wallet';

export interface LedgerFilter {
  /** Search text, e.g. handed over from the command palette. */
  query?: string;
  review?: boolean;
  accountId?: string;
  category?: string;
}

export interface FinanceUi {
  go: (frame: Frame, filter?: LedgerFilter) => void;
  addTransaction: (preset?: TransactionPreset) => void;
  editTransaction: (id: string) => void;
  /** Read-only details first; editing is a button inside. */
  openDetails: (target: DetailTarget) => void;
  editAccount: (target: AccountTarget) => void;
  importStatement: (accountId?: string) => void;
  openSettings: (tab?: 'categories' | 'budgets' | 'subscriptions' | 'data') => void;
  editId: (target: { id?: string; type?: IdType }) => void;
}

export const FinanceUiContext = createContext<FinanceUi | null>(null);

export function useFinanceUi(): FinanceUi {
  const ui = useContext(FinanceUiContext);
  if (!ui) throw new Error('useFinanceUi must be used inside FinanceApp');
  return ui;
}
