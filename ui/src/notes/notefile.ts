/**
 * One Axonix note: its kind, project and other properties, read from and
 * written to the file's frontmatter.
 *
 * Notes made in Axonix live flat in the vault's `Notes/` folder — a place the
 * page never names. A note is found by what it is (a meeting, an idea …),
 * which project it belongs to, and when it was touched, not by where it sits.
 * The file name is the title; the frontmatter is edited as a YAML document, so
 * keys the page does not know, their order and comments survive.
 */
import { Document, isMap, parseDocument } from 'yaml';
import { splitFrontmatter } from '../tasks/taskfile';

export const NOTES_DIR = 'Notes';

export type NoteKind = 'note' | 'meeting' | 'idea' | 'reference' | 'decision' | 'programme' | 'scholarship' | 'person' | 'profile';

export const KINDS: { id: NoteKind; label: string; hint: string }[] = [
  { id: 'note', label: 'Note', hint: 'Anything' },
  { id: 'meeting', label: 'Meeting', hint: 'Date, people, action items' },
  { id: 'idea', label: 'Idea', hint: 'A pitch that can become a project' },
  { id: 'reference', label: 'Reference', hint: 'A link and what matters in it' },
  { id: 'decision', label: 'Decision', hint: 'Context, choice and why' },
  { id: 'programme', label: 'Programme', hint: 'A degree you might apply to' },
  { id: 'scholarship', label: 'Scholarship', hint: 'Money, who may have it, when it closes' },
  { id: 'person', label: 'Person', hint: 'A professor or contact, and the thread with them' },
  { id: 'profile', label: 'Profile', hint: 'Your own marks, tests and budget' },
];
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<NoteKind, string>;

/** What a new note of each kind starts with. */
export const TEMPLATES: Record<NoteKind, string> = {
  note: '',
  meeting: '## Agenda\n\n- \n\n## Notes\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n',
  idea: '**The pitch:** \n\n## Why it matters\n\n\n## How it could work\n\n',
  reference: '## Summary\n\n\n## Worth keeping\n\n- \n',
  decision: '## Context\n\n\n## Options\n\n- \n\n## Decision\n\n\n## Why\n\n',
  // Tuition, deadlines and visa money change every intake, so each of these
  // ends in Sources: a figure without where it came from is not worth keeping.
  programme:
    '## Why this one\n\n\n## Cost\n\n| What | Amount | Basis |\n| --- | --- | --- |\n| Tuition | | official / estimated / unavailable |\n| Living | | |\n\n## Requirements\n\n- [ ] \n\n## Deadlines\n\n- \n\n## Research here\n\n\n## Sources\n\n- \n',
  scholarship:
    '## What it covers\n\n\n## Who may have it\n\n- \n\n## When it closes\n\n- \n\n## How to apply\n\n\n## Sources\n\n- \n',
  person: '## Their work\n\n\n## Why I would fit\n\n\n## Thread\n\n- \n',
  profile:
    '## Degree\n\n\n## Tests\n\n| Test | Status | Score | Valid until |\n| --- | --- | --- | --- |\n| IELTS / TOEFL | | | |\n| GRE | | | |\n\n## Experience and work\n\n\n## What I want to study\n\n\n## Money\n\n- Budget ceiling:\n- Loan appetite:\n',
};

export interface Note {
  path: string;
  title: string;
  kind: NoteKind;
  /** '' when it belongs to no project. */
  project: string;
  pinned: boolean;
  /** Meeting or decision day, `YYYY-MM-DD`. */
  date?: string;
  people: string[];
  url?: string;
  text: string;
  body: string;
  /** Plain text of the first lines, for cards. */
  excerpt: string;
  mtime: number;
  checks: { done: number; total: number };
  /** Frontmatter that could not be read: the note is shown, never rewritten. */
  broken?: string;
}

export interface NoteProps {
  title?: string | null;
  kind?: NoteKind;
  project?: string | null;
  pinned?: boolean | null;
  date?: string | null;
  people?: string[] | null;
  url?: string | null;
}

const KIND_SET = new Set<string>(KINDS.map((k) => k.id));
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const day = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
};

export const noteTitle = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
export const isNotePath = (path: string) => path.toLowerCase().startsWith(`${NOTES_DIR.toLowerCase()}/`) && !path.slice(NOTES_DIR.length + 1).includes('/') && /\.md$/i.test(path);

/** Markdown to a line of plain text, for a card. */
function plain(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^(#{1,6}\s|```|---|\|)/.test(l.trim()))
    .map((l) =>
      l
        .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '')
        .replace(/^>\s?(\[![^\]]*\]\s*)?/, '')
        .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' · ')
    .slice(0, 280);
}

export function parseNote(path: string, text: string, mtime: number): Note {
  const { fm, body } = splitFrontmatter(text);
  let data: Record<string, unknown> = {};
  let broken: string | undefined;
  if (fm !== null && fm.trim()) {
    const doc = parseDocument(fm);
    if (doc.errors.length) broken = 'Its properties could not be read.';
    else {
      const js = doc.toJS() as unknown;
      if (js && typeof js === 'object' && !Array.isArray(js)) data = js as Record<string, unknown>;
    }
  }
  const kind = typeof data.kind === 'string' && KIND_SET.has(data.kind) ? (data.kind as NoteKind) : 'note';
  const people = Array.isArray(data.people) ? data.people.map(String).map((p) => p.trim()).filter(Boolean) : typeof data.people === 'string' ? data.people.split(',').map((p) => p.trim()).filter(Boolean) : [];
  let done = 0;
  let total = 0;
  for (const m of body.matchAll(/^\s*[-*+]\s+\[([ xX])\]/gm)) {
    total++;
    if (m[1] !== ' ') done++;
  }
  return {
    path,
    title: str(data.title) ?? noteTitle(path),
    kind,
    project: str(data.project) ?? '',
    pinned: data.pinned === true,
    date: day(data.date),
    people,
    url: str(data.url),
    text,
    body,
    excerpt: plain(body),
    mtime,
    checks: { done, total },
    broken,
  };
}

/** Every property in the note's frontmatter, as written. */
export function readFields(text: string): Record<string, unknown> {
  const { fm } = splitFrontmatter(text);
  if (!fm || !fm.trim()) return {};
  try {
    const doc = parseDocument(fm);
    if (doc.errors.length) return {};
    const js = doc.toJS() as unknown;
    return js && typeof js === 'object' && !Array.isArray(js) ? (js as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * `text` with any frontmatter keys set — `null` removes one, a dotted key
 * (`eligibility.max_age`) reaches one level in. Keys the page does not know,
 * their order and comments survive, as everywhere else.
 */
export function setFields(text: string, fields: Record<string, unknown>): string {
  const { fm, body, eol } = splitFrontmatter(text);
  const doc = fm !== null && fm.trim() ? parseDocument(fm) : new Document({});
  if (doc.errors.length) throw new Error('This note’s properties could not be read, so they were not changed.');
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as typeof doc.contents;
  for (const [key, value] of Object.entries(fields)) {
    const path = key.split('.');
    if (value === null || value === undefined || value === '') {
      if (path.length === 1) doc.delete(path[0]);
      else doc.deleteIn(path);
      continue;
    }
    if (path.length === 1) doc.set(path[0], value);
    else {
      if (!doc.hasIn([path[0]])) doc.set(path[0], doc.createNode({}));
      doc.setIn(path, value);
    }
  }
  const empty = !isMap(doc.contents) || doc.contents.items.length === 0;
  const head = empty ? '' : `---\n${doc.toString({ lineWidth: 0 }).replace(/\n$/, '')}\n---\n`;
  const fixed = eol === '\n' ? head : head.replace(/\n/g, eol);
  const lead = fm === null && head && body && !/^\r?\n/.test(body) ? eol : '';
  return fixed + lead + body;
}

/** Everything before the body: the frontmatter block, byte for byte. */
export function headOf(text: string): string {
  const { body } = splitFrontmatter(text);
  return text.slice(0, text.length - body.length);
}

const ORDER = ['title', 'kind', 'project', 'date', 'people', 'url', 'pinned'];

/** `text` with `props` set (null removes a key). The body is untouched. */
export function setNoteProps(text: string, props: NoteProps): string {
  const { fm, body, eol } = splitFrontmatter(text);
  const doc = fm !== null && fm.trim() ? parseDocument(fm) : new Document({});
  if (doc.errors.length) throw new Error('This note’s properties could not be read, so they were not changed.');
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as typeof doc.contents;
  const values: Record<string, unknown> = {
    title: props.title === '' ? null : props.title,
    kind: props.kind === 'note' ? null : props.kind,
    project: props.project === '' ? null : props.project,
    date: props.date,
    people: props.people && !props.people.length ? null : props.people,
    url: props.url === '' ? null : props.url,
    pinned: props.pinned === false ? null : props.pinned,
  };
  for (const key of ORDER) {
    if (!(key in props)) continue;
    const v = values[key];
    if (v === undefined) continue;
    if (v === null) doc.delete(key);
    else doc.set(key, v);
  }
  const empty = !isMap(doc.contents) || doc.contents.items.length === 0;
  const head = empty ? '' : `---\n${doc.toString({ lineWidth: 0 }).replace(/\n$/, '')}\n---\n`;
  const fixed = eol === '\n' ? head : head.replace(/\n/g, eol);
  // A note that had no properties gets a blank line between them and its text.
  const lead = fm === null && head && body && !/^\r?\n/.test(body) ? eol : '';
  return fixed + lead + body;
}

/**
 * Properties a new note of this kind starts with, empty, so the fields the
 * page reads are already there to fill in rather than remembered. A key left
 * blank is simply absent as far as everything else is concerned.
 */
export const SCAFFOLD: Partial<Record<NoteKind, string>> = {
  scholarship: [
    'provider:',
    'countries: []',
    'covers: []',
    'amount:',
    'type: grant',
    'route:',
    'link:',
    'source:',
    'checked:',
    'deadlines:',
    "  - { cycle: '', date: }",
    'eligibility:',
    '  nationality: []',
    '  min_percent:',
    '  max_age:',
    '  work_years:',
    '  grad_within_years:',
    '  admission_first: false',
    '  fields: []',
    '  note:',
  ].join('\n'),
  programme: ['uni:', 'programme:', 'country:', 'city:', 'language:', 'intakes: []', 'tuition:', 'living_cost:', 'deadlines:', "  - { cycle: '', date: }", 'link:', 'source:', 'checked:'].join('\n'),
  person: ['prof:', 'uni:', 'lab:', 'topics: []', 'emailed:', 'replied:', 'followup:', 'link:'].join('\n'),
};

/** The text of a new note: its properties, the kind's scaffold, then its template. */
export function newNoteText(kind: NoteKind, project: string, extra: NoteProps = {}): string {
  const text = setNoteProps(TEMPLATES[kind], { kind, project, ...extra });
  const scaffold = SCAFFOLD[kind];
  if (!scaffold) return text;
  const { fm, body } = splitFrontmatter(text);
  // With properties already there, the scaffold joins them; without, it makes them.
  if (fm === null) return `---\n${scaffold}\n---\n\n${body.replace(/^\n+/, '')}`;
  return `---\n${fm.replace(/\n$/, '')}\n${scaffold}\n---\n${body}`;
}

/** Open checklist items under an "Action items" heading that are not tasks yet (a task is `[[Title]]`). */
export function actionItems(body: string): { line: number; text: string }[] {
  const lines = body.split('\n');
  const out: { line: number; text: string }[] = [];
  let inside = false;
  lines.forEach((l, i) => {
    const h = /^#{1,6}\s+(.*)$/.exec(l);
    if (h) {
      inside = /action items?|next steps|to ?dos?/i.test(h[1]);
      return;
    }
    if (!inside) return;
    const m = /^\s*[-*+]\s+\[ \]\s+(.+?)\s*$/.exec(l);
    if (m && !/^\[\[/.test(m[1])) out.push({ line: i, text: m[1] });
  });
  return out;
}
