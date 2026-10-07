/**
 * The task model.
 *
 * A task is a markdown file in the vault's `Tasks/` folder: its fields are the
 * YAML frontmatter, its notes and subtasks are the body, its project is the
 * folder it sits in, and its title is the file name. Nothing here is stored
 * anywhere else, so Obsidian, the Axonix board and Hermes all see one thing.
 *
 * The column field is `state`, never `status`: in this vault `status:` already
 * means verified / unverified, and a task an agent writes carries
 * `status: unverified` until a person confirms it.
 */

export type TaskState = 'backlog' | 'todo' | 'doing' | 'blocked' | 'done';

export const STATES: { id: TaskState; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Done' },
];

export const STATE_LABEL: Record<TaskState, string> = Object.fromEntries(STATES.map((s) => [s.id, s.label])) as Record<TaskState, string>;

/**
 * A university application's own stage, for the masters project. It is not the
 * board's `state`: a submitted application can still be "doing" while you chase
 * a recommender. Only tasks that carry a `uni` have one.
 */
export type AppStage = 'researching' | 'shortlist' | 'applying' | 'submitted' | 'interview' | 'offer' | 'rejected';

export const APP_STAGES: { id: AppStage; label: string }[] = [
  { id: 'researching', label: 'Researching' },
  { id: 'shortlist', label: 'Shortlist' },
  { id: 'applying', label: 'Applying' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Rejected' },
];
export const APP_STAGE_LABEL = Object.fromEntries(APP_STAGES.map((s) => [s.id, s.label])) as Record<AppStage, string>;

/** 1 is the most urgent, as in Todoist and Vikunja. */
export type Priority = 1 | 2 | 3 | 4;

export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };

/** One file as the file service hands it over. `path` is relative to `Tasks/`, with forward slashes. */
export interface RawFile {
  path: string;
  text: string;
  mtime: number;
}

export interface Task {
  /** From the frontmatter; `path:<path>` for a file nobody has given one yet. */
  id: string;
  path: string;
  title: string;
  /** The folder it sits in; '' for `Tasks/` itself (shown as Inbox). */
  project: string;
  state: TaskState;
  priority?: Priority;
  /** Local calendar day, `YYYY-MM-DD`. */
  due?: string;
  /** The time block's start, local `YYYY-MM-DDTHH:mm`. */
  scheduled?: string;
  /** Minutes. */
  estimate?: number;
  tags: string[];
  /** Position within its column; smaller is higher. */
  order?: number;
  created?: string;
  /** When it first went into Doing (for the Doing → Done time). */
  started?: string;
  /** When it was finished. */
  done?: string;
  /** `status: unverified` — written by an agent, not yet confirmed. */
  unverified: boolean;
  /** The university this task applies to, when it is an application. Its deadline is the task's `due`. */
  uni?: string;
  programme?: string;
  /** ISO 3166 alpha-2, upper case: `DE`, `US`, `NL`. */
  country?: string;
  stage?: AppStage;
  /** The application fee, as written: `100 EUR`. */
  fee?: string;
  /** The application portal. */
  portal?: string;
  /** Frontmatter that could not be read: the file is shown but never rewritten. */
  broken?: string;
  body: string;
  checklist: { done: number; total: number };
  /** The body has text other than checklist lines. */
  hasNotes: boolean;
}

/** Fields a change may set. `null` removes the field from the file. */
export interface TaskPatch {
  title?: string;
  project?: string;
  state?: TaskState;
  priority?: Priority | null;
  due?: string | null;
  scheduled?: string | null;
  estimate?: number | null;
  tags?: string[];
  order?: number;
  started?: string | null;
  done?: string | null;
  /** Only ever `null`: a person confirmed an agent's task. */
  status?: null;
  body?: string;
  uni?: string | null;
  programme?: string | null;
  country?: string | null;
  stage?: AppStage | null;
  fee?: string | null;
  portal?: string | null;
}

export interface TaskDraft {
  title: string;
  uni?: string;
  programme?: string;
  country?: string;
  stage?: AppStage;
  fee?: string;
  portal?: string;
  project?: string;
  state?: TaskState;
  priority?: Priority;
  due?: string;
  scheduled?: string;
  estimate?: number;
  tags?: string[];
  body?: string;
  /** Written by the assistant: the file carries `status: unverified` until a person confirms it. */
  unverified?: boolean;
}
