/**
 * The applicant's own facts, read from the profile note.
 *
 * One note of `kind: profile` holds marks, degree, tests, work and money; every
 * eligibility check and fit score reads it, so there is one place to correct
 * and nothing is asked twice. The fields live in the note's frontmatter (the
 * body is for prose), and a field nobody filled in is *unknown*, never zero —
 * an unknown turns a verdict into "check", not into "no".
 */
import { parse } from 'yaml';
import { splitFrontmatter } from '../taskfile';
import type { Note } from '../../notes/notefile';

export interface Profile {
  /** ISO 3166 alpha-2, upper case. */
  nationality?: string;
  /** Marks as written, plus the scale they are on (10 or 4 for a CGPA, 100 for a percentage). */
  cgpa?: number;
  scale?: number;
  /** The same marks as a percentage, when that can be worked out. */
  percent?: number;
  graduation?: number;
  /** Length of the bachelor's degree in years — some fellowships ask for four. */
  degreeYears?: number;
  workYears?: number;
  age?: number;
  fields: string[];
  topics: string[];
  budgetInr?: number;
  loanInr?: number;
  countries: string[];
  tests: Record<string, string>;
  /** Where it came from, so the page can offer to open it. */
  path?: string;
}

const EMPTY: Profile = { fields: [], topics: [], countries: [], tests: {} };

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[, ₹]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter(Boolean)
    : typeof v === 'string'
      ? v.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
      : [];

/**
 * A CGPA as a percentage. India has no single conversion — most universities
 * publish their own, and WES uses the transcript's — so this is the common
 * rough one (CGPA × 9.5 on a 10-point scale) and is only ever used to *widen*
 * a verdict, never to fail one.
 */
function percentOf(cgpa?: number, scale?: number): number | undefined {
  if (cgpa === undefined) return undefined;
  if (scale === 100 || cgpa > 10) return cgpa;
  if (scale === 4) return (cgpa / 4) * 100;
  return cgpa * 9.5;
}

export function readProfile(notes: Note[]): Profile {
  const note = notes.find((n) => n.kind === 'profile');
  if (!note) return EMPTY;
  const { fm } = splitFrontmatter(note.text);
  let data: Record<string, unknown> = {};
  if (fm) {
    try {
      const parsed = parse(fm) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      // A profile whose properties cannot be read is the same as an empty one.
    }
  }
  const cgpa = num(data.cgpa);
  const scale = num(data.cgpa_scale) ?? (cgpa !== undefined && cgpa > 10 ? 100 : 10);
  const tests: Record<string, string> = {};
  if (data.tests && typeof data.tests === 'object' && !Array.isArray(data.tests)) {
    for (const [k, v] of Object.entries(data.tests as Record<string, unknown>)) tests[k.toLowerCase()] = String(v);
  }
  return {
    nationality: typeof data.nationality === 'string' ? data.nationality.trim().toUpperCase().slice(0, 2) : undefined,
    cgpa,
    scale,
    percent: num(data.percent) ?? percentOf(cgpa, scale),
    graduation: num(data.graduation),
    degreeYears: num(data.degree_years),
    workYears: num(data.work_years),
    age: num(data.age),
    fields: list(data.fields),
    topics: list(data.topics),
    budgetInr: num(data.budget_inr),
    loanInr: num(data.loan_inr),
    countries: list(data.countries).map((c) => c.toUpperCase()),
    tests,
    path: note.path,
  };
}
