/**
 * Quick entry: one line of text in, a transaction draft out.
 *
 *   250 swiggy gpay              → expense ₹250 · Swiggy · Food & dining · via Google Pay
 *   1.2k groceries blinkit yday  → expense ₹1,200 · Blinkit · Groceries · yesterday
 *   salary 1.42L icici           → income ₹1,42,000 · Salary · into ICICI Salary
 *   transfer 15k icici to groww  → transfer ICICI Salary → Groww Demat
 *   $38 blue bottle forex        → expense $38 on the Thomas Cook card
 *
 * Deliberately a parser, not a model: it runs on every keystroke, offline, and
 * always shows its reading as editable fields underneath — so a wrong guess
 * costs one click, never a wrong row. Anything it categorises is marked
 * `autoCategorized` until the owner confirms it.
 *
 * The same `categorize` keyword table backs CSV import.
 */
import type { Account, FinanceData, PaymentMethod } from './types';
import { BRANDS } from './brands';
import { addDays, dateOf, isoOf, todayIso } from './format';
import { learnedCategory } from './ledger';

export interface ParsedEntry {
  kind: 'expense' | 'income' | 'transfer';
  amount?: number;
  /** Set when the text carried a non-rupee symbol, e.g. `$38`. */
  currency?: string;
  date?: string;
  methodId?: string;
  accountId?: string;
  toAccountId?: string;
  category?: string;
  categoryLearned?: boolean;
  merchant: string;
}

/* ------------------------------------------------------------------ */
/* categories                                                          */
/* ------------------------------------------------------------------ */

const KEYWORDS: [string, string[]][] = [
  ['Groceries', ['instamart', 'blinkit', 'zepto', 'bigbasket', 'big basket', 'dmart', 'jiomart', 'grocery', 'groceries', 'grocer', 'supermarket', 'vegetables', 'milk', 'kirana']],
  ['Food & dining', ['swiggy', 'zomato', 'restaurant', 'cafe', 'coffee', 'chai', 'chaayos', 'blue tokai', 'third wave', 'starbucks', 'pizza', 'dominos', 'burger', 'mcdonald', 'kfc', 'subway', 'lunch', 'dinner', 'breakfast', 'snacks', 'bakery', 'food', 'tea', 'biryani']],
  ['Rent & bills', ['rent', 'electricity', 'bescom', 'water bill', 'gas', 'broadband', 'wifi', 'internet', 'jio', 'airtel', 'recharge', 'maintenance', 'society', 'bill', 'dth']],
  ['Transport', ['uber', 'ola', 'rapido', 'metro', 'bus', 'auto', 'cab', 'petrol', 'fuel', 'diesel', 'parking', 'toll', 'fastag', 'bart']],
  ['Shopping', ['amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'decathlon', 'ikea', 'croma', 'meesho', 'shopping', 'clothes', 'shoes']],
  ['Health', ['pharmacy', 'apollo', 'medplus', 'netmeds', '1mg', 'hospital', 'clinic', 'doctor', 'practo', 'medicine', 'gym', 'cult fit', 'cultfit']],
  ['Subscriptions', ['netflix', 'spotify', 'prime video', 'hotstar', 'youtube premium', 'icloud', 'google one', 'figma', 'notion', 'adobe', 'chatgpt', 'claude', 'subscription']],
  ['Entertainment', ['pvr', 'inox', 'bookmyshow', 'movie', 'concert', 'steam', 'playstation', 'game']],
  ['Travel', ['flight', 'indigo', 'air india', 'makemytrip', 'goibibo', 'cleartrip', 'hotel', 'airbnb', 'oyo', 'irctc', 'train', 'trip', 'visa fee']],
  ['Gifts & family', ['gift', 'birthday', 'wedding', 'donation', 'family', 'mom', 'dad']],
  ['Salary', ['salary', 'payroll']],
  ['Freelance', ['upwork', 'fiverr', 'freelance', 'invoice', 'client', 'payout']],
  ['Refunds', ['refund', 'cashback', 'reversal']],
  ['Interest', ['interest', 'dividend']],
];

const INCOME_CATEGORIES = new Set(['Salary', 'Freelance', 'Refunds', 'Interest']);

const hasWord = (text: string, word: string) =>
  new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text);

/**
 * Keyword category for a description. `sign` keeps a salary-looking debit out
 * of Salary and a Swiggy refund out of Food.
 */
export function categorize(description: string, sign: 1 | -1, known: string[]): string | undefined {
  const text = description.toLowerCase();
  for (const [category, words] of KEYWORDS) {
    if (!known.includes(category)) continue;
    if (INCOME_CATEGORIES.has(category) !== (sign > 0)) continue;
    if (words.some((w) => hasWord(text, w))) return category;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* the parser                                                          */
/* ------------------------------------------------------------------ */

const FILLER = new Set(['paid', 'pay', 'spent', 'spend', 'for', 'at', 'on', 'to', 'via', 'using', 'with', 'from', 'rs', 'inr', 'by', 'a', 'an', 'the', 'in', 'of', 'and', 'my', 'into', 'got', 'received', 'bought']);
const INCOME_WORDS = ['salary', 'received', 'got', 'refund', 'cashback', 'credited', 'income', 'payout', 'interest', 'dividend', 'freelance'];
const TRANSFER_WORDS = ['transfer', 'transferred', 'move', 'moved', 'self', 'sip', 'topup', 'top up', 'load', 'loaded'];

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

interface Target { alias: string; method?: PaymentMethod; account?: Account; rank: number }

/** Every word that can name a method or account, longest first. */
function targets(data: FinanceData): Target[] {
  const out: Target[] = [];
  for (const a of data.accounts) {
    if (a.archived) continue;
    out.push({ alias: a.name.toLowerCase(), account: a, rank: 3 });
    const brandAliases = a.brand ? BRANDS[a.brand].aliases : [];
    // A bare brand word ("sbi") names the everyday account, not the PF one.
    const everyday = !['provident', 'demat', 'gold', 'deposit'].includes(a.kind);
    for (const alias of brandAliases) out.push({ alias, account: a, rank: everyday ? 1 : 0 });
    if (a.kind === 'forex') out.push({ alias: 'forex', account: a, rank: 2 });
  }
  for (const m of data.methods) {
    out.push({ alias: m.name.toLowerCase(), method: m, rank: 3 });
    // Card and wallet methods share a brand with their bank; only UPI apps and
    // wallets own their brand word outright.
    if (m.brand && m.kind !== 'card') for (const alias of BRANDS[m.brand].aliases) out.push({ alias, method: m, rank: 2 });
    if (m.kind === 'card') out.push({ alias: `${m.brand ?? ''} card`.trim(), method: m, rank: 2 });
  }
  return out.sort((a, b) => b.alias.length - a.alias.length || b.rank - a.rank);
}

function parseDate(text: string, today: string): { date: string; match: string } | undefined {
  let m = text.match(/\b(day before yesterday)\b/);
  if (m) return { date: addDays(today, -2), match: m[0] };
  m = text.match(/\b(yesterday|yday|yest)\b/);
  if (m) return { date: addDays(today, -1), match: m[0] };
  m = text.match(/\b(today|tod)\b/);
  if (m) return { date: today, match: m[0] };

  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/);
  const m2 = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m || m2) {
    const day = Number(m ? m[1] : m2![2]);
    const month = MONTHS[(m ? m[2] : m2![1]).slice(0, 3)];
    const t = dateOf(today);
    let d = new Date(t.getFullYear(), month, day);
    if (d > t) d = new Date(t.getFullYear() - 1, month, day);
    return { date: isoOf(d), match: (m ?? m2)![0] };
  }

  m = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m) {
    const t = dateOf(today);
    let d = new Date(t.getFullYear(), Number(m[2]) - 1, Number(m[1]));
    if (d > t) d = new Date(t.getFullYear() - 1, Number(m[2]) - 1, Number(m[1]));
    return { date: isoOf(d), match: m[0] };
  }

  // Whole day names only — a prefix match would read "wedding" as Wednesday.
  m = text.match(/\b(?:last\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const target = DAYS.indexOf(m[1].slice(0, 3));
    const back = (dateOf(today).getDay() - target + 7) % 7 || 7;
    return { date: addDays(today, -back), match: m[0] };
  }
  return undefined;
}

function parseAmount(text: string): { amount: number; currency?: string; match: string } | undefined {
  const m = text.match(/([$€£])?\s*(?:₹|\brs\.?\s*|\binr\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|l|lakh|lac|lakhs|cr)?(?![a-z0-9/])/);
  if (!m) return undefined;
  let amount = Number(m[2].replace(/,/g, ''));
  const unit = m[3];
  if (unit === 'k') amount *= 1_000;
  else if (unit === 'cr') amount *= 10_000_000;
  else if (unit) amount *= 100_000;
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return { amount, currency: m[1] ? SYMBOLS[m[1]] : undefined, match: m[0] };
}

const titleCase = (s: string) =>
  s.replace(/\b([a-z])([a-z]*)/g, (_, a: string, rest: string) => a.toUpperCase() + rest);

export function parseEntry(input: string, data: FinanceData, today = todayIso()): ParsedEntry {
  let text = ` ${input.toLowerCase().replace(/[→>]/g, ' to ')} `;
  const take = (fragment: string) => {
    text = text.replace(fragment, ' ');
  };

  const entry: ParsedEntry = { kind: 'expense', merchant: '' };

  const date = parseDate(text, today);
  if (date) {
    entry.date = date.date;
    take(date.match);
  }

  const amount = parseAmount(text);
  if (amount) {
    entry.amount = amount.amount;
    entry.currency = amount.currency;
    take(amount.match);
  }

  const explicit = text.match(/#([a-z&]+)/);
  if (explicit) {
    const hit = data.categories.find((c) => c.name.toLowerCase().startsWith(explicit[1]));
    if (hit) entry.category = hit.name;
    take(explicit[0]);
  }

  // Accounts and methods, longest alias first so "sbi pf" beats "sbi".
  const found: { t: Target; at: number }[] = [];
  for (const t of targets(data)) {
    if (!t.alias) continue;
    const re = new RegExp(`(^|[^a-z0-9])(to\\s+)?${t.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`);
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    if (found.some((f) => (t.account && f.t.account?.id === t.account.id) || (t.method && f.t.method?.id === t.method.id))) continue;
    found.push({ t: { ...t, alias: m[2] ? `to ${t.alias}` : t.alias }, at: m.index });
    take(m[0].replace(/^[^a-z0-9$]/, ''));
  }
  found.sort((a, b) => a.at - b.at);

  const accounts = found.filter((f) => f.t.account);
  const method = found.find((f) => f.t.method)?.t.method;
  const words = text.split(/\s+/).filter(Boolean);
  const has = (list: string[]) => list.some((w) => hasWord(` ${input.toLowerCase()} `, w));

  if (has(TRANSFER_WORDS) || accounts.length >= 2 || accounts.some((a) => a.t.alias.startsWith('to '))) {
    // "sip 15k groww": one account named, and it is somewhere money is put —
    // so it is the destination, and the source is left for the sheet to ask.
    const lone = accounts.length === 1 && ['provident', 'demat', 'gold', 'deposit', 'forex'].includes(accounts[0].t.account!.kind);
    const to = accounts.find((a) => a.t.alias.startsWith('to ')) ?? (lone ? accounts[0] : accounts[1]);
    const from = accounts.find((a) => a !== to);
    if (to) {
      entry.kind = 'transfer';
      entry.toAccountId = to.t.account!.id;
      entry.accountId = from?.t.account!.id ?? method?.accountId;
    }
  }
  if (entry.kind !== 'transfer') {
    if (has(INCOME_WORDS) || input.trim().startsWith('+')) entry.kind = 'income';
    if (method) entry.methodId = method.id;
    entry.accountId = accounts[0]?.t.account!.id ?? method?.accountId;
  }

  if (entry.currency && !entry.accountId) {
    const foreign = data.accounts.find((a) => a.currency === entry.currency && !a.archived);
    if (foreign) {
      entry.accountId = foreign.id;
      entry.methodId ??= data.methods.find((m) => m.accountId === foreign.id)?.id;
    }
  }

  // Keep the owner's casing where they typed any ("PVR"), title-case the rest.
  const typed = new Map(input.split(/\s+/).map((w) => [w.toLowerCase(), w]));
  let merchantWords = words.filter((w) => !FILLER.has(w) && !TRANSFER_WORDS.includes(w) && !/^[^a-z0-9]+$/.test(w));
  // "groceries blinkit" is Blinkit, filed under Groceries; "refund amazon" is
  // Amazon. A category or kind word is only the merchant when it is alone.
  const labelWords = new Set([
    ...data.categories.map((c) => c.name.toLowerCase().split(/[\s&]+/)[0]),
    ...INCOME_WORDS,
  ]);
  const named = merchantWords.filter((w) => !labelWords.has(w));
  if (named.length > 0) {
    for (const w of merchantWords) {
      if (!labelWords.has(w) || entry.category) continue;
      const hit = data.categories.find((c) => c.name.toLowerCase().startsWith(w));
      if (hit) entry.category = hit.name;
    }
    merchantWords = named;
  }
  entry.merchant = merchantWords
    .map((w) => {
      const original = typed.get(w);
      return original && /[A-Z]/.test(original) ? original : titleCase(w);
    })
    .join(' ');

  if (!entry.category && entry.kind !== 'transfer') {
    const names = data.categories.map((c) => c.name);
    const learned = entry.merchant ? learnedCategory(data, entry.merchant) : undefined;
    if (learned) {
      entry.category = learned;
      entry.categoryLearned = true;
    } else {
      entry.category = categorize(input, entry.kind === 'income' ? 1 : -1, names);
    }
  }
  if (!entry.merchant && entry.category) entry.merchant = entry.category;

  return entry;
}
