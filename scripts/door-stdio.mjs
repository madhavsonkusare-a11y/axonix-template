#!/usr/bin/env node
/**
 * door-stdio — Axonix's door for a client that starts its MCP servers as
 * programs (the Claude desktop app's chat, Paperclip's worker).
 *
 *   node scripts/door-stdio.mjs --agent claude-desktop
 *
 * It holds nothing and decides nothing: every message on stdin is passed to
 * the door inside the running app (`ui/electron/door.ts`, 127.0.0.1 only) and
 * the answer is written to stdout. The agent's token is read from Windows
 * Credential Manager (`<agent>.Axonix Door`) each time this starts, so no
 * token sits in a config file. `AXONIX_DOOR_TOKEN` overrides it.
 *
 * With Axonix closed there is no door. This still starts, offers no tools,
 * says why when one is called, and tells the client to ask again once Axonix
 * is open.
 *
 * WHICH door.json IS REAL: a program started by the Claude desktop app runs in
 * its sandbox, where %LOCALAPPDATA% can be a stale private copy (see
 * finance-data-guard.mjs). The admin share is read first for that reason.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const agent = args[args.indexOf('--agent') + 1] && args.includes('--agent') ? args[args.indexOf('--agent') + 1] : 'claude-desktop';
const dev = args.includes('--dev');
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const say = (text) => process.stderr.write(`[axonix door] ${text}\n`);

function doorUrl() {
  const local = process.env.AXONIX_DOOR_DIR ?? join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Local'), 'Axonix');
  const twin = /^([A-Za-z]):\\(.*)$/.exec(local);
  const name = dev ? 'door.dev.json' : 'door.json';
  for (const dir of [twin ? `\\\\localhost\\${twin[1].toUpperCase()}$\\${twin[2]}` : null, local]) {
    if (!dir) continue;
    try {
      const file = join(dir, name);
      if (!existsSync(file)) continue;
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof parsed.port === 'number') return `http://127.0.0.1:${parsed.port}/mcp`;
    } catch {
      // The next place is tried.
    }
  }
  return null;
}

function readToken() {
  if (process.env.AXONIX_DOOR_TOKEN) return process.env.AXONIX_DOOR_TOKEN;
  try {
    const require = createRequire(join(repo, 'ui', 'package.json'));
    const { Entry } = require('@napi-rs/keyring');
    return new Entry(dev ? 'Axonix Door (dev)' : 'Axonix Door', agent).getPassword() ?? null;
  } catch (e) {
    say(`could not read the token for ${agent}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

let token = readToken();
let session = null;
/** Whether the last attempt reached the door; the client is told when that turns true. */
let reached = null;

async function forward(message) {
  const url = doorUrl();
  token ??= readToken();
  if (!url || !token) throw new Error(url ? `No token for ${agent} yet. Open Axonix once, which makes it.` : 'Axonix is not open.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(40_000),
  });
  if (res.status === 401) {
    token = null;
    throw new Error(`Axonix did not accept ${agent}'s token.`);
  }
  session = res.headers.get('mcp-session-id') ?? session;
  if (res.status === 202) return null;
  return JSON.parse(await res.text());
}

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const CLOSED = 'Axonix is not open on this computer, so nothing can be read or changed. Ask the owner to open Axonix, then try again.';

/** What is said when the door cannot be reached, so the client stays connected and the model is told why. */
function closedAnswer(message, why) {
  if (message.id === undefined) return null;
  const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
  if (message.method === 'initialize')
    return reply({ protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'axonix', title: 'Axonix', version: '0' }, instructions: CLOSED });
  if (message.method === 'ping') return reply({});
  if (message.method === 'tools/list') return reply({ tools: [] });
  if (message.method === 'tools/call') return reply({ content: [{ type: 'text', text: JSON.stringify({ error: `${CLOSED} (${why})` }) }], isError: true });
  return { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: CLOSED } };
}

let first = null;
async function handle(message) {
  if (message.method === 'initialize') first = message;
  try {
    // The door was closed when this client connected: connect now, before anything else.
    if (reached === false && first && message.method !== 'initialize') await forward(first);
    const answer = await forward(message);
    if (answer?.result?.capabilities?.tools) answer.result.capabilities.tools.listChanged = true;
    if (reached === false) write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    reached = true;
    if (answer) write(answer);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (reached !== false) say(why);
    reached = false;
    session = null;
    const answer = closedAnswer(message, why);
    if (answer) write(answer);
  }
}

// While the door is closed, look for it every few seconds and tell the client when it opens.
setInterval(() => {
  if (reached !== false || !first || !doorUrl()) return;
  forward(first)
    .then(() => {
      reached = true;
      write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    })
    .catch(() => undefined);
}, 5000).unref();

let queue = Promise.resolve();
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  // tools/call may run side by side; everything else keeps its order.
  if (message.method === 'tools/call') void handle(message);
  else queue = queue.then(() => handle(message));
});
lines.on('close', () => process.exit(0));
