/**
 * Finance data model — schema v2.
 *
 * Three ideas carry the whole model:
 *
 * 1. ACCOUNTS HOLD MONEY; PAYMENT METHODS MOVE IT. GPay, WhatsApp Pay, POP,
 *    a debit card, PayPal and Link are not places money sits — they are rails
 *    on top of a bank account. A transaction records both: the method it went
 *    through (for "how do I pay") and the account it left (for balances).
 *
 * 2. BALANCES ARE DERIVED, NEVER STORED. A balance is the latest checkpoint
 *    (`kind: 'adjustment'`, carrying `balanceAfter`) plus every transaction
 *    after it. Setting a balance writes a checkpoint instead of overwriting a
 *    number, so importing last month's statement cannot corrupt today's
 *    balance, and net worth has a real history to chart.
 *
 * 3. MACHINE-ASSIGNED MEANS UNVERIFIED. Anything categorised by an import or
 *    the quick-entry parser carries `autoCategorized` until a human confirms
 *    it — the dashed `auto` chip, invariant #3.
 */

export type Hue = 'blue' | 'violet' | 'green' | 'amber';

export type BrandId =
  | 'sbi' | 'icici' | 'groww' | 'thomascook' | 'jar' | 'epfo'
  | 'gpay' | 'whatsapp' | 'pop' | 'paypal' | 'link' | 'upi'
  | 'visa' | 'mastercard' | 'rupay'
  | 'digilocker' | 'aadhaar' | 'incometax' | 'parivahan' | 'passport' | 'voter' | 'abha' | 'umang';

export type AccountKind =
  | 'savings' | 'salary' | 'current'
  | 'provident' | 'demat' | 'gold' | 'deposit'
  | 'forex' | 'wallet' | 'cash'
  | 'credit' | 'loan';

export interface CardInfo {
  type: 'debit' | 'credit' | 'forex';
  network?: 'visa' | 'mastercard' | 'rupay';
  last4?: string;
}

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  brand?: BrandId;
  /** ISO 4217. Everything except the forex card is INR. */
  currency: string;
  /** INR per one unit of `currency`. Entered by hand — there is no rate feed. */
  fxRate?: number;
  /** Account-number tail, shown masked. */
  last4?: string;
  card?: CardInfo;
  /** Present on accounts promoted to a full aurora card. */
  hue?: Hue;
  /** A standing instruction paying INTO this account (PPF, RD). Not a subscription. */
  si?: StandingInstruction;
  note?: string;
  archived?: boolean;
  createdAt: string;
}

/** How often a scheduled amount repeats — standing instructions and subscriptions. */
export type Frequency = 'monthly' | 'quarterly' | 'yearly';
export type SiFrequency = Frequency;

/**
 * A bank's standing instruction: a fixed amount moved on a schedule. Kept on
 * the account it pays into, and deliberately not a Subscription — it is a
 * transfer between your own accounts, not money leaving you.
 */
export interface StandingInstruction {
  /** INR. */
  amount: number;
  /** The account the bank debits. */
  fromAccountId: string;
  frequency: SiFrequency;
  /** A debit date on the schedule, `YYYY-MM-DD`; the rest follow `frequency`. */
  anchorDate: string;
}

export type MethodKind = 'upi' | 'card' | 'wallet';

export interface PaymentMethod {
  id: string;
  name: string;
  kind: MethodKind;
  brand?: BrandId;
  /** The account a payment through this method debits. */
  accountId: string;
  /** UPI id or similar. Display only. */
  handle?: string;
}

export type TxKind = 'expense' | 'income' | 'transfer' | 'adjustment';
export type TxSource = 'manual' | 'quick' | 'import' | 'phone';

export interface Transaction {
  id: string;
  kind: TxKind;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Signed, in the account's currency. Negative leaves the account. Zero for adjustments. */
  amount: number;
  accountId: string;
  /** Transfers only. */
  toAccountId?: string;
  /** Transfers only: what arrived, positive, in the destination's currency. */
  toAmount?: number;
  /** Adjustments only: the asserted balance at this point. */
  balanceAfter?: number;
  methodId?: string;
  merchant: string;
  category: string;
  note?: string;
  source?: TxSource;
  autoCategorized?: boolean;
  /** Full ISO timestamp. Orders same-day entries against a checkpoint. */
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  kind: 'expense' | 'income';
}

export interface Budget {
  category: string;
  limit: number;
}

/**
 * A recurring charge you pay (Netflix, iCloud). A reminder, not money: it
 * never creates a transaction on its own — "Record" opens a prefilled expense
 * the owner confirms.
 */
export interface Subscription {
  id: string;
  name: string;
  /**
   * A charge date ON the schedule, `YYYY-MM-DD`. The next charge shown is
   * derived from it and `frequency` (see `ledger.nextCharge`), so it moves
   * forward on its own and never goes stale. Kept under its original name so
   * older data reads unchanged.
   */
  nextCharge: string;
  /** INR, paise allowed. */
  amount: number;
  methodId?: string;
  /** Absent on subscriptions saved before 2026-09-13 — those were monthly. */
  frequency?: Frequency;
}

export type IdType = 'aadhaar' | 'pan' | 'dl' | 'passport' | 'voter' | 'abha' | 'uan' | 'other';

export interface DigitalId {
  id: string;
  type: IdType;
  label: string;
  number: string;
  holder?: string;
  issuedOn?: string;
  expiresOn?: string;
  /** A verified copy exists in the owner's DigiLocker. */
  inDigiLocker?: boolean;
  note?: string;
}

export interface FinanceData {
  version: 2;
  accounts: Account[];
  methods: PaymentMethod[];
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  subscriptions: Subscription[];
  ids: DigitalId[];
}
