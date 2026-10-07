/**
 * The assistant's bridge to the main process (`electron/chatgpt.ts`).
 *
 * In the app, sign-in and every request happen in the main process; the page
 * never holds a token. In the dev server there is no main process, so a small
 * stand-in answers instead. It is not a model: it recognises a few phrasings
 * and calls the same tools, so the loop, the steps and Undo can be exercised
 * in a browser. The panel says so wherever it is in use.
 */

export interface AssistantStatus {
  connected: boolean;
  /** The account allowed its ChatGPT plan to be used here. */
  sharing: boolean;
  signingIn: boolean;
  /** Was connected; the sign-in ran out or was removed in ChatGPT's settings. */
  expired: boolean;
  email?: string;
  name?: string;
  model?: string;
  welcomed: boolean;
}

export type Recovery = 'usage' | 'sign-in' | 'retry' | 'none';

export class AssistantFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public recovery: Recovery = 'none',
  ) {
    super(message);
  }
}

export interface ModelChoice {
  slug: string;
  name: string;
}

export type OutputItem = Record<string, unknown> & { type?: string };

export interface RespondRequest {
  model?: string;
  instructions: string;
  input: unknown[];
  tools?: unknown[];
}

export interface RespondResult {
  output: OutputItem[];
  text: string;
  model: string;
}

export type StreamEvent = { type: 'text'; delta: string } | { type: 'item'; item: OutputItem };

export interface AssistantBridge {
  /** False in the dev server: answers come from the stand-in, not from ChatGPT. */
  real: boolean;
  status(): Promise<AssistantStatus>;
  signIn(): Promise<AssistantStatus>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<{ revoked: boolean }>;
  models(fresh?: boolean): Promise<ModelChoice[]>;
  setModel(slug: string): Promise<AssistantStatus>;
  welcomed(): Promise<AssistantStatus>;
  selfTest(): Promise<{ name: string; ok: boolean; detail: string }[]>;
  openUsage(): void;
  respond(id: string, request: RespondRequest, onEvent: (event: StreamEvent) => void): Promise<RespondResult>;
  cancel(id: string): void;
}

type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; recovery: Recovery } };

interface Desktop {
  status(): Promise<Reply<AssistantStatus>>;
  signIn(): Promise<Reply<AssistantStatus>>;
  cancelSignIn(): Promise<Reply<void>>;
  signOut(): Promise<Reply<{ revoked: boolean }>>;
  models(fresh?: boolean): Promise<Reply<ModelChoice[]>>;
  setModel(slug: string): Promise<Reply<AssistantStatus>>;
  welcomed(): Promise<Reply<AssistantStatus>>;
  selfTest(): Promise<Reply<{ name: string; ok: boolean; detail: string }[]>>;
  openUsage(): Promise<Reply<void>>;
  respond(id: string, request: RespondRequest): Promise<Reply<RespondResult>>;
  cancel(id: string): Promise<Reply<void>>;
  onEvent(cb: (event: StreamEvent & { id: string }) => void): () => void;
}

const desktop = (window as unknown as { axonixAssistant?: Desktop }).axonixAssistant;

async function unwrap<T>(reply: Promise<Reply<T>>): Promise<T> {
  let r: Reply<T>;
  try {
    r = await reply;
  } catch (e) {
    throw new AssistantFailure('failed', e instanceof Error ? e.message : String(e));
  }
  if (r.ok) return r.value;
  throw new AssistantFailure(r.error.code, r.error.message, r.error.recovery);
}

const real: AssistantBridge | null = desktop
  ? {
      real: true,
      status: () => unwrap(desktop.status()),
      signIn: () => unwrap(desktop.signIn()),
      cancelSignIn: () => unwrap(desktop.cancelSignIn()),
      signOut: () => unwrap(desktop.signOut()),
      models: (fresh) => unwrap(desktop.models(fresh)),
      setModel: (slug) => unwrap(desktop.setModel(slug)),
      welcomed: () => unwrap(desktop.welcomed()),
      selfTest: () => unwrap(desktop.selfTest()),
      openUsage: () => void desktop.openUsage(),
      async respond(id, request, onEvent) {
        const off = desktop.onEvent((event) => {
          if (event.id === id) onEvent(event);
        });
        try {
          return await unwrap(desktop.respond(id, request));
        } finally {
          off();
        }
      },
      cancel: (id) => void desktop.cancel(id),
    }
  : null;

/* ------------------------------------------------------------------ */
/* the dev server's stand-in                                           */
/* ------------------------------------------------------------------ */

const DEV_KEY = 'axonix:assistant:dev';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function devState(): { connected: boolean; welcomed: boolean; model?: string } {
  try {
    return { connected: false, welcomed: false, ...(JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}') as object) };
  } catch {
    return { connected: false, welcomed: false };
  }
}
function saveDev(next: { connected: boolean; welcomed: boolean; model?: string }) {
  try {
    localStorage.setItem(DEV_KEY, JSON.stringify(next));
  } catch {
    /* this session only */
  }
}
const devStatus = (): AssistantStatus => {
  const s = devState();
  return { connected: s.connected, sharing: s.connected, signingIn: false, expired: false, email: s.connected ? 'stand-in@dev.server' : undefined, model: s.model, welcomed: s.welcomed };
};

const DEV_MODELS: ModelChoice[] = [
  { slug: 'stand-in', name: 'Stand-in (dev server)' },
  { slug: 'stand-in-small', name: 'Stand-in, small' },
];

/** What the stand-in "decides" to call for a sentence. A real model reads the tools' descriptions instead. */
function standInCalls(said: string): { name: string; args: Record<string, unknown> }[] {
  const t = said.trim();
  let m = /^(?:add|make|create)\s+(?:a\s+)?task\s*:?\s+(.+)$/i.exec(t);
  if (m) return [{ name: 'tasks_create', args: { title: m[1] } }];
  m = /^(?:paid|spent)\s+₹?\s*([\d,]+)\s+(?:for\s+|on\s+)?(.+)$/i.exec(t);
  if (m) return [{ name: 'finance_add_transaction', args: { kind: 'expense', amount: Number(m[1].replace(/,/g, '')), merchant: m[2] } }];
  m = /^(?:note|write a note)\s*:?\s+(.+)$/i.exec(t);
  if (m) return [{ name: 'notes_create', args: { title: m[1].slice(0, 60), body: m[1] } }];
  m = /^(?:finish|done|complete)\s+(.+)$/i.exec(t);
  if (m) return [{ name: 'tasks_list', args: { filter: 'open', query: m[1] } }];
  m = /(?:spend|spent|transactions?|payments?)\s+(?:on|for|at|with)\s+(.+?)\??$/i.exec(t);
  if (m) return [{ name: 'finance_transactions', args: { query: m[1] } }];
  m = /(?:find|search)\s+(?:my\s+)?notes?\s+(?:about|for|on)\s+(.+?)\??$/i.exec(t);
  if (m) return [{ name: 'notes_search', args: { query: m[1] } }];
  if (/today|my day|this week|what.s next|about this/i.test(t))
    return [
      { name: 'tasks_list', args: { filter: 'today' } },
      { name: 'calendar_days', args: {} },
      { name: 'finance_summary', args: {} },
    ];
  if (/money|month|net worth|budget/i.test(t)) return [{ name: 'finance_summary', args: {} }];
  return [];
}

const standIn: AssistantBridge = {
  real: false,
  status: async () => devStatus(),
  async signIn() {
    await wait(700);
    saveDev({ ...devState(), connected: true });
    return devStatus();
  },
  cancelSignIn: async () => undefined,
  async signOut() {
    saveDev({ ...devState(), connected: false });
    return { revoked: true };
  },
  models: async () => DEV_MODELS,
  async setModel(slug) {
    saveDev({ ...devState(), model: slug });
    return devStatus();
  },
  async welcomed() {
    saveDev({ ...devState(), welcomed: true });
    return devStatus();
  },
  async selfTest() {
    await wait(500);
    return [
      { name: 'Models', ok: true, detail: '2 available: Stand-in (dev server), Stand-in, small' },
      { name: 'A streamed answer', ok: true, detail: 'The stand-in answered. This says nothing about ChatGPT.' },
      { name: 'A tool call, there and back', ok: true, detail: 'The stand-in called a tool. This says nothing about ChatGPT.' },
    ];
  },
  openUsage: () => window.open('https://chatgpt.com/settings/usage', '_blank', 'noopener'),
  async respond(id, request, onEvent) {
    cancelled.delete(id);
    const input = request.input as Record<string, unknown>[];
    const last = input[input.length - 1];
    const said = String([...input].reverse().find((i) => i.role === 'user')?.content ?? '')
      .split('\n')
      .pop()!;
    if (/usage limit/i.test(said)) throw new AssistantFailure('subscription_sharing_usage_limit_exceeded', 'The usage limit was reached. It may be your ChatGPT plan’s, or the limit set for Axonix. Review it in ChatGPT’s settings.', 'usage');

    const speak = async (text: string): Promise<RespondResult> => {
      for (const word of text.split(/(?<= )/)) {
        await wait(18);
        if (cancelled.has(id)) throw new AssistantFailure('cancelled', 'Stopped.');
        onEvent({ type: 'text', delta: word });
      }
      const item: OutputItem = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
      return { output: [item], text, model: 'stand-in' };
    };

    await wait(350);
    if (last?.type === 'function_call_output') {
      // Tool results came back: say what they held, plainly.
      const since = input.map((i) => i.role).lastIndexOf('user');
      const results = input.slice(since + 1).filter((i) => i.type === 'function_call_output');
      const lines = results.map((r) => {
        try {
          const o = JSON.parse(String(r.output)) as Record<string, unknown>;
          if (typeof o.refused === 'string') return o.refused;
          if (typeof o.error === 'string') return `That did not work: ${o.error}`;
          if (typeof o.done === 'string') return o.done;
          if (typeof o.count === 'number') return `A tool returned ${o.count} ${o.count === 1 ? 'row' : 'rows'}.`;
          return `A tool returned: ${Object.keys(o).slice(0, 6).join(', ')}.`;
        } catch {
          /* not JSON */
        }
        return String(r.output).slice(0, 120);
      });
      return speak(`${lines.join(' ')} (This is the dev server’s stand-in, not ChatGPT.)`);
    }
    const calls = request.tools?.length ? standInCalls(said) : [];
    if (calls.length === 0) return speak('This is the dev server’s stand-in, not ChatGPT. It understands a few phrasings: “what is on today”, “add a task …”, “paid 450 chai”, “what did I spend on swiggy”, “find notes about …”, “note: …”.');
    const output: OutputItem[] = calls.map((c, i) => ({ type: 'function_call', call_id: `dev_${Date.now()}_${i}`, name: c.name, arguments: JSON.stringify(c.args) }));
    for (const item of output) onEvent({ type: 'item', item });
    return { output, text: '', model: 'stand-in' };
  },
  cancel: (id) => void cancelled.add(id),
};
const cancelled = new Set<string>();

export const assistant: AssistantBridge = real ?? standIn;
