/**
 * The page's side of the door (`electron/door.ts`), Claude's terminal and chat
 * (`electron/terminal.ts`) and Paperclip (`electron/paperclip.ts`).
 *
 * In the dev server there is no main process, so there is no door: no agent
 * can connect, and nothing here pretends one has.
 */

export interface DoorThing {
  kind: string;
  id: string;
  title?: string;
}

export interface DoorEvent {
  type: 'RUN_STARTED' | 'RUN_FINISHED' | 'TOOL_CALL_START' | 'TOOL_CALL_END';
  agent: string;
  at: number;
  callId?: string;
  tool?: string;
  thing?: DoorThing;
  label?: string;
  changed?: boolean;
  failed?: boolean;
}

export interface DoorCall {
  id: string;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface DoorAgentStatus {
  id: string;
  name: string;
  harness: string;
  plan: string;
  hasToken: boolean;
  /** When it last called, ISO; null if it never has. */
  lastSeen: string | null;
  client: string | null;
  acting: boolean;
}

export interface DoorStatus {
  port: number;
  url: string | null;
  chatPanel: boolean;
  agents: DoorAgentStatus[];
}

export interface LoggedCall {
  at: string;
  tool: string;
  result: string;
  label: string;
}

export interface PaperclipAgent {
  id: string;
  name: string;
  status: string;
  adapter: string;
  engine: string;
  heartbeat: boolean;
  budgetCents: number;
  spentCents: number;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  lastRunAt: string | null;
}
export interface WorkOrder {
  id: string;
  name: string;
  title: string;
  status: string;
  /** Not finished or cancelled. A closed one stays a week, for its report. */
  open: boolean;
  assignee: string | null;
  updatedAt: string;
  /** The last few comments, oldest first: what was said to the worker, and what it answered. */
  thread: { from: string; at: string; text: string }[];
}
export interface PaperclipRun {
  id: string;
  agent: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  onPlan: boolean;
}
export type Overview = { running: false } | { running: true; agents: PaperclipAgent[]; orders: WorkOrder[]; runs: PaperclipRun[] };

type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

export interface DoorBridge {
  ready(specs: unknown[]): void;
  onCall(cb: (call: DoorCall) => void): () => void;
  onUndo(cb: (call: DoorCall) => void): () => void;
  result(id: string, result: { output: string; step: { label: string; changed?: boolean; failed?: boolean; thing?: DoorThing } }): void;
  onEvent(cb: (event: DoorEvent) => void): () => void;
  onChanged(cb: () => void): () => void;
  status(): Promise<DoorStatus | null>;
  setChatPanel(on: boolean): Promise<DoorStatus | null>;
  calls(agent: string, from: string, to: string): Promise<LoggedCall[]>;
  termStart(cols: number, rows: number): Promise<{ ok: true; running: boolean } | { ok: false; error: string }>;
  termInput(data: string): void;
  termResize(cols: number, rows: number): void;
  termKill(): void;
  onTermData(cb: (data: string) => void): () => void;
  onTermExit(cb: (code: number) => void): () => void;
  chatSend(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
  chatStop(): void;
  onChatEvent(cb: (event: Record<string, unknown>) => void): () => void;
  agentsOverview(): Promise<Reply<Overview>>;
  agentsStart(): Promise<Reply<Overview>>;
  agentsAssign(issue: string, agent: string): Promise<Reply<Overview>>;
  agentsComment(issue: string, body: string): Promise<Reply<Overview>>;
}

/** Null in the dev server and in the Storeroom's own window's absence of a main bridge. */
export const door: DoorBridge | null = (window as unknown as { axonixDoor?: DoorBridge }).axonixDoor ?? null;
