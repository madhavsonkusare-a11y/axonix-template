/**
 * Tracker blocking for the social apps.
 *
 * Every app's session drops the requests EasyPrivacy lists as tracking —
 * analytics, ad measurement, telemetry beacons, third-party pixels and the
 * frames they come in. A page then runs fewer scripts and fewer frames (each
 * cross-site frame is a process of its own), so it takes less memory and CPU.
 *
 * Network blocking only: no cosmetic filters and nothing injected into pages.
 * Matching is Ghostery's engine (@ghostery/adblocker, MPL-2.0); the list is
 * vendored in `blocklists/` and compiled at build time (scripts/blocklist.mjs)
 * into `easyprivacy.bin` beside this bundle, which loads in ~10ms.
 *
 * Never blocked: a page's own navigation, and anything from the sign-in and
 * captcha providers that the apps' sign-ins depend on. `AXONIX_NO_BLOCKER=1`
 * turns it off, to rule it out when a site misbehaves.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { OnBeforeRequestListenerDetails, Session } from 'electron';
import { FiltersEngine, Request } from '@ghostery/adblocker';

/** Sign-in and captcha providers: never touched. */
const NEVER_BLOCK = ['google.com', 'gstatic.com', 'recaptcha.net', 'apple.com', 'arkoselabs.com', 'funcaptcha.com', 'hcaptcha.com', 'cloudflare.com'];

const TYPES: Record<string, Parameters<typeof Request.fromRawDetails>[0]['type']> = {
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other',
};

let engine: FiltersEngine | null | undefined;

function load(): FiltersEngine | null {
  if (engine !== undefined) return engine;
  engine = null;
  if (process.env.AXONIX_NO_BLOCKER) return engine;
  try {
    engine = FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(path.join(__dirname, 'easyprivacy.bin'))));
  } catch {
    // Not built (or unreadable): the apps work as before, unblocked.
  }
  return engine;
}

const neverBlock = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return NEVER_BLOCK.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
};

function blocks(filters: FiltersEngine, details: OnBeforeRequestListenerDetails): boolean {
  const type = TYPES[details.resourceType];
  if (!type || !/^(https?|wss?):/.test(details.url) || neverBlock(details.url)) return false;
  const sourceUrl = details.frame?.url || details.referrer || details.webContents?.getURL() || '';
  return filters.match(Request.fromRawDetails({ url: details.url, sourceUrl, type })).match;
}

/** Start blocking trackers in one app's session. */
export function blockTrackers(ses: Session) {
  const filters = load();
  if (!filters) return;
  ses.webRequest.onBeforeRequest((details, callback) => {
    let cancel = false;
    try {
      cancel = blocks(filters, details);
    } catch {
      // A request the engine can't read goes through.
    }
    callback({ cancel });
  });
}
