/**
 * Reading and writing one task file.
 *
 * The file is the owner's, so a write changes only what it was asked to:
 * unknown frontmatter keys, their order, comments and the body all survive
 * (the frontmatter is edited as a YAML document, not re-serialised from an
 * object). A file whose frontmatter cannot be parsed is shown but never
 * rewritten — it is marked `broken` and every change to it is refused.
 *
 * Titles are file names, as in Obsidian. Characters Windows or Obsidian links
 * cannot carry are replaced in the name; the typed title is then kept in a
 * `title:` field, which is ignored as soon as the file is renamed by hand.
 */
import { Document, isMap, parse, parseDocument } from 'yaml';
import type { AppStage, Priority, RawFile, Task, TaskDraft, TaskPatch, TaskState } from './types';

const FENCE = /^---[ \t]*\r?\n/;

export function splitFrontmatter(text: string): { fm: string | null; body: string; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (!FENCE.test(text)) return { fm: null, body: text, eol };
  const start = text.indexOf('\n') + 1;
  // Closing fence: a line that is exactly `---` (or `...`).
  const close = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text.slice(start - 1));
  if (!close) return { fm: null, body: text, eol };
  const fmEnd = start - 1 + close.index;
  const bodyStart = start - 1 + close.index + close[0].length;
  return { fm: text.slice(start, fmEnd), body: text.slice(bodyStart), eol };
}

/* ------------------------------------------------------------------ */
/* values                                                              */
/* ------------------------------------------------------------------ */

const STATE_WORDS: Record<string, TaskState> = {
  backlog: 'backlog', someday: 'backlog', later: 'backlog',
  todo: 'todo', 'to do': 'todo', 'to-do': 'todo', open: 'todo', next: 'todo',
  doing: 'doing', 'in progress': 'doing', 'in-progress': 'doing', active: 'doing', started: 'doing',
  blocked: 'blocked', waiting: 'blocked', 'on hold': 'blocked',
  done: 'done', complete: 'done', completed: 'done', closed: 'done',
};

/** A trimmed text field, or undefined when it is missing or empty. */
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

const STAGE_WORDS: Record<string, AppStage> = {
  researching: 'researching', research: 'researching', considering: 'researching',
  shortlist: 'shortlist', shortlisted: 'shortlist',
  applying: 'applying', 'in progress': 'applying', drafting: 'applying',
  submitted: 'submitted', applied: 'submitted',
  interview: 'interview', interviewing: 'interview',
  offer: 'offer', admitted: 'offer', accepted: 'offer',
  rejected: 'rejected', declined: 'rejected',
};

/** An application's stage, or undefined when the file does not carry one. */
export function stageOf(value: unknown): AppStage | undefined {
  return typeof value === 'string' ? STAGE_WORDS[value.trim().toLowerCase()] : undefined;
}

export function stateOf(value: unknown): TaskState {
  return (typeof value === 'string' && STATE_WORDS[value.trim().toLowerCase()]) || 'todo';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/;

function dayOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (DAY.test(v)) return v;
  const m = STAMP.exec(v);
  return m ? m[1] : undefined;
}

function stampOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = STAMP.exec(value.trim());
  return m ? `${m[1]}T${m[2]}:${m[3]}` : undefined;
}

function priorityOf(value: unknown): Priority | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/^p/i, '')) : NaN;
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : undefined;
}

/** `30m`, `1h`, `1h30m`, `1.5h`, `90` (minutes) → minutes. */
export function parseEstimate(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 0 ? Math.round(value) : undefined;
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(v)) return Number(v) || undefined;
  const m = /^(?:(\d+(?:\.\d+)?)h(?:rs?|ours?)?)?(?:(\d+)m(?:in(?:s|utes?)?)?)?$/.exec(v);
  if (!m || (!m[1] && !m[2])) return undefined;
  const minutes = Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
  return minutes > 0 ? minutes : undefined;
}

/** 30 → `30m`, 60 → `1h`, 90 → `1h30m`. */
export function formatEstimate(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h${m}m` : `${h}h`;
}

function tagsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
  return [...new Set(list.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean))];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Now, as Obsidian writes a date-and-time property: local `YYYY-MM-DDTHH:mm`. */
export function stampNow(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function newTaskId(): string {
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ------------------------------------------------------------------ */
/* the body                                                            */
/* ------------------------------------------------------------------ */

const CHECK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s?)(.*)$/;

export interface ChecklistItem {
  /** Line number in the body. */
  line: number;
  done: boolean;
  text: string;
}

export function checklistItems(body: string): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  body.split(/\r?\n/).forEach((l, line) => {
    const m = CHECK_LINE.exec(l);
    if (m) out.push({ line, done: m[2] !== ' ', text: m[4] });
  });
  return out;
}

/** Tick or untick the checkbox on `line`. */
export function toggleChecklist(body: string, line: number): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const m = CHECK_LINE.exec(lines[line] ?? '');
  if (!m) return body;
  lines[line] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}${m[4]}`;
  return lines.join(eol);
}

/** Add `- [ ] text` after the last checklist line, or at the end. */
export function addChecklist(body: string, text: string): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.replace(/\s+$/, '').split(/\r?\n/);
  const item = `- [ ] ${text.trim()}`;
  const items = checklistItems(body);
  if (!body.trim()) return item + eol;
  if (items.length) {
    lines.splice(items[items.length - 1].line + 1, 0, item);
    return lines.join(eol) + eol;
  }
  return lines.join(eol) + eol + eol + item + eol;
}

export function removeChecklist(body: string, line: number): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  if (!CHECK_LINE.test(lines[line] ?? '')) return body;
  lines.splice(line, 1);
  return lines.join(eol);
}

/* ------------------------------------------------------------------ */
/* names and paths                                                     */
/* ------------------------------------------------------------------ */

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A title as a file name: nothing Windows or an Obsidian link can't carry. */
export function sanitizeName(title: string): string {
  let name = title
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
    .trim();
  if (!name) name = 'Untitled';
  if (RESERVED.test(name)) name = `${name}_`;
  return name;
}

export function baseName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.replace(/\.md$/i, '');
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** A free path for `title` in `project`, never one in `taken` (compared case-insensitively, as Windows does). */
export function pathFor(project: string, title: string, taken: Iterable<string>, self?: string): string {
  const used = new Set([...taken].map((p) => p.toLowerCase()));
  if (self) used.delete(self.toLowerCase());
  const dir = project ? `${project}/` : '';
  const name = sanitizeName(title);
  let candidate = `${dir}${name}.md`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${dir}${name} ${n}.md`;
  return candidate;
}

/** `README.md` in a project folder is the project's page, not a task. */
export function isTaskPath(path: string): boolean {
  return /\.md$/i.test(path) && baseName(path).toLowerCase() !== 'readme';
}

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

export function parseTask(file: RawFile): Task {
  const { fm, body } = splitFrontmatter(file.text);
  let data: Record<string, unknown> = {};
  let broken: string | undefined;
  if (fm !== null && fm.trim()) {
    try {
      const parsed = parse(fm);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
      else broken = 'The properties at the top of this file are not a list of fields.';
    } catch (e) {
      broken = `The properties at the top of this file could not be read (${e instanceof Error ? e.message.split('\n')[0] : String(e)}).`;
    }
  }

  const name = baseName(file.path);
  const typed = typeof data.title === 'string' ? data.title.trim() : '';
  // The typed title only while the file still carries its sanitised name:
  // a file renamed in Obsidian takes its new name.
  const title = typed && sanitizeName(typed) === name ? typed : name;

  const items = checklistItems(body);
  const prose = body
    .split(/\r?\n/)
    .filter((l) => !CHECK_LINE.test(l))
    .join('')
    .trim();

  return {
    id: typeof data.id === 'string' && data.id.trim() ? data.id.trim() : `path:${file.path}`,
    path: file.path,
    title,
    project: folderOf(file.path),
    state: stateOf(data.state),
    priority: priorityOf(data.priority),
    due: dayOf(data.due),
    scheduled: stampOf(data.scheduled),
    estimate: parseEstimate(data.estimate),
    tags: tagsOf(data.tags),
    order: typeof data.order === 'number' && Number.isFinite(data.order) ? data.order : undefined,
    created: stampOf(data.created) ?? (dayOf(data.created) ? `${dayOf(data.created)}T00:00` : undefined),
    started: stampOf(data.started),
    done: stampOf(data.done) ?? (dayOf(data.done) ? `${dayOf(data.done)}T00:00` : undefined),
    unverified: typeof data.status === 'string' && data.status.trim().toLowerCase() === 'unverified',
    uni: str(data.uni),
    programme: str(data.programme) ?? str(data.program),
    country: str(data.country)?.toUpperCase().slice(0, 2),
    stage: stageOf(data.stage),
    fee: str(data.fee) ?? (typeof data.fee === 'number' ? String(data.fee) : undefined),
    portal: str(data.portal),
    broken,
    body,
    checklist: { done: items.filter((i) => i.done).length, total: items.length },
    hasNotes: prose.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* writing                                                             */
/* ------------------------------------------------------------------ */

/** New keys go in this order; keys already in the file stay where they are. */
const KEY_ORDER = ['id', 'title', 'state', 'priority', 'due', 'scheduled', 'estimate', 'tags', 'uni', 'programme', 'country', 'stage', 'fee', 'portal', 'order', 'created', 'started', 'done'];

type FieldValue = string | number | string[] | null;

function fieldsOf(patch: TaskPatch, title: string | undefined): Record<string, FieldValue | undefined> {
  const f: Record<string, FieldValue | undefined> = {};
  if (title !== undefined) f.title = title;
  if (patch.state !== undefined) f.state = patch.state;
  if (patch.priority !== undefined) f.priority = patch.priority;
  if (patch.due !== undefined) f.due = patch.due;
  if (patch.scheduled !== undefined) f.scheduled = patch.scheduled;
  if (patch.estimate !== undefined) f.estimate = patch.estimate === null ? null : formatEstimate(patch.estimate);
  if (patch.tags !== undefined) f.tags = patch.tags.length ? patch.tags : null;
  if (patch.order !== undefined) f.order = Math.round(patch.order * 1000) / 1000;
  if (patch.started !== undefined) f.started = patch.started;
  if (patch.done !== undefined) f.done = patch.done;
  if (patch.status !== undefined) f.status = null;
  // The masters project's fields; only applications carry them.
  if (patch.uni !== undefined) f.uni = patch.uni;
  if (patch.programme !== undefined) f.programme = patch.programme;
  if (patch.country !== undefined) f.country = patch.country === null ? null : patch.country.toUpperCase().slice(0, 2);
  if (patch.stage !== undefined) f.stage = patch.stage;
  if (patch.fee !== undefined) f.fee = patch.fee;
  if (patch.portal !== undefined) f.portal = patch.portal;
  return f;
}

function setAll(doc: Document, fields: Record<string, FieldValue | undefined>) {
  for (const key of KEY_ORDER.concat(Object.keys(fields).filter((k) => !KEY_ORDER.includes(k)))) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (value === undefined) continue;
    if (value === null) doc.delete(key);
    else doc.set(key, value);
  }
}

/**
 * Frontmatter + body. A body read from the file is kept byte for byte; a new
 * one is separated from the properties by one blank line, as Obsidian does.
 */
function render(doc: Document, body: string, eol: string, bodyIsNew: boolean): string {
  const empty = !isMap(doc.contents) || doc.contents.items.length === 0;
  const yamlText = empty ? '' : doc.toString({ lineWidth: 0 }).replace(/\n$/, '');
  const head = empty ? '' : `---\n${yamlText}\n---\n`;
  const fixedHead = eol === '\n' ? head : head.replace(/\n/g, eol);
  if (!bodyIsNew) return fixedHead + body;
  const trimmed = body.replace(/^(\r?\n)+/, '');
  const text = (head && trimmed ? '\n' : '') + trimmed;
  return fixedHead + (eol === '\n' ? text : text.replace(/\r?\n/g, eol));
}

/**
 * Apply `patch` to a file's text. `title` is the value for the `title:` field:
 * a string when the file name could not carry the typed title, `null` to drop
 * it, undefined to leave it alone. `id` is written when the file has none.
 */
export function applyPatch(text: string, patch: TaskPatch, opts: { id?: string; title?: string | null } = {}): string {
  const { fm, body, eol } = splitFrontmatter(text);
  const doc = fm !== null && fm.trim() ? parseDocument(fm) : new Document({});
  if (doc.errors.length) throw new Error('This file’s properties could not be read, so it was not changed.');
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as typeof doc.contents;
  // Give it an id at the very top: the one key the board relies on.
  if (opts.id && !doc.has('id') && isMap(doc.contents)) doc.contents.items.unshift(doc.createPair('id', opts.id));
  setAll(doc, fieldsOf(patch, opts.title === null ? undefined : opts.title));
  if (opts.title === null) doc.delete('title');
  if (patch.body !== undefined) return render(doc, patch.body, eol, true);
  // A file that had no properties yet gets them above its text.
  return render(doc, body, eol, fm === null);
}

/** The text of a brand-new task file. */
export function newTaskText(draft: TaskDraft, id: string, now = stampNow()): string {
  const name = sanitizeName(draft.title);
  const patch: TaskPatch = {
    uni: draft.uni,
    programme: draft.programme,
    country: draft.country,
    stage: draft.stage,
    fee: draft.fee,
    portal: draft.portal,
    state: draft.state ?? 'todo',
    priority: draft.priority,
    due: draft.due,
    scheduled: draft.scheduled,
    estimate: draft.estimate,
    tags: draft.tags,
  };
  const doc = new Document({ id });
  setAll(doc, { ...fieldsOf(patch, name !== draft.title.trim() ? draft.title.trim() : undefined), created: now, ...(draft.unverified ? { status: 'unverified' } : {}) });
  return render(doc, draft.body ? `${draft.body.replace(/\s+$/, '')}\n` : '', '\n', true);
}
