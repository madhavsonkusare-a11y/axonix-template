// Checks the assistant's sign-in and request code (electron/chatgpt-core.ts) against a local
// stand-in for OpenAI (fake-openai.mjs). No account, no network beyond 127.0.0.1.
//
//   node scripts/assistant-check/run.mjs
//
// It proves the code does what OpenAI's guides describe. It cannot prove OpenAI's servers agree:
// that is what "Test the connection" in the assistant's settings is for, once the owner has signed in.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFake } from './fake-openai.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(mkdtempSync(path.join(tmpdir(), 'axonix-assistant-')), 'core.mjs');
await build({ entryPoints: [path.join(here, '../../electron/chatgpt-core.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning' });
const { createChatGPT, AssistantError } = await import(pathToFileURL(bundle).href);
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };
const throwsCode = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof AssistantError ? e : { code: 'not-an-AssistantError', message: String(e) }; } };

async function make(fake, extra = {}) {
  let state = { version: 1 };
  let secrets = null;
  const logs = [];
  const gpt = createChatGPT({
    issuer: fake.base,
    api: `${fake.base}/v1`,
    appName: 'Axonix',
    ports: [0],
    // "The browser": follow OpenAI's redirect back to the loopback listener.
    openBrowser: async (url) => { const r = await fetch(url, { redirect: 'manual' }); const to = r.headers.get('location'); if (to) await fetch(to); },
    readState: () => state,
    writeState: (s) => { state = s; },
    readSecrets: () => secrets,
    writeSecrets: (s) => { secrets = s; },
    log: (l) => logs.push(l),
    ...extra,
  });
  return { gpt, logs, state: () => state, secrets: () => secrets, setSecrets: (s) => { secrets = s; } };
}

const none = new AbortController().signal;

{
  const fake = await startFake();
  const t = await make(fake);
  check('starts not connected', !t.gpt.status().connected && !t.gpt.status().sharing);

  const s = await t.gpt.signIn();
  check('sign-in connects', s.connected && s.sharing && s.email === 'owner@example.com', JSON.stringify(s));
  check('issued client id saved, not the registration entry', t.state().clientId === 'oaiapp_fake1');
  check('host id made once', /^urn:uuid:/.test(t.state().hostId));
  check('tokens held as secrets only', t.secrets()?.accessToken?.startsWith('at_') && !JSON.stringify(t.state()).includes('at_') && !JSON.stringify(t.state()).includes('rt_'));
  check('nothing secret in the log', !t.logs.join('\n').match(/at_\d|rt_\d|code_\d/), t.logs.join(' | '));

  const models = await t.gpt.models();
  check('models: listed ones only, in order', models.map((m) => m.slug).join() === 'gpt-fake-large,gpt-fake-small', JSON.stringify(models));

  const deltas = [];
  const r = await t.gpt.respond({ instructions: 'x', input: [{ role: 'user', content: 'hello' }] }, (e) => e.type === 'text' && deltas.push(e.delta), none);
  check('text streams and completes', r.text === 'Axonix is connected.' && deltas.join('') === r.text && deltas.length > 1, `${deltas.length} deltas`);
  check('request body follows the route rules', fake.seen.responses.at(-1).store === false && fake.seen.responses.at(-1).stream === true && fake.seen.responses.at(-1).model === 'gpt-fake-large');

  t.gpt.setModel('gpt-fake-small');
  await t.gpt.respond({ instructions: 'x', input: [{ role: 'user', content: 'hello' }] }, () => {}, none);
  check('chosen model is used', fake.seen.responses.at(-1).model === 'gpt-fake-small');
  t.gpt.setModel('gone');
  await t.gpt.respond({ instructions: 'x', input: [{ role: 'user', content: 'hello' }] }, () => {}, none);
  check('a model the account no longer lists falls back to the first', fake.seen.responses.at(-1).model === 'gpt-fake-large');

  const test = await t.gpt.selfTest();
  check('self-test passes all three', test.length === 3 && test.every((x) => x.ok), JSON.stringify(test));
  const second = fake.seen.responses.at(-1);
  check('tool round trip sends history back with the sealed reasoning', second.input.some((i) => i.type === 'reasoning' && i.encrypted_content === 'sealed') && second.input.some((i) => i.type === 'function_call') && second.input.at(-1).type === 'function_call_output' && second.input.at(-1).output === '42');

  // The access token is near its end: a refresh happens, once, and rotates.
  const before = t.secrets();
  t.setSecrets({ ...before, expiresAt: Date.now() + 1000 });
  await Promise.all([t.gpt.models(), t.gpt.respond({ instructions: 'x', input: [{ role: 'user', content: 'hello' }] }, () => {}, none)]);
  const refreshes = fake.seen.token.filter((f) => f.grant_type === 'refresh_token');
  check('one refresh for two requests at once', refreshes.length === 1, `${refreshes.length} refreshes`);
  check('refresh rotated both tokens', t.secrets().accessToken !== before.accessToken && t.secrets().refreshToken !== before.refreshToken);

  // A 401 on a token that looked fine: refresh and try once more.
  fake.flags.expire401 = 1;
  const again = await t.gpt.models(true);
  check('a 401 is retried after a refresh', again.length === 2 && fake.seen.token.filter((f) => f.grant_type === 'refresh_token').length === 2);

  const lim = await throwsCode(() => t.gpt.respond({ instructions: 'x', input: [{ role: 'user', content: 'limit please' }] }, () => {}, none));
  check('usage limit mid-stream is named, with the way out', lim?.code === 'subscription_sharing_usage_limit_exceeded' && lim.recovery === 'usage', lim?.message);
  const drop = await throwsCode(() => t.gpt.respond({ instructions: 'x', input: [{ role: 'user', content: 'drop it' }] }, () => {}, none));
  check('a stream that ends early is not a success', drop?.code === 'stream_interrupted', drop?.code);

  // Signing in again reuses the registration.
  const s2 = await t.gpt.signIn();
  const reauth = fake.seen.authorize.at(-1);
  check('second sign-in reuses the issued client id', s2.connected && reauth.client_id === 'oaiapp_fake1' && !reauth.agent_name_hint && reauth.login_hint === 'owner@example.com');
  check('same host id on both sign-ins', fake.seen.authorize[0].ext_agent_host_id === reauth.ext_agent_host_id);

  // A refresh token that OpenAI no longer accepts.
  t.setSecrets({ ...t.secrets(), refreshToken: 'rt_stale', expiresAt: 0 });
  const dead = await throwsCode(() => t.gpt.models(true));
  check('a dead refresh token asks for sign-in and clears the tokens', dead?.recovery === 'sign-in' && t.secrets() === null && t.gpt.status().expired && !t.gpt.status().connected, dead?.message);
  check('the registration survives it', t.state().clientId === 'oaiapp_fake1');

  await t.gpt.signIn();
  const out = await t.gpt.signOut();
  check('sign-out ends the session at OpenAI and forgets the tokens', out.revoked && t.secrets() === null && !t.gpt.status().connected && fake.seen.revoked.at(-1).token_type_hint === 'refresh_token');
  check('sign-out keeps the registration and host id', t.state().clientId === 'oaiapp_fake1' && Boolean(t.state().hostId));

  check('the server saw nothing out of line', fake.seen.problems.length === 0, fake.seen.problems.join('; '));
  fake.close();
}

{
  // The ID token's nonce does not match: nothing is saved.
  const fake = await startFake();
  fake.flags.badNonce = true;
  const t = await make(fake);
  const e = await throwsCode(() => t.gpt.signIn());
  check('a wrong nonce is refused and saves no tokens', e?.code === 'invalid_id_token' && t.secrets() === null && !t.gpt.status().connected, e?.code);
  fake.close();
}

{
  // The route refuses `include`: go on without sealed reasoning, with ids stripped.
  const fake = await startFake({ rejectInclude: true });
  const t = await make(fake);
  await t.gpt.signIn();
  const test = await t.gpt.selfTest();
  check('self-test passes without sealed reasoning', test.every((x) => x.ok), JSON.stringify(test.map((x) => x.detail)));
  const lastBody = fake.seen.responses.at(-1);
  check('history is sent plain: no reasoning, no ids', !lastBody.include && !lastBody.input.some((i) => i.type === 'reasoning') && !lastBody.input.some((i) => i.type && 'id' in i));
  check('the fallback is logged once', t.logs.filter((l) => /without sealed reasoning/.test(l)).length === 1);
  fake.close();
}

{
  // Cancelled from Axonix while the browser is open.
  const fake = await startFake();
  const t = await make(fake, { openBrowser: () => {} });
  const p = t.gpt.signIn();
  check('status says a sign-in is under way', t.gpt.status().signingIn);
  setTimeout(() => t.gpt.cancelSignIn(), 150);
  const e = await throwsCode(() => p);
  check('cancel stops the sign-in', e?.code === 'cancelled' && !t.gpt.status().signingIn);
  fake.close();
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
