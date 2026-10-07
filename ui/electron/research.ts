/**
 * The one place Axonix reaches the internet.
 *
 * Rules, because a research tool that crawls quietly is a liability:
 *
 *   · an **allowlist** of hosts, nothing else is fetched, ever;
 *   · official open APIs and open datasets first — OpenAlex, College Scorecard,
 *     ROR, Frankfurter (ECB rates), the MIT university list;
 *   · one page at a time, only for a URL the owner pasted, and only after
 *     `robots.txt` is read and honoured — no crawling, no queue, no following
 *     links, nothing behind a login;
 *   · every answer is cached on disk, so the page works offline and a second
 *     look costs nothing;
 *   · keys live in Windows Credential Manager, never in a file;
 *   · every request says who it is (a contact e-mail, the polite pools) and is
 *     rate-limited per host.
 *
 * Nothing here writes to the vault. The renderer asks for a source by id, gets
 * data back, and the owner confirms whatever becomes a note.
 */
import { app, ipcMain, net } from 'electron';
import { Entry } from '@napi-rs/keyring';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CONTACT = 'axonix-desktop (personal research tool)';
const CACHE_DIR = () => path.join(app.getPath('userData'), 'research-cache');
const DAY = 86_400_000;

/** Hosts Axonix may call at all. Anything else is refused, whatever asks. */
const ALLOW = new Set([
  'api.openalex.org',
  'api.data.gov',
  'api.ror.org',
  'api.crossref.org',
  'api.frankfurter.app',
  'raw.githubusercontent.com',
]);

type Json = unknown;

interface University {
  name: string;
  country: string;
  alpha_two_code: string;
  domains: string[];
  web_pages: string[];
}

interface Cached {
  at: number;
  status: number;
  body: string;
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR(), `${crypto.createHash('sha1').update(key).digest('hex')}.json`);
}

function readCache(key: string, maxAge: number): Cached | null {
  try {
    const raw = fs.readFileSync(cachePath(key), 'utf8');
    const c = JSON.parse(raw) as Cached;
    return Date.now() - c.at <= maxAge ? c : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: Cached) {
  try {
    fs.mkdirSync(CACHE_DIR(), { recursive: true });
    fs.writeFileSync(cachePath(key), JSON.stringify(value), 'utf8');
  } catch {
    // A cache that cannot be written is not a reason to fail the fetch.
  }
}

/** One request at a time per host, and never faster than this. */
const GAP = 1100;
const lastCall = new Map<string, number>();
async function polite(host: string) {
  const last = lastCall.get(host) ?? 0;
  const wait = last + GAP - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall.set(host, Date.now());
}

async function request(url: string, accept: string): Promise<{ status: number; body: string }> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only https is fetched.');
  await polite(u.host);
  const res = await net.fetch(url, {
    headers: { Accept: accept, 'User-Agent': CONTACT },
    redirect: 'follow',
  });
  const body = await res.text();
  return { status: res.status, body };
}

/** An allowlisted API call, cached. */
async function api(url: string, maxAge = DAY): Promise<Json> {
  const u = new URL(url);
  if (!ALLOW.has(u.host)) throw new Error(`${u.host} is not on the research allowlist.`);
  const hit = readCache(url, maxAge);
  if (hit) return JSON.parse(hit.body) as Json;
  const { status, body } = await request(url, 'application/json');
  if (status >= 400) throw new Error(`${u.host} answered ${status}.`);
  writeCache(url, { at: Date.now(), status, body });
  return JSON.parse(body) as Json;
}

/* ------------------------------------------------------------------ */
/* one page, pasted by the owner                                       */
/* ------------------------------------------------------------------ */

/** `robots.txt`, honoured for the `*` agent. Unreadable robots means "do not fetch". */
async function robotsAllow(target: URL): Promise<boolean> {
  const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
  const hit = readCache(robotsUrl, 7 * DAY);
  let text: string;
  if (hit) text = hit.body;
  else {
    try {
      const res = await request(robotsUrl, 'text/plain');
      text = res.status === 404 ? '' : res.body;
      writeCache(robotsUrl, { at: Date.now(), status: res.status, body: text });
    } catch {
      return false;
    }
  }
  let mine = false;
  const disallowed: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.split('#')[0].split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') mine = value === '*';
    else if (mine && key === 'disallow' && value) disallowed.push(value);
    else if (mine && key === 'allow' && value === '/') return true;
  }
  return !disallowed.some((rule) => target.pathname.startsWith(rule));
}

/** Readable text and a few obvious fields from one page the owner pasted. */
async function page(url: string): Promise<{ url: string; title: string; text: string; fetchedAt: number }> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only https pages are fetched.');
  const hit = readCache(`page:${url}`, 7 * DAY);
  if (hit) return JSON.parse(hit.body) as { url: string; title: string; text: string; fetchedAt: number };
  if (!(await robotsAllow(u))) throw new Error(`${u.host} asks robots not to fetch that page, so Axonix did not.`);
  const { status, body } = await request(url, 'text/html');
  if (status >= 400) throw new Error(`${u.host} answered ${status}.`);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.trim() ?? u.host;
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40_000);
  const out = { url, title: title.replace(/\s+/g, ' '), text, fetchedAt: Date.now() };
  writeCache(`page:${url}`, { at: Date.now(), status, body: JSON.stringify(out) });
  return out;
}

/* ------------------------------------------------------------------ */
/* the sources                                                         */
/* ------------------------------------------------------------------ */

export type KeyName = 'openalex' | 'scorecard';
type Keys = { openalex?: string; scorecard?: string };

/** The owner makes their own keys; Axonix keeps them where Windows keeps secrets. */
const SERVICE = 'Axonix Research';
const entry = (name: KeyName) => new Entry(SERVICE, name);
const readKey = (name: KeyName): string | undefined => {
  try {
    return entry(name).getPassword() ?? undefined;
  } catch {
    return undefined;
  }
};

export function registerResearch() {
  const keys = async (): Promise<Keys> => ({ openalex: readKey('openalex'), scorecard: readKey('scorecard') });

  /** Which keys are set — never the keys themselves. */
  ipcMain.handle('research:keys', async () => ({ openalex: Boolean(readKey('openalex')), scorecard: Boolean(readKey('scorecard')) }));

  ipcMain.handle('research:setKey', async (_e, name: unknown, value: unknown) => {
    const key = String(name) as KeyName;
    if (key !== 'openalex' && key !== 'scorecard') throw new Error('Unknown key.');
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) entry(key).setPassword(text);
    else {
      try {
        entry(key).deleteCredential();
      } catch {
        // Not set is the same as cleared.
      }
    }
    return { openalex: Boolean(readKey('openalex')), scorecard: Boolean(readKey('scorecard')) };
  });

  /** OpenAlex: researchers, institutions and what they publish on. CC0 data. */
  ipcMain.handle('research:openalex', async (_e, kind: unknown, params: unknown) => {
    const what = String(kind);
    if (!['works', 'authors', 'institutions', 'topics'].includes(what)) throw new Error('Unknown OpenAlex entity.');
    const q = new URLSearchParams(params as Record<string, string>);
    const key = (await keys()).openalex;
    if (key) q.set('api_key', key);
    q.set('mailto', 'axonix');
    return api(`https://api.openalex.org/${what}?${q.toString()}`);
  });

  /** College Scorecard: US institutions and their fields of study. Public domain. */
  ipcMain.handle('research:scorecard', async (_e, params: unknown) => {
    const key = (await keys()).scorecard;
    if (!key) throw new Error('Add a College Scorecard key first (Research settings).');
    const q = new URLSearchParams(params as Record<string, string>);
    q.set('api_key', key);
    return api(`https://api.data.gov/ed/collegescorecard/v1/schools?${q.toString()}`);
  });

  /** ROR: one canonical id per institution, to join the sources on. */
  ipcMain.handle('research:ror', async (_e, query: unknown) => api(`https://api.ror.org/organizations?query=${encodeURIComponent(String(query))}`, 30 * DAY));

  /**
   * Universities and their countries: the MIT list itself, fetched once a month
   * and filtered here. The project's hosted API is often down; the file is not.
   */
  ipcMain.handle('research:universities', async (_e, query: unknown, country: unknown) => {
    const all = (await api('https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json', 30 * DAY)) as University[];
    const q = String(query ?? '').trim().toLowerCase();
    const cc = country ? String(country).toUpperCase() : undefined;
    if (!q) return [];
    return all
      .filter((u) => (!cc || u.alpha_two_code === cc) && u.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q) || a.name.length - b.name.length)
      .slice(0, 12);
  });

  /** Daily reference rates, for showing a fee in rupees. */
  ipcMain.handle('research:rates', async (_e, base: unknown) => api(`https://api.frankfurter.app/latest?from=${encodeURIComponent(String(base ?? 'EUR'))}&to=INR`, DAY));

  /** One page the owner pasted. */
  ipcMain.handle('research:page', async (_e, url: unknown) => page(String(url)));

  /** What the cache holds, and emptying it. */
  ipcMain.handle('research:cache', async (_e, action: unknown) => {
    const dir = CACHE_DIR();
    if (action === 'clear') {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Nothing cached is the same as an empty cache.
      }
      return { files: 0, bytes: 0 };
    }
    try {
      const files = fs.readdirSync(dir);
      const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
      return { files: files.length, bytes };
    } catch {
      return { files: 0, bytes: 0 };
    }
  });
}
