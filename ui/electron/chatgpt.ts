/**
 * The assistant's side of the main process: Sign in with ChatGPT and requests
 * on the owner's plan (`chatgpt-core.ts`), offered to the window over IPC.
 *
 * What is kept, and where:
 *   - `assistant.json` beside the finance file: this installation's id, the
 *     client id OpenAI issued, who is connected, the chosen model. Nothing in
 *     it signs anyone in.
 *   - `assistant-credentials.bin`: the tokens, encrypted by Windows for this
 *     user (Electron `safeStorage`, DPAPI). A ChatGPT access token is too long
 *     for a Credential Manager entry, which is where the Google one lives.
 *
 * The page never receives a token. It asks for a response and gets the text
 * and the model's tool calls back; the tools themselves run in the page,
 * against the same state the screens use.
 */
import { ipcMain, safeStorage, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AssistantError, createChatGPT, type AssistantSecrets, type AssistantState, type RespondRequest } from './chatgpt-core';

interface Options {
  dataDir: string;
  dev: boolean;
  isHost: (sender: WebContents) => boolean;
  send: (channel: string, payload: unknown) => void;
  log: (line: string) => void;
}

const USAGE_URL = 'https://chatgpt.com/settings/usage';
/** A conversation with its tool results is text; this is far above any real one. */
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; recovery: string } };

export function registerAssistant({ dataDir, dev, isHost, send, log }: Options) {
  // A dev run can point both of OpenAI's hosts at a local stand-in, to exercise the whole flow.
  const mock = dev ? process.env.AXONIX_OPENAI_MOCK : undefined;
  const statePath = path.join(dataDir, dev ? 'assistant.dev.json' : 'assistant.json');
  const secretsPath = path.join(dataDir, dev ? 'assistant-credentials.dev.bin' : 'assistant-credentials.bin');

  const writeAtomic = (file: string, data: string | Buffer) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  };

  let state: AssistantState | null = null;
  const readState = (): AssistantState => {
    if (state) return state;
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as AssistantState;
      state = parsed && typeof parsed === 'object' ? parsed : { version: 1 };
    } catch {
      state = { version: 1 };
    }
    return state;
  };
  const writeState = (next: AssistantState) => {
    state = next;
    writeAtomic(statePath, JSON.stringify(next, null, 2));
  };

  // Decrypted once and held in memory; on disk only ever as Windows encrypted it.
  let secrets: AssistantSecrets | null | undefined;
  const readSecrets = (): AssistantSecrets | null => {
    if (secrets !== undefined) return secrets;
    try {
      const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsPath))) as AssistantSecrets;
      secrets = typeof parsed?.accessToken === 'string' && typeof parsed.expiresAt === 'number' ? parsed : null;
    } catch {
      secrets = null;
    }
    return secrets;
  };
  const writeSecrets = (next: AssistantSecrets | null) => {
    if (next === null) {
      secrets = null;
      fs.rmSync(secretsPath, { force: true });
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) throw new AssistantError('no_secure_storage', 'Windows could not protect the sign-in on this account, so it was not saved.');
    writeAtomic(secretsPath, safeStorage.encryptString(JSON.stringify(next)));
    secrets = next;
  };

  const gpt = createChatGPT({
    issuer: mock ?? 'https://auth.openai.com',
    api: mock ? `${mock}/v1` : 'https://api.openai.com/v1',
    appName: 'Axonix',
    // Against the stand-in, "the browser" is a plain request that follows the redirect back.
    openBrowser: mock
      ? async (url) => {
          const first = await fetch(url, { redirect: 'manual' });
          const to = first.headers.get('location');
          if (to) await fetch(to);
        }
      : (url) => shell.openExternal(url),
    readState,
    writeState,
    readSecrets,
    writeSecrets,
    log,
  });

  const fail = (e: unknown): Reply<never> => {
    if (e instanceof AssistantError) return { ok: false, error: { code: e.code, message: e.message, recovery: e.recovery } };
    const text = e instanceof Error ? e.message : String(e);
    // A dropped connection reaches here as a bare "fetch failed".
    const offline = /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|network|timed? ?out|aborted due to timeout/i.test(text);
    return { ok: false, error: { code: offline ? 'offline' : 'failed', message: offline ? 'ChatGPT could not be reached. Check the connection and try again.' : text.slice(0, 300), recovery: offline ? 'retry' : 'none' } };
  };
  const handle = <T,>(channel: string, run: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T) =>
    ipcMain.handle(channel, async (event, ...args): Promise<Reply<T>> => {
      if (!isHost(event.sender)) return { ok: false, error: { code: 'not_allowed', message: 'Not allowed from this window.', recovery: 'none' } };
      try {
        return { ok: true, value: await run(event, ...args) };
      } catch (e) {
        return fail(e);
      }
    });

  handle('assistant:status', () => gpt.status());
  handle('assistant:sign-in', () => gpt.signIn());
  handle('assistant:cancel-sign-in', () => gpt.cancelSignIn());
  handle('assistant:sign-out', () => gpt.signOut());
  handle('assistant:models', (_e, fresh) => gpt.models(fresh === true));
  handle('assistant:set-model', (_e, slug) => {
    if (typeof slug !== 'string' || !slug || slug.length > 200) throw new AssistantError('invalid', 'That is not a model.');
    gpt.setModel(slug);
    return gpt.status();
  });
  handle('assistant:welcomed', () => {
    gpt.setWelcomed();
    return gpt.status();
  });
  handle('assistant:self-test', () => gpt.selfTest());
  handle('assistant:open-usage', () => {
    void shell.openExternal(USAGE_URL);
  });

  // One response. Text and finished items are sent as they arrive; the call resolves with the whole output.
  const running = new Map<string, AbortController>();
  handle('assistant:respond', async (_e, id, request) => {
    if (typeof id !== 'string' || !id || id.length > 80 || running.has(id)) throw new AssistantError('invalid', 'That request cannot be started.');
    const req = request as Partial<RespondRequest> | null;
    if (!req || typeof req.instructions !== 'string' || !Array.isArray(req.input) || (req.tools !== undefined && !Array.isArray(req.tools)) || (req.model !== undefined && typeof req.model !== 'string'))
      throw new AssistantError('invalid', 'That request is not one Axonix sends.');
    if (Buffer.byteLength(JSON.stringify(req)) > MAX_REQUEST_BYTES) throw new AssistantError('too_large', 'That conversation has grown too long to send. Start a new one.');
    const control = new AbortController();
    running.set(id, control);
    try {
      return await gpt.respond({ model: req.model, instructions: req.instructions, input: req.input, tools: req.tools }, (event) => send('assistant:event', { id, ...event }), control.signal);
    } finally {
      running.delete(id);
    }
  });
  handle('assistant:cancel', (_e, id) => {
    if (typeof id === 'string') running.get(id)?.abort();
  });
}
