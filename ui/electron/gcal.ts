/**
 * Google Calendar (main process): sign-in, reading events, and the two-way
 * time blocks on the "Axonix" calendar.
 *
 * Sign-in uses the owner's own OAuth client ("Desktop app" in Google Cloud):
 * the system browser opens Google's consent page, Google redirects to a
 * loopback address on this machine (127.0.0.1, a random port, PKCE), and the
 * refresh token goes into Windows Credential Manager — never a file, never the
 * page. The client ID and secret are kept there too.
 *
 * Scopes: read the calendar list and every calendar's events; create one
 * secondary calendar, "Axonix", and change events only on calendars this app
 * created (`calendar.app.created`). No other event can be written.
 *
 * Time blocks: a task with a time block is an event on the Axonix calendar,
 * tagged with the task's id (a private extended property). `syncBlocks`
 * reconciles both sides against the last state both agreed on (kept in
 * `%LOCALAPPDATA%\Axonix\calendar.json`): a change made in Axonix updates the
 * event; an event moved or resized in Google moves the block; an event deleted
 * in Google clears the block. If both changed, the task wins.
 */
import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Entry } from '@napi-rs/keyring';

interface Options {
  dataDir: string;
  dev: boolean;
  isHost: (sender: WebContents) => boolean;
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
];
const CALENDAR_NAME = 'Axonix';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

interface Block {
  taskId: string;
  title: string;
  /** Local `YYYY-MM-DDTHH:mm`. */
  start: string;
  end: string;
  done: boolean;
  path: string;
}

interface Synced {
  eventId: string;
  start: string;
  end: string;
  title: string;
  done: boolean;
}

interface State {
  account?: string;
  axonixCalendarId?: string;
  shown?: string[];
  blocks?: Record<string, Synced>;
  lastSync?: number;
  lastError?: string;
}

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  /** `YYYY-MM-DD` for all-day events, else local `YYYY-MM-DDTHH:mm`. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  htmlLink?: string;
  color: string;
  taskId?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const localStamp = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function fromGoogle(t?: { date?: string; dateTime?: string }): { stamp: string; allDay: boolean } | null {
  if (!t) return null;
  if (t.date) return { stamp: t.date, allDay: true };
  if (t.dateTime) return { stamp: localStamp(new Date(t.dateTime)), allDay: false };
  return null;
}

export function registerCalendar({ dataDir, dev, isHost }: Options) {
  // A dev run can point every Google endpoint at a local fake, for testing the whole flow.
  const mock = dev ? process.env.AXONIX_GOOGLE_MOCK : undefined;
  const AUTH = mock ? `${mock}/auth` : 'https://accounts.google.com/o/oauth2/v2/auth';
  const TOKEN = mock ? `${mock}/token` : 'https://oauth2.googleapis.com/token';
  const REVOKE = mock ? `${mock}/revoke` : 'https://oauth2.googleapis.com/revoke';
  const API = mock ? `${mock}/calendar/v3` : 'https://www.googleapis.com/calendar/v3';

  const SERVICE = dev ? 'Axonix Google (dev)' : 'Axonix Google';
  const clientEntry = () => new Entry(SERVICE, 'client');
  const tokenEntry = () => new Entry(SERVICE, 'refresh-token');
  const statePath = path.join(dataDir, 'calendar.json');
  const cachePath = path.join(dataDir, 'calendar-cache.json');

  /* ---------- stored state ---------- */

  const readJson = <T,>(file: string, fallback: T): T => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  };
  const writeJson = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  };
  let state: State = readJson<State>(statePath, {});
  const saveState = () => writeJson(statePath, state);

  const readClient = (): { id: string; secret: string } | null => {
    try {
      const raw = clientEntry().getPassword();
      const c = raw ? (JSON.parse(raw) as { id?: unknown; secret?: unknown }) : null;
      return c && typeof c.id === 'string' && typeof c.secret === 'string' ? { id: c.id, secret: c.secret } : null;
    } catch {
      return null;
    }
  };
  const readRefresh = (): string | null => {
    try {
      return tokenEntry().getPassword() ?? null;
    } catch {
      return null;
    }
  };

  /* ---------- tokens ---------- */

  let access: { token: string; expires: number } | null = null;

  async function postForm(url: string, form: Record<string, string>) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      const err = new Error(typeof body.error_description === 'string' ? `${code}: ${body.error_description}` : code);
      (err as Error & { code?: string }).code = code;
      throw err;
    }
    return body;
  }

  async function accessToken(): Promise<string> {
    if (access && access.expires > Date.now() + 60_000) return access.token;
    const client = readClient();
    const refresh = readRefresh();
    if (!client || !refresh) throw new Error('not connected');
    try {
      const t = await postForm(TOKEN, { client_id: client.id, client_secret: client.secret, refresh_token: refresh, grant_type: 'refresh_token' });
      access = { token: String(t.access_token), expires: Date.now() + Number(t.expires_in ?? 3600) * 1000 };
      return access.token;
    } catch (e) {
      if ((e as Error & { code?: string }).code === 'invalid_grant') {
        state.lastError = 'Google no longer accepts this sign-in (it expired or was removed). Reconnect.';
        saveState();
        throw new Error('expired');
      }
      throw e;
    }
  }

  async function api<T>(method: string, route: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = `${API}${route}${opts.query ? `?${new URLSearchParams(opts.query).toString()}` : ''}`;
      const res = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${await accessToken()}`, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401 && attempt === 0) {
        access = null;
        continue;
      }
      if (res.status === 204) return undefined as T;
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
      if (!res.ok) {
        const err = new Error(body.error?.message ?? `Google Calendar answered ${res.status}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      return body;
    }
    throw new Error('Google Calendar refused the sign-in');
  }

  /* ---------- sign-in ---------- */

  let signingIn: Promise<unknown> | null = null;

  function page(title: string, text: string) {
    return `<!doctype html><meta charset="utf-8"><title>Axonix</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#06070a;color:#eef2f9;font:15px 'Segoe UI Variable',system-ui,sans-serif"><div style="text-align:center;max-width:420px"><h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${title}</h1><p style="margin:0;color:rgba(226,234,252,.6);line-height:1.5">${text}</p></div></body>`;
  }

  async function signIn() {
    const client = readClient();
    if (!client) throw new Error('Add your OAuth client ID and secret first.');
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const expect = base64url(randomBytes(16));

    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    const redirect = `http://127.0.0.1:${port}`;

    try {
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Sign-in took longer than five minutes, so it was stopped. Try again.')), SIGN_IN_TIMEOUT_MS);
        server.on('request', (req, res) => {
          const u = new URL(req.url ?? '/', redirect);
          if (u.pathname !== '/') {
            res.writeHead(404).end();
            return;
          }
          if (u.searchParams.get('state') !== expect) {
            res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(page('That link is not for this sign-in', 'Start again from Axonix.'));
            return;
          }
          clearTimeout(timer);
          const error = u.searchParams.get('error');
          const got = u.searchParams.get('code');
          res
            .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            .end(error || !got ? page('Google Calendar was not connected', 'You can close this tab and try again from Axonix.') : page('Axonix is connected to Google Calendar', 'You can close this tab.'));
          if (error || !got) reject(new Error(error === 'access_denied' ? 'Access was not granted in Google.' : `Google said: ${error ?? 'no code'}`));
          else resolve(got);
        });
        const url = `${AUTH}?${new URLSearchParams({
          client_id: client.id,
          redirect_uri: redirect,
          response_type: 'code',
          scope: SCOPES.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: expect,
          access_type: 'offline',
          prompt: 'consent',
        }).toString()}`;
        // Against the dev fake, "the browser" is a plain request that follows the redirect back.
        if (mock) void fetch(url).catch(() => undefined);
        else void shell.openExternal(url);
      });

      const t = await postForm(TOKEN, {
        code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      });
      if (typeof t.refresh_token !== 'string') throw new Error('Google did not give Axonix a lasting sign-in. Remove Axonix at myaccount.google.com/permissions and connect again.');
      tokenEntry().setPassword(t.refresh_token);
      access = { token: String(t.access_token), expires: Date.now() + Number(t.expires_in ?? 3600) * 1000 };
      state = { blocks: {} };
      await afterConnect();
    } finally {
      server.close();
    }
  }

  interface GCalendar {
    id: string;
    summary?: string;
    summaryOverride?: string;
    backgroundColor?: string;
    primary?: boolean;
    selected?: boolean;
    accessRole?: string;
  }

  async function calendarList(): Promise<GCalendar[]> {
    const out: GCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const r = await api<{ items?: GCalendar[]; nextPageToken?: string }>('GET', '/users/me/calendarList', { query: { maxResults: '250', ...(pageToken ? { pageToken } : {}) } });
      out.push(...(r.items ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Account name, the Axonix calendar (made if missing), and which calendars show. */
  async function afterConnect() {
    const list = await calendarList();
    state.account = list.find((c) => c.primary)?.id;
    await ensureAxonixCalendar(list);
    state.shown = list.filter((c) => c.selected !== false && c.id !== state.axonixCalendarId).map((c) => c.id);
    state.lastError = undefined;
    saveState();
  }

  async function ensureAxonixCalendar(list?: GCalendar[]) {
    const all = list ?? (await calendarList());
    if (state.axonixCalendarId && all.some((c) => c.id === state.axonixCalendarId)) return state.axonixCalendarId;
    const existing = all.find((c) => (c.summary ?? '') === CALENDAR_NAME && c.accessRole === 'owner');
    if (existing) {
      state.axonixCalendarId = existing.id;
    } else {
      const made = await api<{ id: string }>('POST', '/calendars', {
        body: { summary: CALENDAR_NAME, description: 'Time blocks from Axonix Tasks. Moving or deleting one here changes the task in Axonix.', timeZone: zone() },
      });
      state.axonixCalendarId = made.id;
      state.blocks = {};
    }
    saveState();
    return state.axonixCalendarId;
  }

  /* ---------- events ---------- */

  async function eventsOf(calendarId: string, timeMin: string, timeMax: string, extra: Record<string, string> = {}): Promise<GEvent[]> {
    const out: GEvent[] = [];
    let pageToken: string | undefined;
    do {
      const r = await api<{ items?: GEvent[]; nextPageToken?: string }>('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, {
        query: { timeMin, timeMax, singleEvents: 'true', maxResults: '2500', ...extra, ...(pageToken ? { pageToken } : {}) },
      });
      out.push(...(r.items ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async function events(fromDay: string, toDay: string): Promise<{ events: CalEvent[]; stale: boolean; fetchedAt: number }> {
    const timeMin = new Date(`${fromDay}T00:00:00`).toISOString();
    const timeMax = new Date(`${toDay}T23:59:59`).toISOString();
    const cache = readJson<{ fetchedAt: number; from: string; to: string; events: CalEvent[] }>(cachePath, { fetchedAt: 0, from: '', to: '', events: [] });
    try {
      const list = await calendarList();
      const colour = new Map(list.map((c) => [c.id, c.backgroundColor ?? '#9db9ff']));
      const shown = (state.shown ?? []).filter((id) => colour.has(id));
      const out: CalEvent[] = [];
      for (const id of shown) {
        for (const e of await eventsOf(id, timeMin, timeMax, { orderBy: 'startTime' })) {
          if (e.status === 'cancelled') continue;
          const s = fromGoogle(e.start);
          const en = fromGoogle(e.end);
          if (!s || !en) continue;
          out.push({
            id: e.id,
            calendarId: id,
            title: e.summary?.trim() || '(No title)',
            start: s.stamp,
            end: en.stamp,
            allDay: s.allDay,
            location: e.location,
            htmlLink: e.htmlLink,
            color: colour.get(id) ?? '#9db9ff',
          });
        }
      }
      const fetchedAt = Date.now();
      writeJson(cachePath, { fetchedAt, from: fromDay, to: toDay, events: out });
      return { events: out, stale: false, fetchedAt };
    } catch (e) {
      // Offline or refused: the last copy, said to be old.
      const inRange = cache.events.filter((x) => x.start.slice(0, 10) <= toDay && x.end.slice(0, 10) >= fromDay);
      if (!cache.fetchedAt) throw e;
      return { events: inRange, stale: true, fetchedAt: cache.fetchedAt };
    }
  }

  /* ---------- two-way time blocks ---------- */

  const eventBody = (b: Block) => ({
    summary: b.done ? `✓ ${b.title}` : b.title,
    description: `Axonix task · Tasks/${b.path}`,
    start: { dateTime: `${b.start}:00`, timeZone: zone() },
    end: { dateTime: `${b.end}:00`, timeZone: zone() },
    extendedProperties: { private: { axonixTaskId: b.taskId } },
  });

  type Remote = { taskId: string; start: string; end: string } | { taskId: string; removed: true };

  async function syncBlocks(blocks: Block[], keep: string[]): Promise<{ remote: Remote[]; created: number; updated: number; deleted: number }> {
    const calId = await ensureAxonixCalendar();
    const now = new Date();
    const from = new Date(now.getTime() - 60 * 86_400_000);
    const to = new Date(now.getTime() + 365 * 86_400_000);
    const inWindow = (stamp: string) => {
      const d = new Date(stamp);
      return d >= from && d <= to;
    };
    const list = await eventsOf(calId!, from.toISOString(), to.toISOString(), { showDeleted: 'true' });
    const byId = new Map(list.map((e) => [e.id, e]));
    const byTask = new Map<string, GEvent>();
    for (const e of list) {
      const t = e.extendedProperties?.private?.axonixTaskId;
      if (t && e.status !== 'cancelled') byTask.set(t, e);
    }
    const map = (state.blocks ??= {});
    const remote: Remote[] = [];
    let created = 0;
    let updated = 0;
    let deleted = 0;
    const wanted = new Set<string>();

    for (const b of blocks) {
      if (!STAMP.test(b.start) || !STAMP.test(b.end) || !inWindow(b.start)) continue;
      wanted.add(b.taskId);
      const m = map[b.taskId];
      const e = (m && byId.get(m.eventId)) ?? byTask.get(b.taskId);
      const live = e && e.status !== 'cancelled' ? e : undefined;
      const taskChanged = !m || m.start !== b.start || m.end !== b.end || m.title !== b.title || m.done !== b.done;

      if (!live) {
        if (m && !taskChanged) {
          // Deleted in Google: the block goes.
          remote.push({ taskId: b.taskId, removed: true });
          delete map[b.taskId];
          continue;
        }
        const made = await api<GEvent>('POST', `/calendars/${encodeURIComponent(calId!)}/events`, { body: eventBody(b) });
        map[b.taskId] = { eventId: made.id, start: b.start, end: b.end, title: b.title, done: b.done };
        created++;
        continue;
      }

      const s = fromGoogle(live.start);
      const en = fromGoogle(live.end);
      const eventChanged = !!m && !!s && !!en && !s.allDay && (s.stamp !== m.start || en.stamp !== m.end);
      if (taskChanged) {
        const same = s && en && s.stamp === b.start && en.stamp === b.end && (live.summary ?? '') === eventBody(b).summary;
        if (!same) {
          await api('PATCH', `/calendars/${encodeURIComponent(calId!)}/events/${encodeURIComponent(live.id)}`, { body: eventBody(b) });
          updated++;
        }
        map[b.taskId] = { eventId: live.id, start: b.start, end: b.end, title: b.title, done: b.done };
      } else if (eventChanged) {
        // Moved or resized in Google: the block follows.
        remote.push({ taskId: b.taskId, start: s!.stamp, end: en!.stamp });
        map[b.taskId] = { ...m!, eventId: live.id, start: s!.stamp, end: en!.stamp };
      }
    }

    // Blocks that are gone from Axonix (unscheduled, deleted): their events go too.
    const keepSet = new Set(keep);
    for (const [taskId, m] of Object.entries(map)) {
      if (wanted.has(taskId) || keepSet.has(taskId) || !inWindow(m.start)) continue;
      const e = byId.get(m.eventId);
      if (e && e.status !== 'cancelled') {
        try {
          await api('DELETE', `/calendars/${encodeURIComponent(calId!)}/events/${encodeURIComponent(m.eventId)}`);
          deleted++;
        } catch (err) {
          if ((err as Error & { status?: number }).status !== 410 && (err as Error & { status?: number }).status !== 404) throw err;
        }
      }
      delete map[taskId];
    }

    state.lastSync = Date.now();
    state.lastError = undefined;
    saveState();
    return { remote, created, updated, deleted };
  }

  /* ---------- handlers ---------- */

  const guard = (event: IpcMainInvokeEvent) => {
    if (!isHost(event.sender)) throw new Error('not allowed');
  };

  const status = () => ({
    configured: readClient() !== null,
    clientId: readClient()?.id ?? null,
    connected: readRefresh() !== null,
    account: state.account ?? null,
    axonixCalendarId: state.axonixCalendarId ?? null,
    shown: state.shown ?? [],
    lastSync: state.lastSync ?? null,
    error: state.lastError ?? null,
    signingIn: signingIn !== null,
  });

  const friendly = (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    if (m === 'not connected') return 'Google Calendar is not connected.';
    if (m === 'expired') return state.lastError ?? 'Reconnect Google Calendar.';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|timeout|aborted/i.test(m)) return 'Google could not be reached. Axonix will try again.';
    return m;
  };

  ipcMain.handle('gcal:status', (event) => {
    guard(event);
    return status();
  });

  ipcMain.handle('gcal:set-client', (event, id: unknown, secret: unknown) => {
    guard(event);
    if (typeof id !== 'string' || typeof secret !== 'string') throw new Error('invalid client');
    const cid = id.trim();
    const sec = secret.trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(cid) || cid.length > 200) throw new Error('That does not look like an OAuth client ID. It ends in .apps.googleusercontent.com.');
    if (!sec || sec.length > 200 || /\s/.test(sec)) throw new Error('Paste the client secret as Google shows it.');
    clientEntry().setPassword(JSON.stringify({ id: cid, secret: sec }));
    return status();
  });

  ipcMain.handle('gcal:connect', async (event) => {
    guard(event);
    if (signingIn) throw new Error('A sign-in is already open in your browser.');
    signingIn = signIn();
    try {
      await signingIn;
    } catch (e) {
      throw new Error(friendly(e));
    } finally {
      signingIn = null;
    }
    return status();
  });

  ipcMain.handle('gcal:disconnect', async (event, forgetClient: unknown) => {
    guard(event);
    const refresh = readRefresh();
    if (refresh) {
      try {
        await fetch(`${REVOKE}?${new URLSearchParams({ token: refresh }).toString()}`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
      } catch {
        // Offline: the token is still forgotten here, and can be removed at myaccount.google.com/permissions.
      }
    }
    try {
      tokenEntry().deleteCredential();
    } catch {
      // Nothing saved.
    }
    if (forgetClient === true) {
      try {
        clientEntry().deleteCredential();
      } catch {
        // Nothing saved.
      }
    }
    access = null;
    state = {};
    saveState();
    try {
      fs.rmSync(cachePath, { force: true });
    } catch {
      // No cache.
    }
    return status();
  });

  ipcMain.handle('gcal:calendars', async (event) => {
    guard(event);
    try {
      const list = await calendarList();
      return list.map((c) => ({
        id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        color: c.backgroundColor ?? '#9db9ff',
        primary: c.primary === true,
        axonix: c.id === state.axonixCalendarId,
        shown: (state.shown ?? []).includes(c.id),
      }));
    } catch (e) {
      throw new Error(friendly(e));
    }
  });

  ipcMain.handle('gcal:set-shown', (event, ids: unknown) => {
    guard(event);
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string')) throw new Error('invalid calendars');
    state.shown = (ids as string[]).slice(0, 100);
    saveState();
    return status();
  });

  ipcMain.handle('gcal:events', async (event, fromDay: unknown, toDay: unknown) => {
    guard(event);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof fromDay !== 'string' || typeof toDay !== 'string' || !day.test(fromDay) || !day.test(toDay)) throw new Error('invalid range');
    try {
      return await events(fromDay, toDay);
    } catch (e) {
      throw new Error(friendly(e));
    }
  });

  ipcMain.handle('gcal:sync-blocks', async (event, blocks: unknown, keep: unknown) => {
    guard(event);
    if (!Array.isArray(blocks) || !Array.isArray(keep)) throw new Error('invalid blocks');
    const clean: Block[] = [];
    for (const raw of blocks.slice(0, 5000) as Partial<Block>[]) {
      if (typeof raw?.taskId !== 'string' || typeof raw.title !== 'string' || typeof raw.start !== 'string' || typeof raw.end !== 'string' || typeof raw.path !== 'string') continue;
      clean.push({ taskId: raw.taskId, title: raw.title.slice(0, 500), start: raw.start, end: raw.end, done: raw.done === true, path: raw.path.slice(0, 400) });
    }
    try {
      return await syncBlocks(
        clean,
        (keep as unknown[]).filter((k): k is string => typeof k === 'string'),
      );
    } catch (e) {
      state.lastError = friendly(e);
      saveState();
      throw new Error(state.lastError);
    }
  });
}
