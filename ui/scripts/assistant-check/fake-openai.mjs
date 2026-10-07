// A local stand-in for OpenAI's sign-in and Responses API, shaped from the public guides
// (developers.openai.com/siwc). It checks what the client sends as strictly as the guides describe.
import http from 'node:http';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';

export async function startFake({ rejectInclude = false } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const seen = { authorize: [], token: [], responses: [], revoked: [], problems: [] };
  const codes = new Map();
  let access = null;
  let refresh = null;
  let n = 0;
  let base = '';
  const flags = { rejectInclude, badNonce: false, expire401: 0 };

  const idToken = (clientId, nonce) => {
    const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const now = Math.floor(Date.now() / 1000);
    const body = b64({ iss: base, aud: clientId, sub: 'user-123', email: 'owner@example.com', name: 'Owner', nonce: flags.badNonce ? 'wrong' : nonce, iat: now, exp: now + 600 });
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': `req_${++n}` }).end(JSON.stringify(body));
  const read = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    if (url.pathname === '/.well-known/openid-configuration') return json(res, 200, { issuer: base, authorization_endpoint: `${base}/api/accounts/authorize`, token_endpoint: `${base}/api/accounts/oauth/token`, jwks_uri: `${base}/jwks`, revocation_endpoint: `${base}/revoke` });
    if (url.pathname === '/jwks') return json(res, 200, { keys: [jwk] });

    if (url.pathname === '/api/accounts/authorize') {
      const q = Object.fromEntries(url.searchParams);
      seen.authorize.push(q);
      const first = q.client_id === 'dynamic_agent_client';
      const need = ['response_type', 'redirect_uri', 'scope', 'resource', 'state', 'nonce', 'code_challenge', 'ext_agent_host_id'];
      for (const k of need) if (!q[k]) seen.problems.push(`authorize: missing ${k}`);
      if (q.response_type !== 'code') seen.problems.push('authorize: response_type');
      if (q.code_challenge_method !== 'S256') seen.problems.push('authorize: code_challenge_method');
      if (!/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/.test(q.redirect_uri ?? '')) seen.problems.push(`authorize: redirect_uri ${q.redirect_uri}`);
      if (!/^urn:uuid:[0-9a-f-]{36}$/.test(q.ext_agent_host_id ?? '')) seen.problems.push('authorize: host id');
      for (const s of ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct']) if (!(q.scope ?? '').split(' ').includes(s)) seen.problems.push(`authorize: scope ${s}`);
      if (first && !q.agent_name_hint) seen.problems.push('authorize: agent_name_hint missing on registration');
      if (!first && q.agent_name_hint) seen.problems.push('authorize: agent_name_hint sent on reauthorization');
      if (q.id_token_hint || /at_|rt_/.test(req.url)) seen.problems.push('authorize: a token was put in the URL');
      const code = `code_${++n}`;
      const clientId = first ? 'oaiapp_fake1' : q.client_id;
      codes.set(code, { challenge: q.code_challenge, redirect: q.redirect_uri, clientId, nonce: q.nonce });
      const back = new URL(q.redirect_uri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.state);
      back.searchParams.set('scope', q.scope);
      if (first) back.searchParams.set('client_id', clientId);
      return res.writeHead(302, { location: back.toString() }).end();
    }

    if (url.pathname === '/api/accounts/oauth/token' && req.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(await read(req)));
      seen.token.push({ ...form, code_verifier: form.code_verifier ? '(present)' : undefined });
      if (form.client_secret) seen.problems.push('token: a client secret was sent');
      if (form.resource !== `${base}/v1`) seen.problems.push(`token: resource ${form.resource}`);
      if (form.grant_type === 'authorization_code') {
        const c = codes.get(form.code);
        codes.delete(form.code);
        if (!c) return json(res, 400, { error: 'invalid_grant', error_description: 'unknown code' });
        if (createHash('sha256').update(form.code_verifier ?? '').digest('base64url') !== c.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        if (form.redirect_uri !== c.redirect) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect mismatch' });
        if (form.client_id !== c.clientId) return json(res, 400, { error: 'invalid_client' });
        access = `at_${++n}`;
        refresh = `rt_${n}`;
        return json(res, 200, { access_token: access, refresh_token: refresh, id_token: idToken(c.clientId, c.nonce), token_type: 'Bearer', expires_in: 3600, scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke' });
      }
      if (form.grant_type === 'refresh_token') {
        if (form.client_id === 'dynamic_agent_client') seen.problems.push('refresh: used dynamic_agent_client');
        if (form.scope) seen.problems.push('refresh: sent scope');
        if (form.refresh_token !== refresh) return json(res, 400, { error: 'invalid_grant', error_description: 'refresh token is not current' });
        access = `at_${++n}`;
        refresh = `rt_${n}`;
        return json(res, 200, { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke' });
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }

    if (url.pathname === '/revoke' && req.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(await read(req)));
      seen.revoked.push(form);
      if (form.token === refresh) { refresh = null; access = null; }
      return res.writeHead(200).end();
    }

    const authed = () => req.headers.authorization === `Bearer ${access}` && access;
    if (url.pathname === '/v1/models') {
      if (flags.expire401 > 0) { flags.expire401--; return json(res, 401, { error: { code: 'invalid_token', message: 'expired' } }); }
      if (!authed()) return json(res, 401, { detail: 'not signed in' });
      return json(res, 200, { models: [{ slug: 'gpt-fake-large', display_name: 'Fake Large', visibility: 'list' }, { slug: 'gpt-fake-hidden', display_name: 'Hidden', visibility: 'hide' }, { slug: 'gpt-fake-small', display_name: 'Fake Small', visibility: 'list' }] });
    }

    if (url.pathname === '/v1/responses' && req.method === 'POST') {
      if (!authed()) return json(res, 401, { detail: 'not signed in' });
      const body = JSON.parse(await read(req));
      seen.responses.push(body);
      if (body.store !== false) seen.problems.push('responses: store must be false');
      if (body.stream !== true) seen.problems.push('responses: stream must be true');
      if (!Array.isArray(body.input)) seen.problems.push('responses: input must be an array');
      for (const k of ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'prompt', 'temperature', 'top_p', 'truncation', 'user', 'previous_response_id']) if (k in body) seen.problems.push(`responses: unsupported field ${k}`);
      if ((body.input ?? []).some((i) => i.role === 'system')) seen.problems.push('responses: system role message');
      for (const t of body.tools ?? []) if (t.type !== 'namespace') seen.problems.push(`responses: top-level tool of type ${t.type}`);
      if (flags.rejectInclude && body.include) return json(res, 400, { error: { code: 'subscription_sharing_unsupported_capability', param: 'include', message: 'include is not supported on this route' } });

      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': `req_${++n}` });
      // Events are cut mid-line and end with CRLF, to exercise the client's reader.
      const out = [];
      const ev = (o) => out.push(`event: ${o.type}\r\ndata: ${JSON.stringify(o)}\r\n\r\n`);
      const flush = async () => {
        const all = out.join('');
        for (let i = 0; i < all.length; i += 37) { res.write(all.slice(i, i + 37)); await new Promise((r) => setTimeout(r, 1)); }
        res.end();
      };
      const last = body.input[body.input.length - 1];
      const said = String(body.input.filter((i) => i.role === 'user').pop()?.content ?? '');
      ev({ type: 'response.created', response: { id: 'resp_1' } });
      if (last?.type === 'function_call_output') {
        const text = `The sum is ${last.output}.`;
        for (const w of text.split(/(?<= )/)) ev({ type: 'response.output_text.delta', delta: w });
        const item = { type: 'message', id: 'msg_2', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
        ev({ type: 'response.output_item.done', item });
        ev({ type: 'response.completed', response: { id: 'resp_2', output: [item] } });
      } else if (/limit/.test(said)) {
        ev({ type: 'response.output_text.delta', delta: 'Partial' });
        ev({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } });
      } else if (/drop/.test(said)) {
        ev({ type: 'response.output_text.delta', delta: 'Partial' });
      } else if (body.tools?.length && /tool/i.test(said)) {
        const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: body.include ? 'sealed' : undefined };
        const call = { type: 'function_call', id: 'fc_1', status: 'completed', call_id: 'call_1', namespace: body.tools[0].name, name: body.tools[0].tools[0].name, arguments: '{"a":19,"b":23}' };
        ev({ type: 'response.output_item.done', item: reasoning });
        ev({ type: 'response.output_item.done', item: call });
        ev({ type: 'response.completed', response: { id: 'resp_1', output: [reasoning, call] } });
      } else {
        const text = 'Axonix is connected.';
        for (const w of text.split(/(?<= )/)) ev({ type: 'response.output_text.delta', delta: w });
        const item = { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
        ev({ type: 'response.output_item.done', item });
        ev({ type: 'response.completed', response: { id: 'resp_1', output: [item] } });
      }
      return flush();
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, flags, close: () => server.close(), currentAccess: () => access };
}
