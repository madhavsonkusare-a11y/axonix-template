/** The tracker's views, in one order for the sidebar, the tabs and the palette. */
import type { Frame } from '../../finance/ui';

export interface View {
  id: Frame;
  label: string;
  /** In the sidebar, where the tracker has both money and papers. */
  section: 'money' | 'papers';
  /** Not designed yet: the view says so instead of pretending. */
  soon?: boolean;
}

export const VIEWS: View[] = [
  { id: 'overview', label: 'Overview', section: 'money' },
  { id: 'spending', label: 'Spending', section: 'money' },
  { id: 'transactions', label: 'Transactions', section: 'money' },
  { id: 'accounts', label: 'Accounts', section: 'money' },
  { id: 'invest', label: 'Invest', section: 'money' },
  { id: 'plan', label: 'Plan', section: 'money', soon: true },
  { id: 'ids', label: 'Digital IDs', section: 'papers' },
  { id: 'wallet', label: 'Wallet', section: 'papers', soon: true },
];

export const STUBS: Partial<Record<Frame, { title: string; note: string }>> = {
  plan: { title: 'Plan', note: 'Goals, debts and the runway view. Not designed yet.' },
  wallet: { title: 'Wallet', note: 'Cash in hand and what you carry. Coming next, once the design is settled.' },
};
