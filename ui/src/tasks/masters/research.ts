/**
 * Asking the main process to look something up.
 *
 * The renderer never fetches: it names a source and gets an answer that has
 * already been allowlisted, rate-limited and cached (`electron/research.ts`).
 * In a plain browser (the dev server) there is no bridge, so everything here
 * says so plainly rather than half-working — the pages that use it show what
 * they have and offer to open the real app.
 */

export interface PageRead {
  url: string;
  title: string;
  text: string;
  fetchedAt: number;
}

export interface KeyState {
  openalex: boolean;
  scorecard: boolean;
}

export interface University {
  name: string;
  country: string;
  alpha_two_code: string;
  domains: string[];
  web_pages: string[];
}

interface Bridge {
  openalex(kind: 'works' | 'authors' | 'institutions' | 'topics', params: Record<string, string>): Promise<unknown>;
  scorecard(params: Record<string, string>): Promise<unknown>;
  ror(query: string): Promise<unknown>;
  universities(query: string, country?: string): Promise<University[]>;
  rates(base: string): Promise<{ base: string; date: string; rates: Record<string, number> }>;
  page(url: string): Promise<PageRead>;
  keys(): Promise<KeyState>;
  setKey(name: 'openalex' | 'scorecard', value: string): Promise<KeyState>;
  cache(action?: 'clear'): Promise<{ files: number; bytes: number }>;
}

const bridge: Bridge | null = typeof window !== 'undefined' ? ((window as unknown as { axonixResearch?: Bridge }).axonixResearch ?? null) : null;

export const canResearch = bridge !== null;

const need = (): Bridge => {
  if (!bridge) throw new Error('Looking things up needs the desktop app.');
  return bridge;
};

export const research = {
  openalex: (kind: 'works' | 'authors' | 'institutions' | 'topics', params: Record<string, string>) => need().openalex(kind, params),
  scorecard: (params: Record<string, string>) => need().scorecard(params),
  ror: (query: string) => need().ror(query),
  universities: (query: string, country?: string) => need().universities(query, country),
  rates: (base: string) => need().rates(base),
  page: (url: string) => need().page(url),
  keys: () => need().keys(),
  setKey: (name: 'openalex' | 'scorecard', value: string) => need().setKey(name, value),
  cache: (action?: 'clear') => need().cache(action),
};

/* ------------------------------------------------------------------ */
/* reading a page the owner pasted                                     */
/* ------------------------------------------------------------------ */

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';

/** Dates a page mentions, as `YYYY-MM-DD`, most likely first. */
export function datesIn(text: string, today: string): string[] {
  const found = new Map<string, number>();
  const add = (iso: string, weight: number) => found.set(iso, Math.max(found.get(iso) ?? 0, weight));
  const year = Number(today.slice(0, 4));

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(`${m[1]}-${m[2]}-${m[3]}`, 3);
  const monthIndex = (name: string) => MONTHS.split('|').indexOf(name.toLowerCase()) + 1;
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\s+(\\d{4})\\b`, 'gi'))) {
    add(`${m[3]}-${String(monthIndex(m[2])).padStart(2, '0')}-${m[1].padStart(2, '0')}`, 2);
  }
  for (const m of text.matchAll(new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'))) {
    add(`${m[3]}-${String(monthIndex(m[1])).padStart(2, '0')}-${m[2].padStart(2, '0')}`, 2);
  }
  return [...found.entries()]
    .filter(([iso]) => {
      const y = Number(iso.slice(0, 4));
      return y >= year - 1 && y <= year + 4;
    })
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([iso]) => iso)
    .slice(0, 6);
}

/** Money a page mentions, as written, biggest-looking first. */
export function amountsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:€|£|\$|₹|EUR|USD|GBP|INR|CAD|CHF|SEK)\s?[\d][\d,.\s]{2,12}(?:\s?(?:lakh|crore|million|k|per year|a year|a month|per month))?/gi)) {
    out.add(m[0].replace(/\s+/g, ' ').trim());
  }
  return [...out].slice(0, 8);
}

/** What a page suggests for a scholarship or programme note, for the owner to confirm. */
export function draftFrom(read: PageRead, today: string): { link: string; source: string; checked: string; title: string; dates: string[]; amounts: string[] } {
  return {
    link: read.url,
    source: read.url,
    checked: today,
    title: read.title.replace(/\s*[|·—-]\s*[^|·—-]{0,40}$/, '').trim(),
    dates: datesIn(read.text, today),
    amounts: amountsIn(read.text),
  };
}

/** `amount` in rupees, when the rate for its currency is known. */
export function toInr(amount: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === 'INR') return amount;
  const rate = rates[currency.toUpperCase()];
  return rate ? Math.round(amount * rate) : null;
}
