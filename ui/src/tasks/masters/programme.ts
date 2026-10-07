/**
 * Programmes, read from notes, and what they cost.
 *
 * A programme is a note of `kind: programme` — the degree you might apply to.
 * Money is stored **as it was written on the page** ("€22,000 a year"), because
 * that is what can be checked against the source later; the rupee figure is
 * worked out here, at today's reference rate, and labelled as a conversion.
 * A figure with no `tuition_basis` is treated as an estimate, never as fact.
 */
import { parse } from 'yaml';
import { splitFrontmatter } from '../taskfile';
import type { Note } from '../../notes/notefile';
import type { Deadline } from './scholarship';

export interface Programme {
  path: string;
  title: string;
  uni?: string;
  programme?: string;
  country?: string;
  city?: string;
  language?: string;
  months?: number;
  intakes: string[];
  deadlines: Deadline[];
  tuition?: string;
  tuitionBasis: 'official' | 'estimated' | 'unavailable';
  livingCost?: string;
  portal?: string;
  link?: string;
  source?: string;
  checked?: string;
  /** Set when the programme was found through OpenAlex, so research fit can be looked up. */
  openalexId?: string;
  status?: string;
  note: Note;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' ? v.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : []);
const dayOf = (v: unknown): string | undefined => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
};

function deadlinesOf(value: unknown): Deadline[] {
  const out: Deadline[] = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    if (!item) continue;
    const date = dayOf(item) ?? (typeof item === 'object' ? dayOf((item as Record<string, unknown>).date) : undefined);
    if (!date) continue;
    out.push({ date, cycle: typeof item === 'object' ? str((item as Record<string, unknown>).cycle) : undefined });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function readProgrammes(notes: Note[]): Programme[] {
  return notes
    .filter((n) => n.kind === 'programme')
    .map((note) => {
      const { fm } = splitFrontmatter(note.text);
      let d: Record<string, unknown> = {};
      if (fm) {
        try {
          const parsed = parse(fm) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) d = parsed as Record<string, unknown>;
        } catch {
          // Shown, never rewritten.
        }
      }
      const basis = str(d.tuition_basis);
      const tuitionBasis: Programme['tuitionBasis'] = basis === 'official' || basis === 'unavailable' ? basis : 'estimated';
      return {
        path: note.path,
        title: note.title,
        uni: str(d.uni),
        programme: str(d.programme),
        country: str(d.country)?.toUpperCase().slice(0, 2),
        city: str(d.city),
        language: str(d.language),
        months: num(d.duration_months),
        intakes: list(d.intakes),
        deadlines: deadlinesOf(d.deadlines),
        tuition: str(d.tuition) ?? (typeof d.tuition === 'number' ? String(d.tuition) : undefined),
        tuitionBasis,
        livingCost: str(d.living_cost) ?? (typeof d.living_cost === 'number' ? String(d.living_cost) : undefined),
        portal: str(d.portal),
        link: str(d.link),
        source: str(d.source),
        checked: dayOf(d.checked),
        openalexId: str(d.openalex_id),
        status: str(d.status),
        note,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/* ------------------------------------------------------------------ */
/* money                                                               */
/* ------------------------------------------------------------------ */

export interface Money {
  amount: number;
  currency: string;
  /** What the figure is per, when the text said: a year, a month, the whole course. */
  per: 'year' | 'month' | 'total';
}

const SYMBOL: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '₹': 'INR', 'C$': 'CAD', 'CHF': 'CHF' };

/** A written figure — "€22,000 a year", "₹5 lakh", "CAD 20,635" — as a number. */
export function parseMoney(text?: string): Money | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  const m = /(€|£|\$|₹|C\$|CHF|EUR|USD|GBP|INR|CAD|SEK)\s?([\d][\d,. ]*)/i.exec(t);
  if (!m) return null;
  const currency = SYMBOL[m[1]] ?? m[1].toUpperCase();
  let amount = Number(m[2].replace(/[,\s]/g, ''));
  if (!Number.isFinite(amount)) return null;
  if (/\blakh\b/i.test(t)) amount *= 100_000;
  if (/\bcrore\b/i.test(t)) amount *= 10_000_000;
  if (/\bmillion\b|\bm\b/i.test(t)) amount *= 1_000_000;
  const per: Money['per'] = /\b(a|per)\s*month\b|\/mo\b|monthly/i.test(t) ? 'month' : /\b(a|per)\s*year\b|\/yr\b|annual/i.test(t) ? 'year' : 'total';
  return { amount, currency, per };
}

/** What the whole course costs in its own currency, given how long it runs. */
export function overCourse(money: Money | null, months = 24): number | null {
  if (!money) return null;
  if (money.per === 'total') return money.amount;
  if (money.per === 'year') return Math.round((money.amount * months) / 12);
  return Math.round(money.amount * months);
}

/** `amount` of `currency` in rupees, using rates fetched per base currency. */
export function inRupees(amount: number | null, currency: string, rates: Record<string, number>): number | null {
  if (amount === null) return null;
  if (currency === 'INR') return Math.round(amount);
  const rate = rates[currency];
  return rate ? Math.round(amount * rate) : null;
}

/** ₹12,34,567 — the Indian grouping, because that is who is reading. */
export function rupees(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
