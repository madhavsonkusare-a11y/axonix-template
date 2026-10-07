/**
 * One-line add: `Renew bike insurance fri 3pm #personal !2 30m`.
 *
 * After Vikunja's Quick Add Magic and Todoist's quick add, in the same spirit
 * as Finance's `250 swiggy gpay`: everything that can be read out of the line
 * is, the rest is the title, and the reading is shown before anything is saved.
 *
 *   #word      an existing project, otherwise a tag
 *   +word      a project, created if it does not exist yet ("+"Big move"" for spaces)
 *   !1 … !4    priority (also p1 … p4); 1 is urgent
 *   30m, 1h30m estimate
 *   dates      today, tomorrow, fri, next monday, 22 sep, in 3 days … (chrono-node)
 *   a time     3pm, 15:00 — also schedules a time block that day
 */
import * as chrono from 'chrono-node';
import { formatEstimate, parseEstimate } from './taskfile';
import { PRIORITY_LABEL, type Priority } from './types';

export interface QuickToken {
  kind: 'project' | 'tag' | 'priority' | 'date' | 'time' | 'estimate';
  label: string;
}

export interface QuickParse {
  title: string;
  project?: string;
  /** The project does not exist yet and would be created. */
  newProject?: boolean;
  tags: string[];
  priority?: Priority;
  due?: string;
  scheduled?: string;
  estimate?: number;
  tokens: QuickToken[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const dayIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const MONTH_ONLY = /^(?:in\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?$/i;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

function matchProject(word: string, projects: string[]): string | undefined {
  const w = norm(word);
  return projects.find((p) => norm(p) === w);
}

/** `Mon 22 SEP`, or `Today` / `Tomorrow`. */
export function dueWords(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round((date.getTime() - new Date(ty, tm - 1, td).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return `${WEEKDAYS[date.getDay()]} ${pad2(d)} ${MONTHS[m - 1]}${y !== ty ? ` ${y}` : ''}`;
}

export function parseQuick(input: string, projects: string[], now = new Date()): QuickParse {
  const out: QuickParse = { title: '', tags: [], tokens: [] };
  let rest = ` ${input} `;
  const cut = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      return fn(m) === false ? m[0] : ' ';
    });
  };

  // +project — explicit, may be new. Quoted for names with spaces.
  cut(/\s\+(?:"([^"]+)"|([^\s"]+))(?=\s)/g, (m) => {
    if (out.project) return false;
    const name = (m[1] ?? m[2]).trim().replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
    if (!name) return false;
    const existing = matchProject(name, projects);
    out.project = existing ?? name;
    out.newProject = !existing;
  });

  // #word — a project when one has that name, a tag otherwise.
  cut(/\s#([\p{L}\p{N}_\-/]+)(?=\s)/gu, (m) => {
    const existing = matchProject(m[1], projects);
    if (existing && !out.project) out.project = existing;
    else if (!out.tags.includes(m[1])) out.tags.push(m[1]);
  });

  // !1 … !4, p1 … p4
  cut(/\s(?:!|p)([1-4])(?=\s)/gi, (m) => {
    if (out.priority) return false;
    out.priority = Number(m[1]) as Priority;
  });

  // Estimates: 30m, 45 min, 1h, 1.5h, 1h30m, "for 2h".
  cut(/\s(?:for\s+)?(\d+(?:\.\d+)?\s?(?:h|hr|hrs|hours?)(?:\s?\d+\s?(?:m|min|mins|minutes?))?|\d+\s?(?:m|min|mins|minutes?))(?=\s)/gi, (m) => {
    if (out.estimate) return false;
    const minutes = parseEstimate(m[1]);
    if (!minutes || minutes > 24 * 60) return false;
    out.estimate = minutes;
  });

  // Dates and times, from what is left.
  const results = chrono.parse(rest, now, { forwardDate: true }).filter((r) => !MONTH_ONLY.test(r.text.trim()));
  const hit = results[0];
  if (hit) {
    const d = hit.start.date();
    out.due = dayIso(d);
    if (hit.start.isCertain('hour')) out.scheduled = `${out.due}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    // Take the words with it, and a preposition just before them.
    const before = rest.slice(0, hit.index).replace(/\s(?:on|at|by|due|from)\s*$/i, ' ');
    rest = `${before} ${rest.slice(hit.index + hit.text.length)}`;
  }

  out.title = rest.replace(/\s+/g, ' ').trim().replace(/\s+[-–—:,]$/, '');

  const today = dayIso(now);
  if (out.project) out.tokens.push({ kind: 'project', label: out.newProject ? `New project “${out.project}”` : out.project });
  if (out.due) out.tokens.push({ kind: 'date', label: dueWords(out.due, today) });
  if (out.scheduled) out.tokens.push({ kind: 'time', label: out.scheduled.slice(11) });
  if (out.estimate) out.tokens.push({ kind: 'estimate', label: formatEstimate(out.estimate) });
  if (out.priority) out.tokens.push({ kind: 'priority', label: PRIORITY_LABEL[out.priority] });
  for (const t of out.tags) out.tokens.push({ kind: 'tag', label: `#${t}` });
  return out;
}

/** `3pm`, `15`, `15:30`, `3:30 pm`, `0930` → `HH:mm`, or undefined. */
export function parseClock(value: string): string | undefined {
  const v = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!v) return undefined;
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(v);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3];
  if (min > 59) return undefined;
  if (ampm) {
    if (h < 1 || h > 12) return undefined;
    if (ampm.startsWith('p') && h !== 12) h += 12;
    if (ampm.startsWith('a') && h === 12) h = 0;
  }
  if (h > 23) return undefined;
  return `${pad2(h)}:${pad2(min)}`;
}
