/**
 * Indian gold rates, from IBJA (India Bullion and Jewellers Association).
 *
 * IBJA's rate is India's benchmark — RBI prices Sovereign Gold Bonds off it —
 * so it is the "Indian" figure, unlike COMEX spot times USD/INR, which leaves
 * out import duty and the domestic premium. IBJA has no public API; its home
 * page carries the numbers we need:
 *
 *   - `#HdnGold`: a hidden input holding JSON — about four months of daily PM
 *     rates for 999 and 916 purity, ₹ per 10 g, dates as dd/mm/yyyy.
 *   - `#GoldRatesCompare999` (and 995, 916, 750, 585): the latest ₹ per gram.
 *
 * The desktop app fetches the page in Rust (`fetch_ibja_rates`); the dev
 * server proxies `/ibja/`. Both hand this module raw HTML. Rates are GST-free
 * and not published on weekends or central-government holidays.
 */
import { desktop } from './desktop';

export type Purity = '999' | '995' | '916' | '750' | '585';

export interface GoldPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** ₹ per gram. */
  p999: number;
  p916: number;
}

export interface GoldRates {
  series: GoldPoint[];
  /** Latest published ₹ per gram, by purity. */
  latest: Partial<Record<Purity, number>>;
  /** When this copy was fetched, ISO timestamp. */
  fetchedAt: string;
}

const ENTITIES: Record<string, string> = { '&quot;': '"', '&#34;': '"', '&amp;': '&', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

function decode(s: string): string {
  return s.replace(/&(?:quot|#34|amp|#39|lt|gt);/g, (m) => ENTITIES[m]);
}

const isRate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Throws with a readable message when the page no longer looks like IBJA's. */
export function parseIbja(html: string, fetchedAt = new Date().toISOString()): GoldRates {
  const hidden = /id="HdnGold"[^>]*?value="([^"]*)"/.exec(html) ?? /value="([^"]*)"[^>]*?id="HdnGold"/.exec(html);
  if (!hidden) throw new Error('IBJA’s page changed — the gold history is no longer where it was.');

  let raw: { labels?: unknown; purity999?: unknown; purity916?: unknown };
  try {
    raw = JSON.parse(decode(hidden[1]));
  } catch {
    throw new Error('IBJA’s gold history could not be read.');
  }
  const { labels, purity999, purity916 } = raw;
  if (!Array.isArray(labels) || !Array.isArray(purity999) || !Array.isArray(purity916)) {
    throw new Error('IBJA’s gold history is missing its dates or rates.');
  }

  const series: GoldPoint[] = [];
  labels.forEach((label, i) => {
    const m = typeof label === 'string' ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(label) : null;
    const p999 = purity999[i];
    const p916 = purity916[i];
    if (!m || !isRate(p999) || !isRate(p916)) return;
    // IBJA's history is per 10 g; everything on screen is per gram.
    series.push({ date: `${m[3]}-${m[2]}-${m[1]}`, p999: p999 / 10, p916: p916 / 10 });
  });
  series.sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 2) throw new Error('IBJA published too few gold rates to chart.');

  const latest: GoldRates['latest'] = {};
  for (const purity of ['999', '995', '916', '750', '585'] as const) {
    const hit = new RegExp(`id="GoldRatesCompare${purity}"[^>]*>\\s*([\\d,.]+)\\s*<`).exec(html);
    const value = hit ? Number(hit[1].replace(/,/g, '')) : NaN;
    if (isRate(value)) latest[purity] = value;
  }
  // The history's last close stands in if the ticker is missing.
  const last = series[series.length - 1];
  latest['999'] ??= Math.round(last.p999);
  latest['916'] ??= Math.round(last.p916);

  return { series, latest, fetchedAt };
}

const CACHE_KEY = 'axonix:gold:ibja';
/** IBJA publishes twice a day; an hour-old copy is current enough. */
export const GOLD_FRESH_MS = 60 * 60 * 1000;

export function cachedGold(): GoldRates | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoldRates;
    return Array.isArray(parsed.series) && parsed.series.length > 1 ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchGold(): Promise<GoldRates> {
  let html: string;
  if (desktop) {
    html = await desktop.fetchIbjaRates();
  } else {
    const res = await fetch('/ibja/');
    if (!res.ok) throw new Error(`IBJA answered ${res.status}`);
    html = await res.text();
  }
  const rates = parseIbja(html);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
  } catch {
    // A cache that cannot be written only costs a refetch.
  }
  return rates;
}
