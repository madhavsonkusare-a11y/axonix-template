/**
 * University applications: the masters project's own shape.
 *
 * An application is an ordinary task file that carries a `uni` — its deadline
 * is the task's `due`, its stage is `stage`, and the documents it needs are the
 * checklist in its body. Nothing here is a separate store: the board, the
 * dashboard and the timeline all read the same files.
 *
 * The country checklists below are what an **Indian** applicant needs, which is
 * not the same list anyone else gets: Germany wants an APS certificate, the UK
 * wants ATAS for aerospace, mechanical and nuclear subjects, the US and Canada
 * want a WES evaluation. Every figure that goes stale (a blocked-account
 * amount, a fee) belongs in the note for that requirement with its source and
 * the date it was checked — never hard-coded here.
 */
import type { Task } from './types';
import { checklistItems } from './taskfile';

export interface Country {
  code: string;
  name: string;
  /** Extra steps on top of the common list. */
  steps: string[];
  /** What the paperwork is called there, for the readiness widget. */
  gate?: string;
}

/** The common documents every application needs. */
export const COMMON_DOCS = [
  'Transcripts',
  'Degree certificate',
  'CV',
  'Statement of purpose',
  'LOR 1',
  'LOR 2',
  'English test score',
  'Passport',
  'Application fee paid',
];

export const COUNTRIES: Country[] = [
  { code: 'DE', name: 'Germany', gate: 'APS', steps: ['APS certificate', 'uni-assist VPD (if asked)', 'Blocked account', 'National visa appointment'] },
  { code: 'US', name: 'United States', gate: 'WES', steps: ['WES / NACES evaluation', 'GRE (if the programme asks)', 'Funding proof', 'I-20', 'F-1 visa interview'] },
  { code: 'CA', name: 'Canada', gate: 'WES', steps: ['WES ECA', 'Proof of funds / GIC', 'Study permit'] },
  { code: 'GB', name: 'United Kingdom', gate: 'ATAS', steps: ['ATAS certificate (aerospace, mechanical, nuclear …)', 'CAS from the university', 'IELTS UKVI', 'Student visa'] },
  { code: 'NL', name: 'Netherlands', steps: ['Diploma evaluation', 'Studielink enrolment', 'MVV entry visa + residence permit'] },
  { code: 'SE', name: 'Sweden', steps: ['universityadmissions.se application', 'Residence permit for studies'] },
  { code: 'CH', name: 'Switzerland', steps: ['Recognition of degree', 'Residence permit'] },
  { code: 'AU', name: 'Australia', steps: ['Genuine Student statement', 'OSHC health cover', 'Student visa (500)'] },
];

export const COUNTRY_NAME = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name])) as Record<string, string>;

/** The body a new application starts with: the common documents, then the country's own steps. */
export function applicationBody(country?: string): string {
  const c = COUNTRIES.find((x) => x.code === country);
  const lines = ['## Documents', '', ...COMMON_DOCS.map((d) => `- [ ] ${d}`)];
  if (c) lines.push('', `## ${c.name}`, '', ...c.steps.map((s) => `- [ ] ${s}`));
  lines.push('', '## Notes', '', '');
  return lines.join('\n');
}

/** True for a task that stands for an application to a university. */
export const isApplication = (t: Task) => Boolean(t.uni);

/** Every document line in an application, ticked or not. */
export function documentsOf(task: Task): { label: string; done: boolean }[] {
  return checklistItems(task.body).map((i) => ({ label: i.text.trim(), done: i.done }));
}

/** How a document name is compared across applications ("LOR 1" and "lor 1" are one column). */
export const docKey = (label: string) => label.toLowerCase().replace(/\s+/g, ' ').trim();
