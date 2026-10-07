/**
 * Sign in with ChatGPT, and requests on the owner's ChatGPT plan.
 *
 * Written from OpenAI's public guides (developers.openai.com/siwc, read
 * 2026-10-02), for "personal projects that run locally":
 *
 *   1. This installation has one host id (`urn:uuid:…`), made once.
 *   2. Sign-in opens the system browser at OpenAI's authorize endpoint with
 *      PKCE, a fresh state and nonce, and a listener on 127.0.0.1. The first
 *      time, `client_id=dynamic_agent_client` registers this app and the
 *      callback returns the issued client id. No client secret, no API key.
 *   3. The code is exchanged for tokens; the ID token's signature, issuer,
 *      audience, expiry and nonce are checked; the granted scopes say whether
 *      plan usage was allowed (`chatgpt.tokens.use.direct`).
 *   4. Requests go to the public Responses API with the access token, always
 *      `store: false` and `stream: true`, and count as done only on
 *      `response.completed`.
 *
 * Nothing here imports Electron: the caller hands in how to open a browser,
 * where the plain state lives and where the tokens live (encrypted). That is
 * also what lets the whole flow be run against a local stand-in server.
 *
 * Tokens never leave this module except to OpenAI's two hosts. They are never
 * logged and never put in a URL.
 */
import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import http from 'node:http';

const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const SHARING = 'chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 180_000;
/** Refresh codes after which the saved refresh token is of no further use. */
const DEAD_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

/** What is kept in the open: nothing here signs anyone in. */
export interface AssistantState {
  version: 1;
  /** This installation, `urn:uuid:…`. Made before the first sign-in and kept for good. */
  hostId?: string;
  /** Issued by OpenAI when this app was registered for the account. Kept through sign-out. */
  clientId?: string;
  subject?: string;
  email?: string;
  name?: string;
  scopes?: string[];
  /** The model the owner chose, by slug. */
  model?: string;
  connectedAt?: string;
  /** The one-time "You're using your ChatGPT plan" note has been seen. */
  welcomed?: boolean;
}

export interface AssistantSecrets {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface AssistantStatus {
  /** Tokens are held for a verified account. */
  connected: boolean;
  /** The account allowed its ChatGPT plan to be used here. */
  sharing: boolean;
  /** A browser sign-in is under way. */
  signingIn: boolean;
  /** Was connected, and the sign-in ran out or was removed in ChatGPT's settings. */
  expired: boolean;
  email?: string;
  name?: string;
  model?: string;
  welcomed: boolean;
}

export type Recovery = 'usage' | 'sign-in' | 'retry' | 'none';

export class AssistantError extends Error {
  constructor(
    public code: string,
    message: string,
    public recovery: Recovery = 'none',
    public status?: number,
    public requestId?: string | null,
    public param?: string,
  ) {
    super(message);
  }
}

export interface ModelChoice {
  slug: string;
  name: string;
}

export interface RespondRequest {
  model?: string;
  instructions: string;
  /** The whole exchange so far: nothing is kept on OpenAI's side between requests. */
  input: unknown[];
  tools?: unknown[];
}

export type StreamEvent = { type: 'text'; delta: string } | { type: 'item'; item: Record<string, unknown> };

export interface RespondResult {
  /** The response's output items, in order: reasoning, function calls, the message. */
  output: Record<string, unknown>[];
  text: string;
  model: string;
}

export interface Deps {
  /** `https://auth.openai.com`. */
  issuer: string;
  /** `https://api.openai.com/v1`: the Responses API, and the OAuth resource. */
  api: string;
  /** The OAuth `resource`, when the API is reached at another address (a stand-in server). */
  resource?: string;
  /** Shown on OpenAI's consent page the first time. The same on every installation. */
  appName: string;
  openBrowser: (url: string) => void | Promise<void>;
  readState: () => AssistantState;
  writeState: (state: AssistantState) => void;
  readSecrets: () => AssistantSecrets | null;
  writeSecrets: (secrets: AssistantSecrets | null) => void;
  /** One line for the app log. Never given a token. */
  log: (line: string) => void;
  /** Loopback ports to try, in order. 0 asks the system for a free one. */
  ports?: number[];
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
}

/** One of OpenAI's published signing keys. */
type Jwk = Record<string, unknown> & { kty?: string; kid?: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const random = () => randomBytes(32).toString('base64url');

/** A sentence for each failure the guides name, and what to do about it. */
function explain(code: string, status: number | undefined, fallback: string): { message: string; recovery: Recovery } {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return { message: 'The usage limit was reached. It may be your ChatGPT plan’s, or the limit set for Axonix. Review it in ChatGPT’s settings.', recovery: 'usage' };
    case 'subscription_sharing_user_not_eligible':
      return { message: 'This ChatGPT account or workspace cannot use its plan in other apps. A Plus or Pro plan is needed.', recovery: 'none' };
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return { message: 'ChatGPT could not check your plan just now. Try again in a minute.', recovery: 'retry' };
    case 'subscription_sharing_invalid_user':
      return { message: 'ChatGPT did not accept this sign-in. Sign in again.', recovery: 'sign-in' };
    case 'subscription_sharing_unsupported_capability':
      return { message: `ChatGPT plan usage does not support something in this request. ${fallback}`, recovery: 'none' };
    case 'subscription_sharing_route_not_supported':
    case 'chatpass_v2_scope_not_authorized':
    case 'chatpass_v2_invalid_authorization_context':
      return { message: `This sign-in is not allowed to do that. ${fallback}`, recovery: 'none' };
    case 'access_denied':
      return { message: 'Access was not granted in ChatGPT.', recovery: 'none' };
    default:
      if (status === 401) return { message: 'ChatGPT did not accept this sign-in. Sign in again.', recovery: 'sign-in' };
      if (status === 429) return { message: `ChatGPT is limiting requests right now. ${fallback}`, recovery: 'usage' };
      if (status === 503) return { message: 'ChatGPT plan usage is unavailable right now. Try again in a minute.', recovery: 'retry' };
      return { message: fallback, recovery: status && status >= 500 ? 'retry' : 'none' };
  }
}

/** An error from whichever shape came back: the API's `{error}`, OAuth's `{error, error_description}`, or `{detail}`. */
function errorOf(body: unknown, status?: number, requestId?: string | null): AssistantError {
  let code = status ? `http_${status}` : 'failed';
  let text = status ? `ChatGPT answered ${status}.` : 'The request failed.';
  let param: string | undefined;
  if (isObject(body)) {
    const e = body.error;
    if (isObject(e)) {
      if (typeof e.code === 'string') code = e.code;
      else if (typeof e.type === 'string') code = e.type;
      if (typeof e.message === 'string') text = e.message;
      if (typeof e.param === 'string') param = e.param;
    } else if (typeof e === 'string') {
      code = e;
      text = typeof body.error_description === 'string' ? body.error_description : `ChatGPT said: ${e}.`;
    } else if (typeof body.detail === 'string') {
      text = body.detail;
    } else if (typeof body.message === 'string') {
      text = body.message;
      if (typeof body.code === 'string') code = body.code;
    }
  }
  const { message, recovery } = explain(code, status, text.slice(0, 400));
  return new AssistantError(code, message, recovery, status, requestId, param);
}

export function createChatGPT(deps: Deps) {
  const resource = deps.resource ?? deps.api;
  const issuerOrigin = new URL(deps.issuer).origin;

  /* ---------- OpenAI's own description of its endpoints ---------- */

  let discovered: Promise<Discovery> | null = null;
  function discovery(): Promise<Discovery> {
    discovered ??= (async () => {
      const res = await fetch(`${deps.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(20_000) });
      const data = (await res.json().catch(() => null)) as unknown;
      if (!res.ok || !isObject(data) || data.issuer !== deps.issuer) throw new AssistantError('discovery_failed', 'ChatGPT’s sign-in service could not be reached. Check the connection and try again.', 'retry');
      for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint']) {
        const value = data[key];
        if (key === 'revocation_endpoint' && value === undefined) continue;
        // Every endpoint must be OpenAI's own: a sign-in is never sent anywhere else.
        if (typeof value !== 'string' || new URL(value).origin !== issuerOrigin) throw new AssistantError('discovery_failed', 'ChatGPT’s sign-in service described itself in a way Axonix does not trust. Nothing was sent.');
      }
      return data as unknown as Discovery;
    })().catch((e: unknown) => {
      discovered = null;
      throw e instanceof AssistantError ? e : new AssistantError('discovery_failed', 'ChatGPT’s sign-in service could not be reached. Check the connection and try again.', 'retry');
    });
    return discovered;
  }

  async function tokenRequest(form: Record<string, string>): Promise<Record<string, unknown>> {
    const d = await discovery();
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw errorOf(body, res.status, res.headers.get('x-request-id'));
    if (!isObject(body)) throw new AssistantError('invalid_token_response', 'ChatGPT returned a sign-in Axonix could not read. Try again.', 'retry');
    return body;
  }

  /* ---------- the ID token: who signed in ---------- */

  let keys: { at: number; list: Jwk[] } | null = null;
  async function signingKeys(fresh = false): Promise<Jwk[]> {
    if (keys && !fresh && Date.now() - keys.at < 10 * 60_000) return keys.list;
    const d = await discovery();
    const res = await fetch(d.jwks_uri, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || !isObject(body) || !Array.isArray(body.keys)) throw new AssistantError('identity_unavailable', 'ChatGPT’s identity check is unavailable right now. Try again shortly.', 'retry');
    keys = { at: Date.now(), list: body.keys.filter(isObject) as Jwk[] };
    return keys.list;
  }

  async function verifyIdToken(idToken: string, clientId: string, nonce: string): Promise<{ subject: string; email?: string; name?: string }> {
    const bad = () => new AssistantError('invalid_id_token', 'The ChatGPT identity could not be verified, so nothing was saved. Sign in again.');
    const parts = idToken.split('.');
    if (parts.length !== 3) throw bad();
    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      throw bad();
    }
    if (header.alg !== 'RS256') throw bad();
    const find = (list: Jwk[]) => list.find((k) => k.kty === 'RSA' && (header.kid === undefined || k.kid === header.kid));
    // A key id that is not in the cached set may simply be new.
    const jwk = find(await signingKeys()) ?? find(await signingKeys(true));
    if (!jwk) throw bad();
    let signed = false;
    try {
      signed = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk as never, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    } catch {
      signed = false;
    }
    const aud = claims.aud;
    const forUs = aud === clientId || (Array.isArray(aud) && aud.includes(clientId) && (aud.length === 1 || claims.azp === clientId));
    const now = Date.now() / 1000;
    if (
      !signed ||
      claims.iss !== deps.issuer ||
      !forUs ||
      typeof claims.exp !== 'number' ||
      claims.exp < now - 5 ||
      claims.nonce !== nonce ||
      typeof claims.sub !== 'string' ||
      !claims.sub
    )
      throw bad();
    return { subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined, name: typeof claims.name === 'string' ? claims.name : undefined };
  }

  /* ---------- tokens ---------- */

  function tokensFrom(data: Record<string, unknown>, previous?: AssistantSecrets | null): { secrets: AssistantSecrets; scopes: string[] | null } {
    if (typeof data.access_token !== 'string' || !data.access_token || typeof data.expires_in !== 'number' || !(data.expires_in > 0))
      throw new AssistantError('invalid_token_response', 'ChatGPT returned an incomplete sign-in. Sign in again.', 'sign-in');
    if (typeof data.token_type === 'string' && data.token_type.toLowerCase() !== 'bearer') throw new AssistantError('invalid_token_response', 'ChatGPT returned a kind of sign-in Axonix does not use. Sign in again.', 'sign-in');
    return {
      secrets: {
        accessToken: data.access_token,
        // A refresh answers with a replacement refresh token; the old one is spent.
        refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : previous?.refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
      },
      scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : null,
    };
  }

  // One refresh at a time: the refresh token rotates, and two at once would spend it twice.
  let refreshing: Promise<string> | null = null;
  let expired = false;

  async function refresh(): Promise<string> {
    const state = deps.readState();
    const secrets = deps.readSecrets();
    if (!state.clientId || !secrets?.refreshToken) {
      expired = Boolean(state.clientId && state.subject);
      throw new AssistantError('not_connected', 'Axonix is not connected to ChatGPT.', 'sign-in');
    }
    try {
      const data = await tokenRequest({ grant_type: 'refresh_token', client_id: state.clientId, refresh_token: secrets.refreshToken, resource });
      const next = tokensFrom(data, secrets);
      deps.writeSecrets(next.secrets);
      if (next.scopes) deps.writeState({ ...deps.readState(), scopes: next.scopes });
      expired = false;
      return next.secrets.accessToken;
    } catch (e) {
      if (e instanceof AssistantError && DEAD_REFRESH.has(e.code)) {
        // Spent, expired or removed in ChatGPT's settings. The registration is kept for the next sign-in.
        deps.writeSecrets(null);
        expired = true;
        deps.log(`assistant: the saved sign-in is no longer accepted (${e.code})`);
        throw new AssistantError(e.code, 'ChatGPT no longer accepts this sign-in. It expired, or Axonix was disconnected in ChatGPT’s settings. Sign in again.', 'sign-in');
      }
      // A network or server failure says nothing about the token: keep it.
      throw e;
    }
  }

  async function accessToken(force = false): Promise<string> {
    const secrets = deps.readSecrets();
    if (!force && secrets && secrets.expiresAt > Date.now() + 90_000) return secrets.accessToken;
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /* ---------- sign-in ---------- */

  let signing: { promise: Promise<AssistantStatus>; cancel: () => void } | null = null;

  function hostId(): string {
    const state = deps.readState();
    if (state.hostId) return state.hostId;
    const id = `urn:uuid:${randomUUID()}`;
    deps.writeState({ ...state, version: 1, hostId: id });
    return id;
  }

  const page = (title: string, text: string) =>
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Axonix</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#070708;color:#f2f2f0;font:15px 'Segoe UI Variable',system-ui,sans-serif"><div style="text-align:center;max-width:420px;padding:24px"><h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${title}</h1><p style="margin:0;color:rgba(242,242,240,.6);line-height:1.5">${text}</p></div></body></html>`;

  async function listen(ports: number[]): Promise<{ server: http.Server; port: number }> {
    for (const port of ports) {
      const server = http.createServer();
      const ok = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => resolve(true));
      });
      if (ok) return { server, port: (server.address() as { port: number }).port };
    }
    throw new AssistantError('callback_port_unavailable', 'Axonix could not open a local address for ChatGPT to answer on. Close other sign-in windows and try again.', 'retry');
  }

  async function runSignIn(abort: AbortSignal): Promise<void> {
    const before = deps.readState();
    const host = hostId();
    const d = await discovery();
    const state = random();
    const nonce = random();
    const verifier = random();
    const { server, port } = await listen(deps.ports ?? [1455, 0]);
    server.requestTimeout = 15_000;
    const redirect = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    // A registration from an earlier sign-in is reused: signing in again never makes a second app.
    const saved = before.clientId;

    try {
      const callback = await new Promise<{ code: string; clientId: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new AssistantError('timeout', 'Sign-in took longer than five minutes, so it was stopped. Try again.', 'retry')), SIGN_IN_TIMEOUT_MS);
        const stop = () => reject(new AssistantError('cancelled', 'Sign-in was cancelled.'));
        abort.addEventListener('abort', stop, { once: true });
        const settle = (fn: () => void) => {
          clearTimeout(timer);
          abort.removeEventListener('abort', stop);
          fn();
        };

        server.on('request', (req, res) => {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Referrer-Policy', 'no-referrer');
          let url: URL;
          try {
            url = new URL(req.url ?? '/', redirect);
          } catch {
            res.writeHead(400).end();
            return;
          }
          if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH || req.headers.host !== `127.0.0.1:${port}`) {
            res.writeHead(404).end();
            return;
          }
          const got = Buffer.from(url.searchParams.get('state') ?? '');
          const want = Buffer.from(state);
          if (got.length !== want.length || !timingSafeEqual(got, want)) {
            // Something else on this machine knocked. It does not end the sign-in under way.
            res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(page('That link is not for this sign-in', 'Start again from Axonix.'));
            return;
          }
          const error = url.searchParams.get('error');
          const code = url.searchParams.get('code');
          const returned = url.searchParams.get('client_id');
          const clientId = returned ?? saved;
          const registered = Boolean(clientId && /^[A-Za-z0-9_-]{1,200}$/.test(clientId) && clientId !== 'dynamic_agent_client' && (!saved || !returned || saved === returned));
          const good = !error && Boolean(code) && registered;
          res
            .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            .end(good ? page('Axonix is connected to ChatGPT', 'You can close this tab and go back to Axonix.') : page('ChatGPT was not connected', 'You can close this tab and try again from Axonix.'));
          if (error) settle(() => reject(errorOf({ error })));
          else if (!code || !registered || !clientId) settle(() => reject(new AssistantError('registration_incomplete', 'ChatGPT did not finish registering Axonix. Try signing in again.', 'retry')));
          else settle(() => resolve({ code, clientId }));
        });

        const url = new URL(d.authorization_endpoint);
        url.search = new URLSearchParams({
          client_id: saved ?? 'dynamic_agent_client',
          response_type: 'code',
          redirect_uri: redirect,
          scope: SCOPES,
          resource,
          state,
          nonce,
          code_challenge_method: 'S256',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          ext_agent_host_id: host,
        }).toString();
        // The name is offered only when registering; the owner can change it on OpenAI's page.
        if (!saved) url.searchParams.set('agent_name_hint', deps.appName);
        else if (before.email) url.searchParams.set('login_hint', before.email);
        Promise.resolve(deps.openBrowser(url.toString())).catch(() => settle(() => reject(new AssistantError('browser_unavailable', 'The browser could not be opened. Check your default browser and try again.', 'retry'))));
      });

      // Kept before the code is exchanged: if the exchange fails, the next attempt reuses this registration.
      deps.writeState({ ...deps.readState(), version: 1, hostId: host, clientId: callback.clientId });

      const data = await tokenRequest({ grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code, code_verifier: verifier, redirect_uri: redirect, resource });
      if (typeof data.id_token !== 'string') throw new AssistantError('invalid_id_token', 'ChatGPT did not say who signed in, so nothing was saved. Try again.', 'retry');
      const who = await verifyIdToken(data.id_token, callback.clientId, nonce);
      if (saved && before.subject && who.subject !== before.subject)
        throw new AssistantError('account_mismatch', 'That was a different ChatGPT account from the one Axonix is registered with. Sign in with the first account, or sign out of Axonix’s ChatGPT connection first.');

      const { secrets, scopes } = tokensFrom(data);
      deps.writeSecrets(secrets);
      const now = deps.readState();
      deps.writeState({ ...now, version: 1, hostId: host, clientId: callback.clientId, subject: who.subject, email: who.email, name: who.name, scopes: scopes ?? [], connectedAt: new Date().toISOString() });
      expired = false;
      deps.log(`assistant: signed in; plan usage ${scopes?.includes(SHARING) ? 'allowed' : 'not allowed'}`);
    } finally {
      server.close();
      server.closeAllConnections();
    }
  }

  function signIn(): Promise<AssistantStatus> {
    if (signing) return signing.promise;
    const control = new AbortController();
    const promise = runSignIn(control.signal)
      .finally(() => {
        signing = null;
      })
      .then(() => status());
    signing = { promise, cancel: () => control.abort() };
    return promise;
  }

  /** Ends the session at OpenAI where it can, then forgets the tokens here. The registration is kept. */
  async function signOut(): Promise<{ revoked: boolean }> {
    signing?.cancel();
    const state = deps.readState();
    const secrets = deps.readSecrets();
    let revoked = false;
    if (state.clientId && secrets?.refreshToken) {
      try {
        const d = await discovery();
        if (d.revocation_endpoint) {
          const res = await fetch(d.revocation_endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: secrets.refreshToken, token_type_hint: 'refresh_token', client_id: state.clientId }).toString(),
            signal: AbortSignal.timeout(20_000),
          });
          revoked = res.status === 200;
        }
      } catch {
        revoked = false;
      }
    }
    deps.writeSecrets(null);
    // Who it was and which registration it is stay, so the next sign-in is the short one.
    deps.writeState({ ...state, scopes: [], connectedAt: undefined });
    expired = false;
    deps.log(`assistant: signed out; session ${revoked ? 'ended at OpenAI' : 'not confirmed ended at OpenAI'}`);
    return { revoked };
  }

  function status(): AssistantStatus {
    const state = deps.readState();
    const connected = Boolean(state.clientId && state.subject && deps.readSecrets());
    return {
      connected,
      sharing: connected && Boolean(state.scopes?.includes(SHARING)),
      signingIn: signing !== null,
      expired: !connected && expired,
      email: state.email,
      name: state.name,
      model: state.model,
      welcomed: Boolean(state.welcomed),
    };
  }

  /* ---------- requests ---------- */

  async function authorized(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken(attempt > 0);
      const res = await fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Once: the token may have been ended early. A second 401 is the account's answer.
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      return res;
    }
  }

  async function models(): Promise<ModelChoice[]> {
    const res = await authorized(`${deps.api}/models`, { headers: { accept: 'application/json' } });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw errorOf(body, res.status, res.headers.get('x-request-id'));
    // The plan's catalogue is `models`, in the order to show them; the API-key catalogue is `data`.
    const list = isObject(body) && Array.isArray(body.models) ? body.models : null;
    if (!list) throw new AssistantError('invalid_model_catalog', 'ChatGPT returned a list of models Axonix could not read. Try again.', 'retry', res.status);
    const out: ModelChoice[] = [];
    for (const m of list) {
      if (!isObject(m) || m.visibility !== 'list' || typeof m.slug !== 'string' || !m.slug) continue;
      out.push({ slug: m.slug, name: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.slug });
    }
    return out;
  }

  let modelCache: { at: number; list: ModelChoice[] } | null = null;
  async function modelList(fresh = false): Promise<ModelChoice[]> {
    if (!fresh && modelCache && Date.now() - modelCache.at < 30 * 60_000) return modelCache.list;
    modelCache = { at: Date.now(), list: await models() };
    return modelCache.list;
  }

  /** The owner's choice while the account still offers it, else the first the account lists. */
  async function chosenModel(wanted?: string): Promise<string> {
    const list = await modelList();
    const pick = wanted ?? deps.readState().model;
    const model = list.find((m) => m.slug === pick) ?? list[0];
    if (!model) throw new AssistantError('no_models', 'This ChatGPT account lists no models for use in other apps.');
    return model.slug;
  }

  // Thinking is carried between requests as sealed items, because nothing is stored on OpenAI's side.
  // Switched off for the session if the route says it will not take the field.
  let sealedReasoning = true;

  /** History without anything that only means something on OpenAI's side. */
  const plain = (input: unknown[]) =>
    input
      .filter((item) => !(isObject(item) && item.type === 'reasoning'))
      .map((item) => {
        if (!isObject(item) || item.type === undefined) return item;
        const { id: _id, status: _status, ...rest } = item;
        return rest;
      });

  async function respond(req: RespondRequest, onEvent: (event: StreamEvent) => void, signal: AbortSignal): Promise<RespondResult> {
    const state = deps.readState();
    if (!state.scopes?.includes(SHARING)) throw new AssistantError('sharing_disabled', 'ChatGPT plan usage is not enabled for Axonix. Sign in again and allow it.', 'sign-in');
    const model = await chosenModel(req.model);

    for (let attempt = 0; ; attempt++) {
      const body: Record<string, unknown> = {
        model,
        instructions: req.instructions,
        input: sealedReasoning ? req.input : plain(req.input),
        store: false,
        stream: true,
      };
      if (req.tools?.length) body.tools = req.tools;
      if (sealedReasoning) body.include = ['reasoning.encrypted_content'];

      const res = await authorized(`${deps.api}/responses`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body) }, signal);
      const requestId = res.headers.get('x-request-id');
      if (!res.ok) {
        const err = errorOf(await res.json().catch(() => null), res.status, requestId);
        // If the sealed thinking is what was refused, say it once in the log and go on without it.
        const aboutHistory = err.status === 400 && sealedReasoning && (err.param?.startsWith('include') || /include|reasoning|encrypted|not found|persist/i.test(err.message));
        if (aboutHistory && attempt === 0) {
          sealedReasoning = false;
          deps.log(`assistant: request refused (${err.code}${err.param ? `, ${err.param}` : ''}); retrying without sealed reasoning`);
          continue;
        }
        deps.log(`assistant: request failed ${res.status} ${err.code}${err.param ? ` param=${err.param}` : ''}${requestId ? ` request=${requestId}` : ''}`);
        if (err.recovery === 'sign-in' && res.status === 401) expired = true;
        throw err;
      }
      if (!res.body) throw new AssistantError('invalid_stream', 'ChatGPT did not return a response stream. Try again.', 'retry', res.status, requestId);
      return await readStream(res.body, model, onEvent, signal, requestId);
    }
  }

  async function readStream(stream: ReadableStream<Uint8Array>, model: string, onEvent: (event: StreamEvent) => void, signal: AbortSignal, requestId: string | null): Promise<RespondResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const output: Record<string, unknown>[] = [];
    let text = '';
    let completed = false;
    let pending = '';
    let data: string[] = [];

    const dispatch = () => {
      const raw = data.join('\n');
      data = [];
      if (!raw || raw === '[DONE]') return;
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        throw new AssistantError('invalid_stream', 'The answer arrived damaged. Try again.', 'retry', undefined, requestId);
      }
      if (!isObject(event)) return;
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta;
        onEvent({ type: 'text', delta: event.delta });
      } else if (event.type === 'response.output_item.done' && isObject(event.item)) {
        output.push(event.item);
        onEvent({ type: 'item', item: event.item });
      } else if (event.type === 'response.completed') {
        completed = true;
        // The finished response lists its output again; it is the authority where the two differ.
        const final = isObject(event.response) && Array.isArray(event.response.output) ? (event.response.output.filter(isObject) as Record<string, unknown>[]) : [];
        if (final.length >= output.length && final.length > 0) output.splice(0, output.length, ...final);
      } else if (event.type === 'response.failed' || event.type === 'error') {
        const failed = isObject(event.response) ? event.response : event;
        throw errorOf(failed, undefined, requestId);
      } else if (event.type === 'response.incomplete') {
        throw new AssistantError('response_incomplete', 'ChatGPT stopped before finishing the answer. Try again.', 'retry', undefined, requestId);
      }
    };
    const line = (value: string) => {
      if (value === '') dispatch();
      else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    };

    try {
      for (;;) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        let start = 0;
        for (let i = 0; i < pending.length; i++) {
          const c = pending[i];
          if (c !== '\n' && c !== '\r') continue;
          // A line ending split across two chunks is finished by the next one.
          if (c === '\r' && i === pending.length - 1 && !chunk.done) break;
          line(pending.slice(start, i));
          if (c === '\r' && pending[i + 1] === '\n') i++;
          start = i + 1;
        }
        pending = pending.slice(start);
        if (chunk.done) {
          if (pending) line(pending);
          dispatch();
          break;
        }
        if (completed) break;
      }
      if (!completed) throw new AssistantError('stream_interrupted', 'The connection dropped before the answer finished. Try again.', 'retry', undefined, requestId);
      return { output, text, model };
    } catch (e) {
      if (signal.aborted) throw new AssistantError('cancelled', 'Stopped.');
      if (e instanceof AssistantError) {
        deps.log(`assistant: stream failed ${e.code}${requestId ? ` request=${requestId}` : ''}`);
        throw e;
      }
      throw new AssistantError('stream_interrupted', 'The connection dropped before the answer finished. Try again.', 'retry', undefined, requestId);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  /* ---------- a check the owner can run ---------- */

  /**
   * Three small requests that prove the connection end to end: the account
   * lists models, a sentence streams to completion, and a tool call makes the
   * round trip (called, answered, used). Each step says what happened.
   */
  async function selfTest(): Promise<{ name: string; ok: boolean; detail: string }[]> {
    const steps: { name: string; ok: boolean; detail: string }[] = [];
    const step = async (name: string, run: () => Promise<string>) => {
      try {
        steps.push({ name, ok: true, detail: await run() });
        return true;
      } catch (e) {
        const err = e instanceof AssistantError ? e : new AssistantError('failed', e instanceof Error ? e.message : String(e));
        steps.push({ name, ok: false, detail: `${err.message} (${err.code}${err.param ? `, ${err.param}` : ''})` });
        return false;
      }
    };
    const none = new AbortController().signal;
    const quiet = () => undefined;

    const listed = await step('Models', async () => {
      const list = await modelList(true);
      if (!list.length) throw new AssistantError('no_models', 'The account lists no models.');
      return `${list.length} available: ${list
        .slice(0, 4)
        .map((m) => m.name)
        .join(', ')}${list.length > 4 ? '…' : ''}`;
    });
    if (listed) {
      await step('A streamed answer', async () => {
        const r = await respond({ instructions: 'Follow the instruction exactly.', input: [{ role: 'user', content: 'Reply with exactly: Axonix is connected.' }] }, quiet, none);
        if (!r.text.trim()) throw new AssistantError('empty', 'The answer was empty.');
        return `“${r.text.trim().slice(0, 80)}” from ${r.model}`;
      });
      await step('A tool call, there and back', async () => {
        const tools = [
          {
            type: 'namespace',
            name: 'axonix_check',
            description: 'A check that tools work.',
            tools: [
              {
                type: 'function',
                name: 'add_numbers',
                description: 'Adds two numbers and returns the sum.',
                parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'], additionalProperties: false },
              },
            ],
          },
        ];
        const instructions = 'Use the add_numbers tool for any sum. Then state the result in one short sentence.';
        const input: unknown[] = [{ role: 'user', content: 'What is 19 plus 23? Use the tool.' }];
        const first = await respond({ instructions, input, tools }, quiet, none);
        const call = first.output.find((item) => item.type === 'function_call');
        if (!call || typeof call.call_id !== 'string') throw new AssistantError('no_tool_call', 'The model answered without calling the tool.');
        let sum = 42;
        try {
          const args = JSON.parse(String(call.arguments ?? '{}')) as { a?: number; b?: number };
          sum = Number(args.a) + Number(args.b);
        } catch {
          /* the arguments were not JSON; the round trip is still what is being checked */
        }
        const second = await respond({ instructions, input: [...input, ...first.output, { type: 'function_call_output', call_id: call.call_id, output: String(sum) }], tools }, quiet, none);
        if (!second.text.trim()) throw new AssistantError('empty', 'The tool was called, but no answer followed its result.');
        return `Called ${String(call.name)}, got ${sum}, answered “${second.text.trim().slice(0, 60)}”${sealedReasoning ? '' : ' (without sealed reasoning)'}`;
      });
    }
    deps.log(`assistant: self-test ${steps.map((s) => `${s.name}=${s.ok ? 'ok' : 'FAILED'}`).join(' ')}`);
    for (const s of steps) if (!s.ok) deps.log(`assistant: self-test ${s.name}: ${s.detail}`);
    return steps;
  }

  return {
    status,
    signIn,
    cancelSignIn: () => signing?.cancel(),
    signOut,
    models: modelList,
    setModel: (slug: string) => deps.writeState({ ...deps.readState(), model: slug }),
    setWelcomed: () => deps.writeState({ ...deps.readState(), welcomed: true }),
    respond,
    selfTest,
  };
}

export type ChatGPT = ReturnType<typeof createChatGPT>;
