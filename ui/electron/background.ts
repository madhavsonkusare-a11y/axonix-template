/**
 * Background apps: a page nobody can see stops using the CPU.
 *
 * Chromium never tells a <webview> that it is hidden — `document.visibilityState`
 * stays "visible" whatever the CSS says (electron/electron#28677) — so the pages
 * behind the one on screen kept every timer running at full speed, and their
 * sites never paused anything. The dock tells this module which apps are on
 * screen; a page that has been off screen for FREEZE_AFTER_MS is then
 *   - trimmed: a critical memory-pressure signal (Chromium drops decoded images
 *     and other caches) and a garbage collection, and
 *   - frozen: `Page.setWebLifecycleState` over the DevTools protocol, the way
 *     Chrome freezes background tabs. No timers, no script, no network
 *     callbacks; the page keeps its state, scroll position and sign-in.
 * It wakes the moment it is shown again, and for CATCH_UP_MS every
 * CATCH_UP_EVERY_MS on its own, so unread badges and notifications still
 * arrive. A page playing sound, or still loading, is left running (Chrome's
 * rules for background tabs). A minimised window counts as off screen.
 *
 * After ten minutes off screen the dock puts the app to sleep and the page is
 * released altogether (SocialApp.tsx); this covers the time before that.
 */
import type { WebContents } from 'electron';
import type { SocialAppId } from '../src/social/apps';

const FREEZE_AFTER_MS = 2 * 60_000;
const RETRY_MS = 30_000;
const CATCH_UP_EVERY_MS = 2 * 60_000;
const CATCH_UP_MS = 5_000;
/** Pages frozen together don't all wake in the same second. */
const STAGGER_MS = 9_000;

interface Page {
  wc: WebContents;
  app: SocialAppId;
  shown: boolean;
  frozen: boolean;
  timer: NodeJS.Timeout | null;
}

const pages = new Map<number, Page>();
let shownApps = new Set<SocialAppId>();
let windowShown = true;

async function cdp(page: Page, method: string, params?: Record<string, unknown>): Promise<boolean> {
  const { wc } = page;
  if (wc.isDestroyed()) return false;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    await wc.debugger.sendCommand(method, params);
    return true;
  } catch {
    // Detached mid-command, a crashed renderer, or DevTools holding the page.
    return false;
  }
}

function clear(page: Page) {
  if (page.timer) clearTimeout(page.timer);
  page.timer = null;
}

function later(page: Page, ms: number, fn: () => void) {
  clear(page);
  page.timer = setTimeout(() => {
    page.timer = null;
    fn();
  }, ms);
}

async function freeze(page: Page, trim: boolean) {
  if (page.shown || page.wc.isDestroyed()) return;
  if (page.wc.isCurrentlyAudible() || page.wc.isLoading()) {
    later(page, RETRY_MS, () => void freeze(page, trim));
    return;
  }
  if (trim) {
    await cdp(page, 'Memory.simulatePressureNotification', { level: 'critical' });
    await cdp(page, 'HeapProfiler.collectGarbage');
  }
  if (page.shown) return; // Shown again while trimming.
  if (!(await cdp(page, 'Page.setWebLifecycleState', { state: 'frozen' }))) return;
  page.frozen = true;
  const stagger = ([...pages.values()].filter((p) => p.frozen).length - 1) * STAGGER_MS;
  later(page, CATCH_UP_EVERY_MS + Math.max(0, stagger % CATCH_UP_EVERY_MS), () => void catchUp(page));
}

async function thaw(page: Page) {
  if (!page.frozen) return;
  page.frozen = false;
  await cdp(page, 'Page.setWebLifecycleState', { state: 'active' });
}

/** A few seconds awake, so badges and notifications keep arriving. */
async function catchUp(page: Page) {
  if (page.shown || !page.frozen) return;
  await thaw(page);
  later(page, CATCH_UP_MS, () => void freeze(page, false));
}

function update(page: Page) {
  const shown = windowShown && shownApps.has(page.app);
  if (shown === page.shown && (shown || page.frozen || page.timer)) return;
  page.shown = shown;
  if (!page.wc.isDestroyed()) page.wc.send('axonix:shown', shown);
  if (shown) {
    clear(page);
    void thaw(page).then(() => {
      if (page.shown && !page.wc.isDestroyed() && page.wc.debugger.isAttached()) page.wc.debugger.detach();
    });
  } else {
    later(page, FREEZE_AFTER_MS, () => void freeze(page, true));
  }
}

/** A social page (a <webview> guest) came into being. */
export function adopt(wc: WebContents, app: SocialAppId) {
  const page: Page = { wc, app, shown: true, frozen: false, timer: null };
  pages.set(wc.id, page);
  wc.once('destroyed', () => {
    clear(page);
    pages.delete(wc.id);
  });
  // The preload asks once it is listening, and again after every navigation.
  wc.on('dom-ready', () => {
    if (!wc.isDestroyed()) wc.send('axonix:shown', page.shown);
  });
  page.shown = !(windowShown && shownApps.has(app));
  update(page);
}

/** The apps on screen, from the dock (one, two in split view, or none). */
export function setShownApps(ids: SocialAppId[]) {
  shownApps = new Set(ids);
  for (const page of pages.values()) update(page);
}

/** The window was minimised or hidden (false), or came back (true). */
export function setWindowShown(shown: boolean) {
  windowShown = shown;
  for (const page of pages.values()) update(page);
}

export function isFrozen(wc: WebContents): boolean {
  return pages.get(wc.id)?.frozen ?? false;
}
