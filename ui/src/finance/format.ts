/**
 * Number and date formatting for the finance surface.
 *
 * Every figure in the design is Indian-grouped (₹48,62,400 — lakh/crore, not
 * thousands) and set in Azeret Mono. Negatives use U+2212 MINUS SIGN, not a
 * hyphen: at 42px the hyphen is visibly too short and sits too high.
 */

/** U+2212. The design uses it everywhere a figure is negative. */
export const MINUS = '\u2212';

const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export interface MoneyOptions {
  /** Render `+` on positive values. Off by default; the design only signs deltas. */
  signed?: boolean;
  /** Drop the ₹. Used by budget rows, which read "58,000 / 60,000". */
  bare?: boolean;
}

/** `-3782400` → `−₹37,82,400`; `384000, {signed:true}` → `+₹3,84,000`. */
export function money(value: number, { signed = false, bare = false }: MoneyOptions = {}): string {
  const sign = value < 0 ? MINUS : signed && value > 0 ? '+' : '';
  return `${sign}${bare ? '' : '₹'}${grouped.format(Math.abs(value))}`;
}

const groupedPaise = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Like `money`, but keeps paise when there are any: `₹649.50`, and `₹649` when whole. */
export function rupees(value: number): string {
  if (Math.round(Math.abs(value) * 100) % 100 === 0) return money(value);
  return `${value < 0 ? MINUS : ''}₹${groupedPaise.format(Math.abs(value))}`;
}

/** `480000` → `₹4.8L`. Used only where space is tight (the emergency-fund row). */
export function lakh(value: number): string {
  const sign = value < 0 ? MINUS : '';
  const l = Math.abs(value) / 100_000;
  // 4.8L, but 6L rather than 6.0L — trailing zeros read as false precision.
  const n = l % 1 === 0 ? String(l) : l.toFixed(1);
  return `${sign}₹${n}L`;
}

/** `4.2` → `▲ 4.2%`, `-1.8` → `▼ 1.8%`. */
export function delta(pct: number, { spaced = true }: { spaced?: boolean } = {}): string {
  const gap = spaced ? ' ' : '';
  return `${pct < 0 ? '▼' : '▲'}${gap}${Math.abs(pct).toFixed(1)}%`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** ISO `2026-09-11` → `11 SEP`. Parsed by hand: `new Date('…')` shifts by timezone. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`;
}

/** ISO `2026-09-11` → `September 2026`. */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** Mask an account number the way the cards do: `•••• 4821`. */
export function masked(last4: string): string {
  return `•••• ${last4}`;
}

/* ------------------------------------------------------------------ */
/* currencies                                                          */
/* ------------------------------------------------------------------ */

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'AUD', 'CAD', 'THB'] as const;

const SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', JPY: '¥', AUD: 'A$', CAD: 'C$', THB: '฿',
};

export function currencySymbol(code: string): string {
  return SYMBOL[code] ?? `${code} `;
}

const western = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const westernCents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Money in any currency. INR keeps lakh grouping via `money`; everything else
 * groups in thousands, because `$1,20,000` would be wrong in its own way.
 */
export function moneyIn(value: number, currency: string, opts: MoneyOptions = {}): string {
  if (currency === 'INR') return money(value, opts);
  const sign = value < 0 ? MINUS : opts.signed && value > 0 ? '+' : '';
  // $537.50, not $537.5 — but $1,000 rather than $1,000.00.
  const fmt = Number.isInteger(Math.round(Math.abs(value) * 100) / 100) ? western : westernCents;
  return `${sign}${opts.bare ? '' : currencySymbol(currency)}${fmt.format(Math.abs(value))}`;
}

/* ------------------------------------------------------------------ */
/* local calendar dates                                                */
/*                                                                     */
/* Every date in the ledger is a LOCAL calendar day. `toISOString()`   */
/* is UTC, which in IST reports yesterday until 05:30 — so nothing     */
/* here goes near it.                                                  */
/* ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, '0');

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayIso(): string {
  return isoOf(new Date());
}

/** Local midnight for an ISO day. */
export function dateOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = dateOf(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86_400_000);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `Today`, `Yesterday`, else `Mon 08 Sep` (with the year when it is not this year). */
export function dayLabel(iso: string, today = todayIso()): string {
  const diff = daysBetween(iso, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = dateOf(iso);
  const base = `${WEEKDAYS[d.getDay()]} ${shortDate(iso)}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${iso.slice(0, 4)}`;
}

/** `11:42` from a full ISO timestamp, in local time. */
export function clockOf(stamp: string | Date): string {
  const d = typeof stamp === 'string' ? new Date(stamp) : stamp;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `2y 4m`, `5m`, `12d` — coarse distance for expiry chips. */
export function spanLabel(days: number): string {
  const abs = Math.abs(days);
  if (abs < 45) return `${abs}d`;
  const months = Math.round(abs / 30.44);
  if (months < 12) return `${months}m`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y}y ${m}m` : `${y}y`;
}

/** Clamped whole-percent, for progress bars. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}
