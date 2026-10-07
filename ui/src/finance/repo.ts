/**
 * Persistence for the finance tracker.
 *
 * Tauri file I/O in the desktop app (`%LOCALAPPDATA%\Axonix\finance-data.json`
 * via the `read_finance_data` / `write_finance_data` commands), localStorage in
 * a plain browser. The UI never touches either directly.
 *
 * Loading always runs `migrate`, so a v1 file from the first tracker build is
 * upgraded in place rather than rejected.
 */
import type {
  Account,
  AccountKind,
  Category,
  DigitalId,
  FinanceData,
  PaymentMethod,
  Subscription,
  Transaction,
} from './types';
import { addDays, todayIso } from './format';
import { desktop } from './desktop';

/* ------------------------------------------------------------------ */
/* defaults                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-food',      name: 'Food & dining',   color: '#7cc4ff', kind: 'expense' },
  { id: 'cat-groceries', name: 'Groceries',       color: '#5fe0a2', kind: 'expense' },
  { id: 'cat-bills',     name: 'Rent & bills',    color: '#5b8cff', kind: 'expense' },
  { id: 'cat-transport', name: 'Transport',       color: '#7aa4ff', kind: 'expense' },
  { id: 'cat-shopping',  name: 'Shopping',        color: '#f7a8c8', kind: 'expense' },
  { id: 'cat-health',    name: 'Health',          color: '#ff8f8f', kind: 'expense' },
  { id: 'cat-subs',      name: 'Subscriptions',   color: '#ffc496', kind: 'expense' },
  { id: 'cat-fun',       name: 'Entertainment',   color: '#e0b089', kind: 'expense' },
  { id: 'cat-travel',    name: 'Travel',          color: '#6fd3e8', kind: 'expense' },
  { id: 'cat-family',    name: 'Gifts & family',  color: '#ffd479', kind: 'expense' },
  { id: 'cat-other',     name: 'Everything else', color: 'rgba(255,255,255,.32)', kind: 'expense' },
  { id: 'cat-salary',    name: 'Salary',          color: '#5fe0a2', kind: 'income' },
  { id: 'cat-freelance', name: 'Freelance',       color: '#7aa4ff', kind: 'income' },
  { id: 'cat-refund',    name: 'Refunds',         color: '#7cc4ff', kind: 'income' },
  { id: 'cat-interest',  name: 'Interest',        color: '#ffc496', kind: 'income' },
  { id: 'cat-income',    name: 'Other income',    color: 'rgba(255,255,255,.32)', kind: 'income' },
];

const stamp = () => new Date().toISOString();

/**
 * The owner's real setup, with no balances. Which bank each UPI app, PayPal
 * and Link actually debits is not known — they default to SBI Savings and
 * are one click to change on Accounts & cards.
 */
function starterAccounts(): { accounts: Account[]; methods: PaymentMethod[] } {
  const createdAt = todayIso();
  const accounts: Account[] = [
    { id: 'sbi-savings',  name: 'SBI Savings',       kind: 'savings',   brand: 'sbi',        currency: 'INR', hue: 'blue',   card: { type: 'debit' }, createdAt },
    { id: 'icici-salary', name: 'ICICI Salary',      kind: 'salary',    brand: 'icici',      currency: 'INR', hue: 'amber',  card: { type: 'debit' }, createdAt },
    { id: 'groww-demat',  name: 'Groww Demat',       kind: 'demat',     brand: 'groww',      currency: 'INR', hue: 'violet', createdAt },
    { id: 'tc-forex',     name: 'Thomas Cook Forex', kind: 'forex',     brand: 'thomascook', currency: 'USD', hue: 'green',  card: { type: 'forex' }, createdAt },
    { id: 'sbi-pf',       name: 'SBI PF',            kind: 'provident', brand: 'sbi',        currency: 'INR', createdAt },
    { id: 'jar-gold',     name: 'Jar',               kind: 'gold',      brand: 'jar',        currency: 'INR', createdAt },
  ];
  const methods: PaymentMethod[] = [
    { id: 'm-gpay',     name: 'Google Pay',     kind: 'upi',    brand: 'gpay',       accountId: 'sbi-savings' },
    { id: 'm-whatsapp', name: 'WhatsApp Pay',   kind: 'upi',    brand: 'whatsapp',   accountId: 'sbi-savings' },
    { id: 'm-pop',      name: 'POP UPI',        kind: 'upi',    brand: 'pop',        accountId: 'sbi-savings' },
    { id: 'm-sbi-card', name: 'SBI debit card', kind: 'card',   brand: 'sbi',        accountId: 'sbi-savings' },
    { id: 'm-icici-card', name: 'ICICI debit card', kind: 'card', brand: 'icici',    accountId: 'icici-salary' },
    { id: 'm-tc-card',  name: 'Forex card',     kind: 'card',   brand: 'thomascook', accountId: 'tc-forex' },
    { id: 'm-paypal',   name: 'PayPal',         kind: 'wallet', brand: 'paypal',     accountId: 'sbi-savings' },
    { id: 'm-link',     name: 'Link',           kind: 'wallet', brand: 'link',       accountId: 'sbi-savings' },
  ];
  return { accounts, methods };
}

export function starterData(): FinanceData {
  return {
    version: 2,
    ...starterAccounts(),
    transactions: [],
    categories: DEFAULT_CATEGORIES,
    budgets: [],
    subscriptions: [],
    ids: [],
  };
}

/* ------------------------------------------------------------------ */
/* migration                                                           */
/* ------------------------------------------------------------------ */

interface V1Account { id: string; name: string; kind: string; balance: number; tail?: string; card?: { hue?: Account['hue'] } }
interface V1Transaction { id: string; date: string; merchant: string; category: string; amount: number; accountId: string; autoCategorized?: boolean; note?: string }
interface V1Data {
  version: 1;
  accounts?: V1Account[];
  transactions?: V1Transaction[];
  categories?: { id: string; name: string; color: string }[];
  budgets?: FinanceData['budgets'];
  subscriptions?: Subscription[];
}

function kindFromV1(kind: string): AccountKind {
  const k = kind.toLowerCase();
  if (/loan/.test(k)) return 'loan';
  if (/credit/.test(k)) return 'credit';
  if (/broking|demat/.test(k)) return 'demat';
  if (/epf|retire|provident|ppf/.test(k)) return 'provident';
  if (/deposit|fd/.test(k)) return 'deposit';
  if (/current/.test(k)) return 'current';
  if (/salary/.test(k)) return 'salary';
  return 'savings';
}

/**
 * v1 stored balances as plain numbers that transactions never moved. Each is
 * carried over as a checkpoint dated today and stamped after every existing
 * entry, so the balance on screen is exactly what it was before the upgrade.
 */
export function migrate(raw: unknown): FinanceData {
  if (!raw || typeof raw !== 'object') return starterData();
  const version = (raw as { version?: number }).version;
  // A file from a newer Axonix must not be "migrated" down: that would drop
  // whatever the newer version added, and the next save would make it permanent.
  if (typeof version === 'number' && version > 2) {
    throw new Error(`This data was saved by a newer version of Axonix (format ${version}). Nothing was changed.`);
  }

  if (version === 2) {
    const d = raw as Partial<FinanceData>;
    return {
      version: 2,
      accounts: d.accounts ?? [],
      methods: d.methods ?? [],
      transactions: d.transactions ?? [],
      categories: d.categories?.length ? d.categories : DEFAULT_CATEGORIES,
      budgets: d.budgets ?? [],
      subscriptions: d.subscriptions ?? [],
      ids: d.ids ?? [],
    };
  }

  const v1 = raw as V1Data;
  const accounts = v1.accounts ?? [];
  const txs = v1.transactions ?? [];
  // An untouched v1 file is the empty state the first build shipped with —
  // there is nothing to preserve, so start from the real setup instead.
  if (accounts.length === 0 && txs.length === 0) return starterData();

  const today = todayIso();
  const now = stamp();
  const known = new Set(DEFAULT_CATEGORIES.map((c) => c.name));

  return {
    version: 2,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      kind: kindFromV1(a.kind),
      currency: 'INR',
      last4: a.tail && /^\d{4}$/.test(a.tail) ? a.tail : undefined,
      hue: a.card?.hue,
      createdAt: today,
    })),
    methods: [],
    transactions: [
      ...txs.map<Transaction>((t) => ({
        id: t.id,
        kind: t.amount >= 0 ? 'income' : 'expense',
        date: t.date,
        amount: t.amount,
        accountId: t.accountId,
        merchant: t.merchant,
        category: t.category === 'Income' ? 'Other income' : t.category,
        note: t.note,
        autoCategorized: t.autoCategorized,
        source: 'manual',
        createdAt: `${t.date}T00:00:00.000Z`,
      })),
      ...accounts.map<Transaction>((a) => ({
        id: `cp-${a.id}`,
        kind: 'adjustment',
        date: today,
        amount: 0,
        balanceAfter: a.balance,
        accountId: a.id,
        merchant: 'Balance carried over',
        category: 'Balance',
        createdAt: now,
      })),
    ],
    categories: [
      ...DEFAULT_CATEGORIES,
      ...(v1.categories ?? [])
        .filter((c) => !known.has(c.name) && c.name !== 'Income')
        .map<Category>((c) => ({ ...c, kind: 'expense' })),
    ],
    budgets: v1.budgets ?? [],
    subscriptions: v1.subscriptions ?? [],
    ids: [],
  };
}

/**
 * Read a backup file chosen for Restore. Throws unless it really is an Axonix
 * finance file: `migrate` alone turns any unrelated JSON into the empty starter
 * setup, and Restore would then replace everything with it.
 */
export function readBackup(text: string): FinanceData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const doc = raw as { version?: unknown; accounts?: unknown; transactions?: unknown } | null;
  const shaped = !!doc && typeof doc === 'object' && Array.isArray(doc.accounts) && Array.isArray(doc.transactions);
  if (!shaped) throw new Error('That is not an Axonix backup — it has no accounts and transactions.');
  if (typeof doc.version === 'number' && doc.version > 2) throw new Error('That backup was made by a newer version of Axonix. Update the app, then restore it.');
  if (!(doc.version === 1 || doc.version === 2 || doc.version === undefined)) throw new Error('That backup has a version this app does not recognise.');
  return migrate(raw);
}

/* ------------------------------------------------------------------ */
/* storage backends                                                    */
/* ------------------------------------------------------------------ */

interface Backend {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

/** The data file, through the desktop app. `null` when there is no file yet; a failed read rejects. */
const file: Backend = {
  async read() {
    return desktop ? desktop.readData() : null;
  },
  async write(json) {
    if (desktop) await desktop.writeData(json);
  },
};

const KEY = 'axonix:finance:data';

/** The dev server's stand-in: this browser's localStorage, never the owner's file. */
const browser: Backend = {
  async read() {
    return localStorage.getItem(KEY);
  },
  async write(json) {
    localStorage.setItem(KEY, json);
  },
};

const backend = (): Backend => (desktop ? file : browser);

export async function loadData(): Promise<FinanceData> {
  const raw = await backend().read();
  if (raw === null) return starterData();
  return migrate(JSON.parse(raw));
}

/** Rejects on failure — the caller decides how loudly to say so. */
export async function saveData(data: FinanceData): Promise<void> {
  await backend().write(JSON.stringify(data));
}

/**
 * Copy the saved data aside before anything destructive (reset, demo, restore).
 * Desktop: `%LOCALAPPDATA%\Axonix\backups\` via the app. Browser: a timestamped
 * localStorage key. Resolves to where the copy went, or '' if there was nothing.
 */
export async function backupData(reason: string): Promise<string> {
  if (desktop) return desktop.backupData(reason);
  const current = localStorage.getItem(KEY);
  if (current === null) return '';
  const key = `${KEY}:backup:${Date.now()}-${reason}`;
  localStorage.setItem(key, current);
  return key;
}

/* ------------------------------------------------------------------ */
/* demo data                                                           */
/* ------------------------------------------------------------------ */

/** Mulberry32 — seeded, so the demo looks the same on every load. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Four months of invented activity over the owner's real account list, for
 * seeing every screen populated. Replaces all data; the Data tab says so.
 */
export function demoData(today = todayIso()): FinanceData {
  const base = starterData();
  const rand = rng(20260913);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (lo: number, hi: number, step = 10) => Math.round((lo + rand() * (hi - lo)) / step) * step;

  const txs: Transaction[] = [];
  let n = 0;
  const add = (t: Omit<Transaction, 'id' | 'createdAt'>, time = '10:00') => {
    txs.push({ ...t, id: `demo-${++n}`, createdAt: `${t.date}T${time}:00.000Z` });
  };

  const start = addDays(today, -120);
  const checkpoint = (accountId: string, balanceAfter: number) =>
    add({ kind: 'adjustment', date: start, amount: 0, balanceAfter, accountId, merchant: 'Opening balance', category: 'Balance' }, '00:00');

  checkpoint('sbi-savings', 184500);
  checkpoint('icici-salary', 72300);
  checkpoint('groww-demat', 418000);
  checkpoint('sbi-pf', 262400);
  checkpoint('jar-gold', 18450);
  checkpoint('tc-forex', 0);

  const food = ['Swiggy', 'Zomato', 'Blue Tokai Coffee', 'Chaayos', 'Third Wave Coffee', 'Dominos'];
  const groceries = ['Blinkit', 'Zepto', 'BigBasket', 'DMart'];
  const transport = ['Uber', 'Rapido', 'Namma Metro', 'Ola'];
  const shopping = ['Amazon', 'Myntra', 'Decathlon', 'Flipkart'];

  for (let i = 119; i >= 0; i--) {
    const date = addDays(today, -i);
    const dom = Number(date.slice(8));

    if (dom === 1) {
      add({ kind: 'income', date, amount: 142000, accountId: 'icici-salary', merchant: 'Salary — Thrustworks', category: 'Salary' }, '09:00');
      add({ kind: 'transfer', date, amount: -60000, accountId: 'icici-salary', toAccountId: 'sbi-savings', toAmount: 60000, merchant: 'To SBI Savings', category: 'Transfer' }, '09:30');
    }
    if (dom === 3) add({ kind: 'expense', date, amount: -28000, accountId: 'sbi-savings', merchant: 'Rent — Koramangala flat', category: 'Rent & bills' });
    if (dom === 6) add({ kind: 'expense', date, amount: -between(1400, 2600), accountId: 'sbi-savings', methodId: 'm-gpay', merchant: 'BESCOM electricity', category: 'Rent & bills' });
    if (dom === 10) add({ kind: 'transfer', date, amount: -15000, accountId: 'icici-salary', toAccountId: 'groww-demat', toAmount: 15000, merchant: 'Groww — index SIP', category: 'Transfer' });
    if (dom === 12) add({ kind: 'transfer', date, amount: -5000, accountId: 'sbi-savings', toAccountId: 'sbi-pf', toAmount: 5000, merchant: 'PF contribution', category: 'Transfer' });
    if (dom === 14) add({ kind: 'expense', date, amount: -649, accountId: 'icici-salary', methodId: 'm-icici-card', merchant: 'Netflix', category: 'Subscriptions' });
    if (dom === 18) add({ kind: 'expense', date, amount: -1290, accountId: 'sbi-savings', methodId: 'm-link', merchant: 'Figma', category: 'Subscriptions' });
    if (dom === 22) add({ kind: 'expense', date, amount: -219, accountId: 'sbi-savings', methodId: 'm-gpay', merchant: 'iCloud+', category: 'Subscriptions' });
    if (i % 7 === 0) add({ kind: 'transfer', date, amount: -210, accountId: 'sbi-savings', toAccountId: 'jar-gold', toAmount: 210, merchant: 'Jar daily savings', category: 'Transfer' });

    if (rand() < 0.62) add({ kind: 'expense', date, amount: -between(140, 780), accountId: 'sbi-savings', methodId: pick(['m-gpay', 'm-gpay', 'm-pop', 'm-whatsapp']), merchant: pick(food), category: 'Food & dining' }, '13:10');
    if (rand() < 0.28) add({ kind: 'expense', date, amount: -between(380, 2400), accountId: 'sbi-savings', methodId: pick(['m-gpay', 'm-pop']), merchant: pick(groceries), category: 'Groceries' }, '19:40');
    if (rand() < 0.45) add({ kind: 'expense', date, amount: -between(60, 420), accountId: 'sbi-savings', methodId: pick(['m-pop', 'm-gpay']), merchant: pick(transport), category: 'Transport' }, '08:50');
    if (rand() < 0.07) add({ kind: 'expense', date, amount: -between(600, 4800, 50), accountId: 'icici-salary', methodId: 'm-icici-card', merchant: pick(shopping), category: 'Shopping' }, '21:05');
    if (rand() < 0.03) add({ kind: 'expense', date, amount: -between(300, 1800), accountId: 'sbi-savings', methodId: 'm-whatsapp', merchant: pick(['Apollo Pharmacy', 'Practo consult']), category: 'Health' }, '17:20');
    if (rand() < 0.04) add({ kind: 'expense', date, amount: -between(200, 900), accountId: 'sbi-savings', methodId: 'm-gpay', merchant: pick(['PVR Cinemas', 'BookMyShow']), category: 'Entertainment' }, '20:00');
  }

  // A trip: load the forex card, spend in dollars, lose a little on the way home.
  const load = addDays(today, -52);
  add({ kind: 'transfer', date: load, amount: -84600, accountId: 'sbi-savings', toAccountId: 'tc-forex', toAmount: 1000, merchant: 'Forex card load', category: 'Transfer' });
  const trip: [number, number, string, string][] = [
    [-44, -38.5, 'Blue Bottle Coffee', 'Food & dining'],
    [-43, -126, 'Hotel Zetta SF', 'Travel'],
    [-43, -24.8, 'BART', 'Transport'],
    [-42, -61.2, 'Tartine Bakery', 'Food & dining'],
    [-41, -212, 'Apple Union Square', 'Shopping'],
  ];
  for (const [d, amt, merchant, category] of trip) {
    add({ kind: 'expense', date: addDays(today, d), amount: amt, accountId: 'tc-forex', methodId: 'm-tc-card', merchant, category });
  }

  add({ kind: 'income', date: addDays(today, -26), amount: 38500, accountId: 'sbi-savings', methodId: 'm-paypal', merchant: 'Upwork payout', category: 'Freelance' });

  // Fresh imports, still waiting for a human to confirm their categories.
  const imported: [number, number, string, string][] = [
    [-2, -12000, 'NEFT — 8821094', 'Everything else'],
    [-1, -3450, 'UPI — 9f2ac1@okicici', 'Everything else'],
    [-1, -486, 'Swiggy Instamart', 'Groceries'],
  ];
  for (const [d, amt, merchant, category] of imported) {
    add({ kind: 'expense', date: addDays(today, d), amount: amt, accountId: 'sbi-savings', merchant, category, source: 'import', autoCategorized: true }, '23:30');
  }

  const ids: DigitalId[] = [
    { id: 'id-aadhaar', type: 'aadhaar', label: 'Aadhaar', number: '000000001234', holder: 'Your Name', inDigiLocker: true },
    { id: 'id-pan', type: 'pan', label: 'PAN', number: 'ABCDE0000F', holder: 'Your Name', inDigiLocker: true },
    { id: 'id-dl', type: 'dl', label: 'Driving licence', number: 'KA0000000000000', holder: 'Your Name', issuedOn: '2019-02-11', expiresOn: '2039-02-10', inDigiLocker: true },
    { id: 'id-passport', type: 'passport', label: 'Passport', number: 'Z0000000', holder: 'Your Name', issuedOn: '2017-06-02', expiresOn: addDays(today, 150) },
  ];

  const subscriptions: Subscription[] = [
    { id: 'sub-netflix', name: 'Netflix', amount: 649, nextCharge: nextOn(today, 14), methodId: 'm-icici-card', frequency: 'monthly' },
    { id: 'sub-figma', name: 'Figma', amount: 1290, nextCharge: nextOn(today, 18), methodId: 'm-link', frequency: 'monthly' },
    { id: 'sub-icloud', name: 'iCloud+', amount: 219, nextCharge: nextOn(today, 22), methodId: 'm-gpay', frequency: 'monthly' },
  ];

  return {
    ...base,
    transactions: txs,
    budgets: [
      { category: 'Food & dining', limit: 9000 },
      { category: 'Groceries', limit: 7000 },
      { category: 'Transport', limit: 3500 },
      { category: 'Shopping', limit: 6000 },
    ],
    subscriptions,
    ids,
    accounts: base.accounts.map((a) => (a.id === 'tc-forex' ? { ...a, fxRate: 84.6 } : a)),
  };
}

/** The next date falling on day-of-month `dom`, today included. */
function nextOn(today: string, dom: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const target = new Date(y, m - 1 + (d > dom ? 1 : 0), dom);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}
