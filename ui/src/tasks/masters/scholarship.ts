/**
 * Scholarships, read from notes, and whether this applicant may have one.
 *
 * A scholarship is a note of `kind: scholarship`: what it covers and when it
 * closes in the frontmatter, the reading and the sources in the body. The
 * matcher below is deliberately small and explainable — it answers **eligible,
 * borderline, no** and always says *why* in a sentence you can argue with.
 * Indian schemes in particular have soft criteria, so "borderline" is a real
 * answer and an unknown fact never becomes a "no".
 *
 * Nothing here is authoritative. Every rule carries the link it came from and
 * the date it was checked; a rule older than a cycle should be re-read before
 * it is trusted.
 */
import { parse } from 'yaml';
import { splitFrontmatter } from '../taskfile';
import type { Note } from '../../notes/notefile';
import type { Profile } from './profile';

export interface Deadline {
  /** What the date is for: "2027 intake", "annual". */
  cycle?: string;
  /** `YYYY-MM-DD`. */
  date: string;
}

export interface Rules {
  nationality?: string[];
  /** Marks on a 100 scale. */
  minPercent?: number;
  maxAge?: number;
  /** Full-time professional work, in years. */
  workYears?: number;
  /** Graduated no longer than this many years ago. */
  gradWithinYears?: number;
  /** The bachelor's must be this many years long (some US fellowships ask for four). */
  degreeYears?: number;
  /** An admission letter has to be in hand first. */
  admissionFirst?: boolean;
  /** Fields it is limited to, matched loosely against the profile's. */
  fields?: string[];
  /** Anything the rules cannot hold, shown as it is. */
  note?: string;
}

export interface Scholarship {
  path: string;
  title: string;
  provider?: string;
  /** Where it can be used; empty means anywhere. */
  countries: string[];
  covers: string[];
  amount?: string;
  /** grant · loan · interest-free loan · assistantship. */
  type?: string;
  /** How you apply: direct · via-university · via-portal. */
  route?: string;
  link?: string;
  source?: string;
  checked?: string;
  deadlines: Deadline[];
  rules: Rules;
  /** Where you are with it, when you have started: applying · applied · won · rejected. */
  status?: string;
  note: Note;
}

export type Level = 'eligible' | 'borderline' | 'no' | 'unknown';

export interface Verdict {
  level: Level;
  /** Why, in plain sentences — the first one is the headline. */
  reasons: string[];
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === 'string' ? v.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : [];

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
    const cycle = typeof item === 'object' ? str((item as Record<string, unknown>).cycle) : undefined;
    out.push({ date, cycle });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function rulesOf(value: unknown): Rules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const r = value as Record<string, unknown>;
  return {
    nationality: list(r.nationality).map((c) => c.toUpperCase()),
    minPercent: num(r.min_percent),
    maxAge: num(r.max_age),
    workYears: num(r.work_years),
    gradWithinYears: num(r.grad_within_years),
    degreeYears: num(r.degree_years),
    admissionFirst: r.admission_first === true,
    fields: list(r.fields).map((f) => f.toLowerCase()),
    note: str(r.note),
  };
}

/** Every scholarship note, parsed. */
export function readScholarships(notes: Note[]): Scholarship[] {
  return notes
    .filter((n) => n.kind === 'scholarship')
    .map((note) => {
      const { fm } = splitFrontmatter(note.text);
      let d: Record<string, unknown> = {};
      if (fm) {
        try {
          const parsed = parse(fm) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) d = parsed as Record<string, unknown>;
        } catch {
          // Shown, never rewritten — as everywhere else.
        }
      }
      return {
        path: note.path,
        title: note.title,
        provider: str(d.provider),
        countries: list(d.countries).map((c) => c.toUpperCase()),
        covers: list(d.covers),
        amount: str(d.amount) ?? (typeof d.amount === 'number' ? String(d.amount) : undefined),
        type: str(d.type),
        route: str(d.route),
        link: str(d.link) ?? note.url,
        source: str(d.source),
        checked: dayOf(d.checked),
        deadlines: deadlinesOf(d.deadlines),
        rules: rulesOf(d.eligibility),
        status: str(d.status),
        note,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The next deadline on or after `today`, or the last one when they have all passed. */
export function nextDeadline(s: Scholarship, today: string): Deadline | undefined {
  return s.deadlines.find((d) => d.date >= today) ?? s.deadlines[s.deadlines.length - 1];
}

/** Whole days from `today` to `iso`; negative once it has passed. */
export function daysTo(iso: string, today: string): number {
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

const loose = (a: string, b: string) => a.includes(b) || b.includes(a);

/**
 * Eligible, borderline or no — and why.
 *
 * A rule the profile cannot answer adds a "check" reason and holds the verdict
 * at borderline; a rule the profile clearly fails is a no. Marks are the one
 * place the matcher is generous: an Indian CGPA converts to a percentage
 * differently at every university, so falling within five points is borderline.
 */
export function check(s: Scholarship, p: Profile, today: string): Verdict {
  const r = s.rules;
  const no: string[] = [];
  const maybe: string[] = [];
  const yes: string[] = [];

  if (r.nationality?.length) {
    if (!p.nationality) maybe.push(`For ${r.nationality.join(', ')} citizens — your nationality is not in the profile`);
    else if (!r.nationality.includes(p.nationality)) no.push(`Only for ${r.nationality.join(', ')} citizens`);
  }

  if (r.workYears !== undefined) {
    if (p.workYears === undefined) maybe.push(`Wants ${r.workYears} years of full-time work — the profile does not say`);
    else if (p.workYears < r.workYears) no.push(`Wants ${r.workYears} years of full-time work, you have ${p.workYears}`);
    else yes.push(`${r.workYears} years of work: met`);
  }

  if (r.minPercent !== undefined) {
    if (p.percent === undefined) maybe.push(`Wants ${r.minPercent}% or more — no marks in the profile`);
    else if (p.percent + 5 < r.minPercent) no.push(`Wants ${r.minPercent}%, your marks work out near ${Math.round(p.percent)}%`);
    else if (p.percent < r.minPercent) maybe.push(`Wants ${r.minPercent}% — yours is near ${Math.round(p.percent)}%, and conversions differ by university`);
    else yes.push(`Marks: about ${Math.round(p.percent)}%`);
  }

  if (r.maxAge !== undefined) {
    if (p.age === undefined) maybe.push(`Under ${r.maxAge} only — the profile has no age`);
    else if (p.age >= r.maxAge) no.push(`For applicants under ${r.maxAge}`);
  }

  if (r.gradWithinYears !== undefined && p.graduation !== undefined) {
    const years = Number(today.slice(0, 4)) - p.graduation;
    if (years > r.gradWithinYears) no.push(`For graduates of the last ${r.gradWithinYears} years`);
    else yes.push(`Graduated ${p.graduation}: inside the window`);
  }

  if (r.degreeYears !== undefined) {
    if (p.degreeYears === undefined) maybe.push(`Wants a ${r.degreeYears}-year bachelor's (or a master's on top of a 3-year one)`);
    else if (p.degreeYears < r.degreeYears) maybe.push(`Wants a ${r.degreeYears}-year bachelor's — yours is ${p.degreeYears}; a master's or PG diploma usually bridges it`);
  }

  if (r.fields?.length && p.fields.length) {
    const hit = r.fields.some((f) => p.fields.some((mine) => loose(f, mine.toLowerCase())));
    if (!hit) maybe.push(`Limited to ${r.fields.join(', ')}`);
  }

  if (r.admissionFirst) maybe.push('Needs an admission letter first');
  if (r.note) maybe.push(r.note);

  const level: Level = no.length ? 'no' : maybe.length ? 'borderline' : yes.length ? 'eligible' : 'unknown';
  const reasons = no.length ? no.concat(maybe) : maybe.length ? maybe : yes.length ? yes : ['No eligibility rules written down yet'];
  return { level, reasons };
}

export const LEVEL_LABEL: Record<Level, string> = {
  eligible: 'Eligible',
  borderline: 'Check',
  no: 'Not eligible',
  unknown: 'Unknown',
};
