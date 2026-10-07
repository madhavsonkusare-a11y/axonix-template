/**
 * Axonix — Unified Desktop Shell (Electron main process).
 *
 * One single desktop app for all modules: Home launcher, Finance Tracker,
 * and Social Network.
 *
 * - Home, Finance, and Social all live inside the same window.
 * - Social guest <webview>s are composited directly into the page, allowing
 *   the Liquid Glass dock, modals, and animations to render cleanly over them.
 * - Finance data (%LOCALAPPDATA%\Axonix\finance-data.json) is loaded and
 *   saved with atomic replacement, startup snapshots, and pre-mutation backups.
 * - Bank statement passwords and social passwords are stored securely in
 *   Windows Credential Manager via @napi-rs/keyring.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, screen, session, shell, webContents } from 'electron';
import type { ContextMenuParams, Input, IpcMainEvent, IpcMainInvokeEvent, Rectangle, Session, WebContents } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { Entry } from '@napi-rs/keyring';
import { SOCIAL_APPS, appById, classify, partitionOf, type SocialApp, type SocialAppId } from '../src/social/apps';
import { listLogins, readLogin, removeLogin, saveLogin, type Login } from './passwords';
import { adopt, isFrozen, setShownApps, setWindowShown } from './background';
import { blockTrackers } from './blocker';
import { registerTasks } from './tasks';
import { registerVault, registerVaultScheme } from './vault';
import { registerCalendar } from './gcal';
import { registerResearch } from './research';
import { registerAssistant } from './chatgpt';
import { registerStoreroom, STOREROOM_SCHEME, type StoreroomService } from './storeroom';
import { registerDoor } from './door';
import { PAPERCLIP_TOOLS, registerPaperclip } from './paperclip';
import { registerTerminal } from './terminal';

const DEV = Boolean(process.env.AXONIX_DEV || process.env.AXONIX_SOCIAL_DEV);
const DEV_URL = process.env.AXONIX_DEV_URL || process.env.AXONIX_SOCIAL_DEV_URL;

// Base paths
const localAppData = process.env.LOCALAPPDATA ?? (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '.');
const financeDir = path.join(localAppData, 'Axonix');
const financeDataPath = path.join(financeDir, 'finance-data.json');
const financeBackupsDir = path.join(financeDir, 'backups');
const financeLogsDir = path.join(financeDir, 'logs');
const STATEMENT_PASSWORD_SERVICE = 'Axonix statement password';
/** The Obsidian vault: the capture server writes notes into it, and Tasks keeps its files in `Tasks/`. */
const VAULT = process.env.AXONIX_VAULT ?? 'D:/05 Notes/My Vault';
/**
 * The Storeroom's library: references and their sidecars (electron/storeroom.ts).
 * Outside the vault on purpose — Obsidian Sync caps files at 5 MB, and motion
 * references are video. The design language itself lives in the vault.
 */
const STOREROOM = process.env.AXONIX_STOREROOM ?? 'D:/04 Media/Storeroom';

// Social user profile (cookies, sessions) stays isolated in its own profile dir
app.setPath('userData', path.join(localAppData, DEV ? 'Axonix (dev)' : 'Axonix Profile'));
app.setAppUserModelId('com.axonix.app');
// Note images reach the page through vault:// (vault.ts) and Storeroom media through
// storeroom:// (storeroom.ts); schemes must be privileged before ready, in one list.
registerVaultScheme([STOREROOM_SCHEME]);

// Graphics on the integrated GPU. On a laptop with two GPUs Chromium otherwise
// followed the system's preference onto the discrete one (the GTX 1650 on the
// owner's laptop), keeping it powered for a window of web pages. The camera
// service gets the same treatment: X queries camera permission while it
// fingerprints the browser, which starts Chromium's video capture service, and
// with D3D11 capture on that service opened its own context on the discrete
// GPU. No page here is ever allowed a camera, so nothing is lost.
app.commandLine.appendSwitch('force_low_power_gpu');
const disabledFeatures = app.commandLine.getSwitchValue('disable-features');
// FedCM (FedCm): Chromium exposes it but Electron has no dialog to serve it, so
// Google's "Continue with Google" took that path and every attempt failed with
// "FedCM get() rejects with NetworkError" — the button did nothing (measured on
// Pinterest, 2026-09-27). With it off, Google falls back to its sign-in popup.
app.commandLine.appendSwitch(
  'disable-features',
  [disabledFeatures, 'MediaFoundationD3D11VideoCapture', 'FedCm'].filter(Boolean).join(','),
);

// Reduced user agent for Google sign-in compatibility
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
app.userAgentFallback = CHROME_UA;

/**
 * Chrome's user-agent client hints. Chromium sends these on every request;
 * Electron 44 sends them on a page's own requests but not on navigations
 * (measured 2026-09-27), so Google's sign-in pages arrived without them. The
 * brand list is Chromium's, built the way `user_agent_utils.cc` builds it —
 * the same list the page's own `navigator.userAgentData` reports, so the two
 * never disagree: "Not?A_Brand";v="24", "Chromium";v="152" on Chromium 152.
 */
const CLIENT_HINTS = (() => {
  const major = Number(process.versions.chrome.split('.')[0]);
  const grease = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const brands: [string, string][] = [];
  brands[major % 2] = [`Not${grease[major % grease.length]}A${grease[(major + 1) % grease.length]}Brand`, ['8', '99', '24'][major % 3]];
  brands[(major + 1) % 2] = ['Chromium', String(major)];
  return {
    'sec-ch-ua': brands.map(([brand, version]) => `"${brand}";v="${version}"`).join(', '),
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
})();

/** What a site may ask for. Camera, microphone, location and the rest are refused. */
const ALLOWED_PERMISSIONS = new Set(['notifications', 'fullscreen', 'clipboard-sanitized-write']);

// ---------------------------------------------------------------------------
// Sandbox check & logging

function adminShareTwin(filePath: string): string | null {
  const match = /^([A-Za-z]):\\(.*)$/.exec(filePath);
  if (!match) return null;
  return `\\\\localhost\\${match[1].toUpperCase()}$\\${match[2]}`;
}

function isSandboxed(): boolean {
  try {
    const twin = adminShareTwin(financeDataPath);
    if (!twin) return false;
    const twinDir = path.dirname(twin);
    if (!fs.existsSync(twinDir)) return false;
    if (!fs.existsSync(financeDataPath) || !fs.existsSync(twin)) return false;
    const directBuf = fs.readFileSync(financeDataPath);
    const twinBuf = fs.readFileSync(twin);
    return !directBuf.equals(twinBuf);
  } catch {
    return false;
  }
}

// Support CLI `--sandbox-check` (exit 10 if redirected, 0 if real)
if (process.argv.includes('--sandbox-check')) {
  const sandboxed = isSandboxed();
  if (sandboxed) {
    console.error('Axonix sees a redirected data folder');
  }
  app.exit(sandboxed ? 10 : 0);
}

function initLogging() {
  try {
    fs.mkdirSync(financeLogsDir, { recursive: true });
    const logFile = path.join(financeLogsDir, 'axonix-app.log');
    const msg = `INFO axonix_app: frontend source: embedded dist dev_mode=${DEV}\n`;
    fs.writeFileSync(logFile, msg, { flag: 'w' });
  } catch {}
}

// ---------------------------------------------------------------------------
// Loopback Capture Server (axonix-capture.exe)

let captureChild: ChildProcess | null = null;

function ensureCaptureServer() {
  const socket = new net.Socket();
  socket.setTimeout(400);
  socket.on('connect', () => {
    socket.destroy();
  });
  socket.on('error', () => {
    socket.destroy();
    startCaptureServer();
  });
  socket.on('timeout', () => {
    socket.destroy();
    startCaptureServer();
  });
  socket.connect(8787, '127.0.0.1');
}

function startCaptureServer() {
  const dir = path.dirname(process.execPath);
  const candidates = [
    path.join(dir, 'axonix-capture.exe'),
    path.join(dir, '..', 'axonix-capture.exe'),
  ];
  const bin = candidates.find((c) => fs.existsSync(c));
  if (!bin) return;
  captureChild = spawn(bin, [VAULT], { stdio: 'ignore', detached: false });
}

// ---------------------------------------------------------------------------
// Finance data snapshots and persistence

const STARTUP_BACKUPS_KEPT = 20;
const NAMED_BACKUPS_KEPT = 60;
let startupBackupDone = false;

function snapshotFinanceData(reason: string): string | null {
  try {
    if (!fs.existsSync(financeDataPath)) return null;
    fs.mkdirSync(financeBackupsDir, { recursive: true });
    const secs = Math.floor(Date.now() / 1000);
    const label = reason.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40);
    const dest = path.join(financeBackupsDir, `finance-data-${secs}-${label}.json`);
    fs.copyFileSync(financeDataPath, dest);

    // Prune old backups
    const files = fs.readdirSync(financeBackupsDir)
      .filter((n) => n.startsWith('finance-data-') && n.endsWith('.json'))
      .sort();
    
    const startup = files.filter((n) => n.endsWith('-startup.json'));
    const named = files.filter((n) => !n.endsWith('-startup.json'));

    for (const [list, keep] of [[startup, STARTUP_BACKUPS_KEPT], [named, NAMED_BACKUPS_KEPT]] as const) {
      const excess = list.length - keep;
      if (excess > 0) {
        for (let i = 0; i < excess; i++) {
          try { fs.unlinkSync(path.join(financeBackupsDir, list[i])); } catch {}
        }
      }
    }
    return dest;
  } catch (err) {
    console.error('Failed to snapshot finance data:', err);
    return null;
  }
}

function statementPasswordEntry(bank: string): Entry {
  const valid = bank.length > 0 && bank.length <= 40 && /^[a-zA-Z0-9-_]+$/.test(bank);
  if (!valid) throw new Error(`unexpected statement password key: ${bank}`);
  return new Entry(STATEMENT_PASSWORD_SERVICE, bank);
}

// ---------------------------------------------------------------------------
// Window state

interface State {
  bounds?: Rectangle;
  maximized?: boolean;
  neverSave?: SocialAppId[];
  /** Where the Social split divider sits. Which apps were open is deliberately not kept. */
  splitRatio?: number;
  /** The Storeroom's own window. */
  storeroomBounds?: Rectangle;
  storeroomMaximized?: boolean;
}

const statePath = () => path.join(app.getPath('userData'), 'state.json');

function loadState(): State {
  try {
    // Only the keys still in use: an older version's (which app was open) is
    // dropped rather than carried forward.
    const { bounds, maximized, neverSave, splitRatio, storeroomBounds, storeroomMaximized } = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as State;
    return { bounds, maximized, neverSave, splitRatio, storeroomBounds, storeroomMaximized };
  } catch {
    return {};
  }
}

let state: State = loadState();
let stateTimer: NodeJS.Timeout | null = null;

function writeState() {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = null;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const tmp = `${statePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, statePath());
  } catch {}
}

const writeStateSoon = () => {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(writeState, 400);
};

// ---------------------------------------------------------------------------

let win: BrowserWindow | null = null;
/** The Storeroom in a window of its own (`--storeroom`, or popped out of Axonix). */
let storeWin: BrowserWindow | null = null;
let storeroom: StoreroomService | null = null;
const sessionApps = new Map<Session, SocialApp>();

const argApp = (argv: string[]) => appById(argv.find((a) => a.startsWith('--app='))?.slice('--app='.length));

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Every Axonix window: the Storeroom's news reaches the one it opened in, too. */
function broadcast(channel: string, payload: unknown) {
  send(channel, payload);
  if (storeWin && !storeWin.isDestroyed()) storeWin.webContents.send(channel, payload);
}

function openOutside(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') void shell.openExternal(url.href);
  } catch {}
}

// ---------------------------------------------------------------------------
// Staying signed in
//
// Each app's session lives in `<userData>\Partitions\social-<app>`. Two things
// used to sign the owner out across restarts:
//   - Chromium writes cookies to disk only every 30 seconds, so a login (or a
//     token the site just rotated) made shortly before the app closed, crashed,
//     was force-closed by a rebuild or went down with Windows was lost.
//   - "Session" cookies — no expiry, the kind a site sets when it expects a
//     browser to keep them — are dropped on exit. Chrome keeps them when it is
//     set to continue where you left off; Electron never does.
// So every cookie change is written to disk within a second, everything is
// flushed before quitting, and the apps' own session cookies are kept.
//
// The profile folder and the partition names are part of the owner's logins:
// renaming either signs them out of every site (it happened when the Social
// app was folded into this one). Never change them.

/** Chromium's cap on a cookie's lifetime. */
const KEEP_SIGNED_IN_S = 400 * 24 * 60 * 60;
/** Sign-in providers whose cookies an app's login depends on. */
const SIGN_IN_DOMAINS = ['google.com', 'apple.com', 'facebook.com'];

async function flushSession(ses: Session) {
  try {
    ses.flushStorageData();
    await ses.cookies.flushStore();
  } catch {
    // A session being torn down can refuse; the next flush or quit covers it.
  }
}

/** Re-set a session-only cookie with an expiry, so it survives restarts. */
function keepCookie(ses: Session, target: SocialApp, c: Electron.Cookie) {
  const host = (c.domain ?? '').replace(/^\./, '').toLowerCase();
  const ours = [...target.hosts, ...SIGN_IN_DOMAINS].some((d) => host === d || host.endsWith(`.${d}`));
  if (!host || !ours) return;
  void ses.cookies
    .set({
      url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
      name: c.name,
      value: c.value,
      // Host-only cookies (and every `__Host-` cookie) must not gain a Domain.
      domain: c.hostOnly ? undefined : c.domain,
      path: c.path || '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: Math.floor(Date.now() / 1000) + KEEP_SIGNED_IN_S,
    })
    .catch(() => {
      // A cookie the store refuses stays as the site set it.
    });
}

function keepSignedIn(ses: Session, target: SocialApp) {
  let timer: NodeJS.Timeout | null = null;
  ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
    if (!removed && cookie.session) keepCookie(ses, target, cookie);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flushSession(ses);
    }, 1000);
  });
}

/** Flush every app's cookies and storage; resolves within `budgetMs` either way. */
function flushAllSessions(budgetMs = 2500) {
  return Promise.race([Promise.all([...sessionApps.keys()].map(flushSession)), new Promise((r) => setTimeout(r, budgetMs))]);
}

function prepareSessions() {
  for (const target of SOCIAL_APPS) {
    const ses = session.fromPartition(partitionOf(target.id));
    sessionApps.set(ses, target);
    // Chrome's Accept-Language shape ("en-US,en;q=0.9"), not Electron's bare "en-US".
    ses.setUserAgent(CHROME_UA, 'en-US,en');
    ses.setSpellCheckerEnabled(false);
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
    keepSignedIn(ses, target);
    blockTrackers(ses);
    // Signing in with Google (or any provider) should look like Chrome to the provider:
    // Chrome's `window.chrome` in the app's page and in its sign-in popups (preload-chrome.ts),
    // and the client hints Electron leaves off navigations. Navigations only, so a feed's
    // hundreds of image requests never pass through here.
    ses.registerPreloadScript({ type: 'frame', id: 'axonix-chrome-shape', filePath: path.join(__dirname, 'preload-chrome.js') });
    ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'], types: ['mainFrame', 'subFrame'] }, (details, callback) => {
      const headers = details.requestHeaders;
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'sec-ch-ua')) Object.assign(headers, CLIENT_HINTS);
      callback({ requestHeaders: headers });
    });
  }
}

const US_SHIFTED_DIGITS: Record<string, number> = { '!': 1, '@': 2, '#': 3, $: 4, '%': 5, '^': 6 };

function shiftedDigit(input: Input): number | null {
  const byCode = /^Digit([1-6])$/.exec(input.code)?.[1];
  if (byCode) return Number(byCode);
  return US_SHIFTED_DIGITS[input.key] ?? (/^[1-6]$/.test(input.key) ? Number(input.key) : null);
}

/** Shortcuts: navigation, reload, devtools. */
function shortcut(event: Electron.Event, input: Input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const key = input.key;
  let action: string | null = null;
  if (ctrl && !input.alt && !input.shift && /^[1-6]$/.test(key)) action = `open:${SOCIAL_APPS[Number(key) - 1].id}`;
  // Ctrl+Shift+1…6 puts that app in the other split pane. With Shift held the
  // key reads "!", "@", … so the physical key (`code`) decides; the US symbols
  // cover input that arrives without a scan code.
  else if (ctrl && input.shift && !input.alt && shiftedDigit(input)) action = `split:${SOCIAL_APPS[shiftedDigit(input)! - 1].id}`;
  else if (ctrl && !input.alt && !input.shift && key === 'ArrowUp') action = 'overview';
  else if ((ctrl && !input.alt && key.toLowerCase() === 'r') || key === 'F5') action = 'reload';
  else if (input.alt && !ctrl && key === 'ArrowLeft') action = 'back';
  else if (input.alt && !ctrl && key === 'ArrowRight') action = 'forward';
  else if (DEV && key === 'F12') {
    win?.webContents.toggleDevTools();
    event.preventDefault();
    return;
  }
  if (!action) return;
  event.preventDefault();
  send('social:shortcut', action);
}

/**
 * "Save … to Storeroom" for whatever was right-clicked in a social page: the
 * image (the full-size original where Pinterest and X have one), a video with
 * a real address, the link, the selected text, or the page as it looks now.
 * Downloads go through the app's own session, so signed-in media comes too.
 */
function storeroomItems(contents: WebContents, params: ContextMenuParams): Electron.MenuItemConstructorOptions[] {
  const service = storeroom;
  if (!service || params.isEditable) return [];
  const via = `social:${sessionApps.get(contents.session)?.id ?? 'web'}`;
  const page = contents.getURL();
  const title = contents.getTitle();
  const origin = { page, title, via };
  const web = (u: string) => /^https?:\/\//i.test(u);
  const run = (job: () => unknown) => {
    Promise.resolve()
      .then(job)
      .catch((e) => broadcast('storeroom:failed', { message: e instanceof Error ? e.message : String(e) }));
  };
  const out: Electron.MenuItemConstructorOptions[] = [];
  if (params.mediaType === 'image' && web(params.srcURL)) {
    out.push({ label: 'Save image to Storeroom', click: () => run(() => service.saveRemoteMedia(contents.session, params.srcURL, origin)) });
  }
  if (params.mediaType === 'video' && web(params.srcURL)) {
    out.push({ label: 'Save video to Storeroom', click: () => run(() => service.saveRemoteMedia(contents.session, params.srcURL, origin)) });
  }
  if (params.linkURL && web(params.linkURL)) out.push({ label: 'Save link to Storeroom', click: () => run(() => service.saveLink(params.linkURL, via)) });
  if (params.selectionText.trim()) out.push({ label: 'Save selection to Storeroom', click: () => run(() => service.saveText(params.selectionText, origin)) });
  out.push({
    label: 'Save this view to Storeroom',
    click: () =>
      run(async () => {
        const image = await contents.capturePage();
        if (image.isEmpty()) throw new Error('Nothing on screen to save yet');
        return service.saveScreenshot(image, origin);
      }),
  });
  return out;
}

function contextMenu(contents: WebContents, params: ContextMenuParams) {
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (params.linkURL) {
    items.push({ label: 'Open link in browser', click: () => openOutside(params.linkURL) });
    items.push({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) });
    items.push({ type: 'separator' });
  }
  if (params.mediaType === 'image' && params.srcURL) {
    items.push({ label: 'Copy image', click: () => contents.copyImageAt(params.x, params.y) });
    items.push({ label: 'Save image…', click: () => contents.downloadURL(params.srcURL) });
    items.push({ type: 'separator' });
  }
  const keep = storeroomItems(contents, params);
  if (keep.length) items.push(...keep, { type: 'separator' });
  if (params.isEditable) {
    items.push({ role: 'cut', enabled: params.editFlags.canCut });
    items.push({ role: 'copy', enabled: params.editFlags.canCopy });
    items.push({ role: 'paste', enabled: params.editFlags.canPaste });
    items.push({ role: 'selectAll' });
  } else if (params.selectionText) {
    items.push({ role: 'copy' });
  }
  if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
  items.push({ label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
  items.push({ label: 'Reload', click: () => contents.reload() });
  // In the window the page is in: Social's, or the Storeroom's own beside it.
  const owner = BrowserWindow.fromWebContents(contents.hostWebContents ?? contents) ?? win ?? undefined;
  Menu.buildFromTemplate(items).popup({ window: owner });
}

/**
 * A <webview> only ever gets a known site, its own session, and our preload.
 * Every Axonix window that can show social pages (Social, and the Storeroom's
 * side pane in its own window) is held to this.
 */
function guardHostWebviews(host: WebContents) {
  host.on('will-attach-webview', (event, prefs, params) => {
    const target = SOCIAL_APPS.find((a) => partitionOf(a.id) === params.partition);
    if (!target || classify(target, params.src) !== 'inside') {
      event.preventDefault();
      return;
    }
    delete (prefs as Record<string, unknown>).preloadURL;
    prefs.preload = path.join(__dirname, 'preload-guest.js');
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    prefs.spellcheck = false;
  });
}

/**
 * Social pages freeze when no window shows them (background.ts). With the
 * Storeroom's own window able to show a page too, "shown" is any Axonix window
 * on screen, and the apps on screen are every window's together.
 */
const shownByHost = new Map<number, SocialAppId[]>();

function refreshShownApps() {
  setShownApps([...new Set([...shownByHost.values()].flat())]);
}

function refreshWindowShown() {
  const onScreen = (w: BrowserWindow | null) => Boolean(w && !w.isDestroyed() && w.isVisible() && !w.isMinimized());
  setWindowShown(onScreen(win) || onScreen(storeWin));
}

function guardGuest(contents: WebContents, target: SocialApp) {
  contents.setWindowOpenHandler(({ url }) => {
    const where = classify(target, url);
    if (where === 'auth') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, backgroundColor: '#ffffff', title: `${target.name} sign-in` },
      };
    }
    if (where === 'inside') void contents.loadURL(url);
    if (where === 'outside') openOutside(url);
    return { action: 'deny' };
  });

  const onNavigate = (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
    if (!event.isMainFrame) return;
    const where = classify(target, event.url);
    if (where === 'inside' || where === 'auth') return;
    event.preventDefault();
    if (where === 'outside') openOutside(event.url);
  };
  contents.on('will-navigate', onNavigate);
  contents.on('will-redirect', onNavigate);
  contents.on('before-input-event', shortcut);
  contents.on('context-menu', (_e, params) => contextMenu(contents, params));

  // Chromium already resolves Windows precision-touchpad contact into a real
  // begin/update/end lifecycle. Forward that lifecycle to the guest preload;
  // DOM WheelEvent deliberately omits it, which made a stationary hold look
  // identical to released fingers when the renderer guessed with a timeout.
  if (contents.getType() === 'webview') {
    contents.on('input-event', (_event, input) => {
      if (input.type === 'gestureScrollBegin') contents.send('axonix:gesture-scroll-phase', 'begin');
      if (input.type === 'gestureScrollEnd' || input.type === 'gestureFlingStart') {
        contents.send('axonix:gesture-scroll-phase', 'end');
      }
    });
  }
}

function visibleBounds(bounds: Rectangle | undefined): Rectangle | undefined {
  if (!bounds) return undefined;
  const area = screen.getDisplayMatching(bounds).workArea;
  const overlaps = bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + 40 > area.y;
  return overlaps ? bounds : undefined;
}

function createWindow() {
  const bounds = visibleBounds(state.bounds);
  win = new BrowserWindow({
    ...(bounds ?? { width: 1320, height: 860 }),
    minWidth: 900,
    minHeight: 600,
    title: 'Axonix',
    backgroundColor: '#06070a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#dde3ee', height: 38 },
    show: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-host.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
    },
  });

  const host = win.webContents;
  const hostId = host.id;
  host.setWindowOpenHandler(() => ({ action: 'deny' }));
  host.on('will-navigate', (e) => {
    if (!DEV_URL || !e.url.startsWith(DEV_URL)) e.preventDefault();
  });
  host.on('before-input-event', shortcut);
  guardHostWebviews(host);

  win.on('app-command', (_e, command) => {
    if (command === 'browser-backward') send('social:shortcut', 'back');
    if (command === 'browser-forward') send('social:shortcut', 'forward');
  });

  win.once('ready-to-show', () => {
    if (state.maximized) win?.maximize();
    win?.show();
  });

  // A finance change is written 250ms after it is made, so closing inside that
  // window would drop it. The first close asks the page to write whatever is
  // pending (preload-host `onClosing`, at most 3s), then closes for real.
  let closing: 'open' | 'flushing' | 'flushed' = 'open';
  win.on('close', (event) => {
    if (!win) return;
    if (closing !== 'flushed') {
      event.preventDefault();
      if (closing === 'flushing') return;
      closing = 'flushing';
      const w = win;
      const done = () => {
        clearTimeout(timer);
        ipcMain.removeListener('app:close-ready', onReady);
        closing = 'flushed';
        if (!w.isDestroyed()) w.close();
      };
      const onReady = (e: IpcMainEvent) => {
        if (e.sender === w.webContents) done();
      };
      const timer = setTimeout(done, 3000);
      ipcMain.on('app:close-ready', onReady);
      w.webContents.send('app:closing');
      return;
    }
    state.bounds = win.getNormalBounds();
    state.maximized = win.isMaximized();
    writeState();
  });
  // Windows is shutting down or signing out and may not wait for a clean quit.
  win.on('session-end', () => {
    writeState();
    void flushAllSessions(1500);
  });
  win.on('closed', () => {
    win = null;
    shownByHost.delete(hostId);
    refreshShownApps();
    refreshWindowShown();
  });
  // Minimised, nothing is on screen: background apps may freeze (background.ts).
  for (const change of ['minimize', 'hide', 'restore', 'show'] as const) win.on(change as 'show', refreshWindowShown);

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }
}

/**
 * The Storeroom on its own: the same page with `#storeroom`, which mounts only
 * the Storeroom (never Finance, so this window cannot read or write money
 * data). It has its own taskbar button; pinned, that opens straight into it.
 */
function openStoreroomWindow() {
  if (storeWin && !storeWin.isDestroyed()) {
    if (storeWin.isMinimized()) storeWin.restore();
    storeWin.show();
    storeWin.focus();
    return;
  }
  const bounds = visibleBounds(state.storeroomBounds);
  const w = new BrowserWindow({
    ...(bounds ?? { width: 1280, height: 860 }),
    minWidth: 760,
    minHeight: 520,
    title: 'Storeroom',
    backgroundColor: '#06070a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#dde3ee', height: 38 },
    show: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-host.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      // Social beside the Storeroom: the same guarded pages as Social's own.
      webviewTag: true,
      spellcheck: false,
    },
  });
  storeWin = w;
  const storeHostId = w.webContents.id;
  if (app.isPackaged) {
    w.setAppDetails({
      appId: 'com.axonix.storeroom',
      appIconPath: process.execPath,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}" --storeroom`,
      relaunchDisplayName: 'Storeroom',
    });
  }
  const contents = w.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => {
    if (!DEV_URL || !e.url.startsWith(DEV_URL)) e.preventDefault();
  });
  guardHostWebviews(contents);
  contents.on('before-input-event', (event, input) => {
    if (DEV && input.type === 'keyDown' && input.key === 'F12') {
      contents.toggleDevTools();
      event.preventDefault();
    }
  });
  w.once('ready-to-show', () => {
    if (state.storeroomMaximized) w.maximize();
    w.show();
  });
  w.on('close', () => {
    state.storeroomBounds = w.getNormalBounds();
    state.storeroomMaximized = w.isMaximized();
    writeState();
  });
  w.on('closed', () => {
    if (storeWin === w) storeWin = null;
    shownByHost.delete(storeHostId);
    refreshShownApps();
    refreshWindowShown();
  });
  for (const change of ['minimize', 'hide', 'restore', 'show'] as const) w.on(change as 'show', refreshWindowShown);
  if (DEV_URL) void w.loadURL(`${DEV_URL}#storeroom`);
  else void w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { hash: 'storeroom' });
}

// ---------------------------------------------------------------------------
// IPC Registration

const isHost = (sender: WebContents) => Boolean(win && sender === win.webContents);
/** The Storeroom answers the main window and its own. */
const isStoreroomHost = (sender: WebContents) => isHost(sender) || Boolean(storeWin && !storeWin.isDestroyed() && sender === storeWin.webContents);

function guestOf(event: IpcMainEvent): SocialApp | undefined {
  const sender = event.sender;
  if (event.senderFrame !== sender.mainFrame) return undefined;
  return sessionApps.get(sender.session);
}

function onLoginPage(target: SocialApp, contents: WebContents): boolean {
  try {
    return target.loginHosts.includes(new URL(contents.getURL()).hostname);
  } catch {
    return false;
  }
}

function ownGuest(target: SocialApp, id: unknown): WebContents | undefined {
  if (typeof id !== 'number') return undefined;
  const guest = webContents.fromId(id);
  if (!guest || guest.getType() !== 'webview' || guest.hostWebContents !== win?.webContents) return undefined;
  return sessionApps.get(guest.session) === target ? guest : undefined;
}

const pending = new Map<string, { app: SocialAppId; login: Login; expires: number }>();

function focusField(guest: WebContents, field: 'user' | 'pass'): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      ipcMain.removeListener('guest:focused', onFocused);
      resolve(ok);
    };
    const onFocused = (event: IpcMainEvent, which: unknown, ok: unknown) => {
      if (event.sender === guest && event.senderFrame === guest.mainFrame && which === field) done(ok === true);
    };
    const timer = setTimeout(() => done(false), 1000);
    ipcMain.on('guest:focused', onFocused);
    guest.send('axonix:focus', field);
  });
}

function registerIpc() {
  // --- Finance data & settings handlers -----------------------------------

  ipcMain.handle('finance:read', () => {
    if (!startupBackupDone) {
      startupBackupDone = true;
      snapshotFinanceData('startup');
    }
    try {
      fs.appendFileSync(path.join(financeLogsDir, 'axonix-app.log'), 'INFO axonix_app: read_finance_data requested\n');
    } catch {}
    // No file yet (a first run) is null: the page starts empty. A file that
    // can't be read rejects, so the page refuses to save over it.
    if (!fs.existsSync(financeDataPath)) return null;
    try {
      return fs.readFileSync(financeDataPath, 'utf8');
    } catch (e) {
      throw new Error(`could not read ${financeDataPath}: ${e}`);
    }
  });

  ipcMain.handle('finance:write', (_event, json: unknown) => {
    if (typeof json !== 'string') throw new Error('json must be a string');
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error(`refusing to save invalid JSON: ${e}`);
    }
    const isDoc = typeof parsed?.version === 'number' && Array.isArray(parsed?.accounts) && Array.isArray(parsed?.transactions);
    if (!isDoc) throw new Error('refusing to save: payload is not a finance document');

    fs.mkdirSync(financeDir, { recursive: true });
    const tmp = `${financeDataPath}.tmp`;
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, financeDataPath);
    return true;
  });

  ipcMain.handle('finance:backup', (_event, reason: unknown) => {
    const res = snapshotFinanceData(typeof reason === 'string' ? reason : 'manual');
    return res ?? '';
  });

  ipcMain.handle('finance:statement-password', (_event, bank: unknown) => {
    if (typeof bank !== 'string') return null;
    try {
      return statementPasswordEntry(bank).getPassword() ?? null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('finance:remember-statement-password', (_event, bank: unknown, password: unknown) => {
    if (typeof bank !== 'string' || typeof password !== 'string' || !password || password.length > 128) return false;
    try {
      statementPasswordEntry(bank).setPassword(password);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('finance:forget-statement-password', (_event, bank: unknown) => {
    if (typeof bank !== 'string') return false;
    try {
      statementPasswordEntry(bank).deleteCredential();
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('finance:ibja-rates', async () => {
    const res = await fetch('https://ibjarates.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Axonix' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`IBJA answered ${res.status}`);
    return await res.text();
  });

  // Links from Finance (a bank's site) open in the default browser, https only.
  ipcMain.on('finance:open-external', (event, url: unknown) => {
    if (isHost(event.sender) && typeof url === 'string' && url.startsWith('https://')) openOutside(url);
  });

  // "Show in folder" for a backup or an export, and nothing outside those two places.
  ipcMain.handle('finance:show-in-folder', (event, file: unknown) => {
    if (!isHost(event.sender) || typeof file !== 'string') return false;
    const target = path.resolve(file);
    const within = (dir: string) => target.toLowerCase().startsWith(`${path.resolve(dir).toLowerCase()}${path.sep}`);
    const downloads = path.join(process.env.USERPROFILE ?? '.', 'Downloads');
    if (!(within(financeDir) || within(downloads)) || !fs.existsSync(target)) return false;
    shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle('finance:export', (_event, fileName: unknown, contents: unknown) => {
    if (typeof fileName !== 'string' || typeof contents !== 'string') throw new Error('invalid arguments');
    const valid = fileName.length > 0 && fileName.length <= 100 &&
      /^[a-zA-Z0-9-_.]+$/.test(fileName) && !fileName.startsWith('.') &&
      (fileName.endsWith('.json') || fileName.endsWith('.csv'));
    if (!valid) throw new Error('unexpected export file name');

    const downloads = path.join(process.env.USERPROFILE ?? '.', 'Downloads');
    fs.mkdirSync(downloads, { recursive: true });
    const parsed = path.parse(fileName);
    let dest = path.join(downloads, fileName);
    let n = 2;
    while (fs.existsSync(dest)) {
      dest = path.join(downloads, `${parsed.name}-${n}${parsed.ext}`);
      n++;
    }
    fs.writeFileSync(dest, contents, 'utf8');
    return dest;
  });

  // --- Tasks: markdown files in the vault (electron/tasks.ts) ---------------

  registerTasks({ vault: VAULT, backupsDir: financeBackupsDir, isHost, send });

  // --- Notes: any markdown file in the vault (electron/vault.ts) ------------

  registerVault({ vault: VAULT, isHost, send });

  // --- Google Calendar (electron/gcal.ts) ----------------------------------

  registerCalendar({ dataDir: financeDir, dev: DEV, isHost });
  registerResearch();

  // --- The assistant: Sign in with ChatGPT, requests on the owner's plan (electron/chatgpt.ts) ---

  registerAssistant({
    dataDir: financeDir,
    dev: DEV,
    isHost,
    send,
    log: (line) => {
      try {
        fs.appendFileSync(path.join(financeLogsDir, 'axonix-app.log'), `INFO axonix_app: ${line}
`);
      } catch {
        /* the log is a convenience */
      }
    },
  });

  // --- Workspace: links between things, and the Pocket ----------------------
  // A file of its own beside the finance file, so nothing about the finance
  // file or a task's or note's format changes. Written whole, atomically.

  const workspacePath = path.join(financeDir, 'workspace.json');
  ipcMain.handle('workspace:read', (event) => {
    if (!isHost(event.sender)) throw new Error('not allowed');
    if (!fs.existsSync(workspacePath)) return null;
    try {
      return fs.readFileSync(workspacePath, 'utf8');
    } catch (e) {
      throw new Error(`could not read ${workspacePath}: ${e}`);
    }
  });
  ipcMain.handle('workspace:write', (event, json: unknown) => {
    if (!isHost(event.sender)) throw new Error('not allowed');
    if (typeof json !== 'string' || Buffer.byteLength(json) > 4 * 1024 * 1024) throw new Error('invalid workspace');
    let parsed: { version?: unknown; links?: unknown; pocket?: unknown };
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error(`refusing to save invalid JSON: ${e}`);
    }
    if (typeof parsed?.version !== 'number' || !Array.isArray(parsed.links) || !Array.isArray(parsed.pocket)) throw new Error('refusing to save: payload is not a workspace');
    fs.mkdirSync(financeDir, { recursive: true });
    const tmp = `${workspacePath}.tmp`;
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, workspacePath);
    return true;
  });

  // --- Storeroom: the inspiration library (electron/storeroom.ts) -----------

  storeroom = registerStoreroom({ root: STOREROOM, isHost: isStoreroomHost, broadcast, openWindow: openStoreroomWindow });

  // --- The door: outside agents, through the page's own tools (electron/door.ts) ---
  // Only the main window answers it: the Storeroom's own window holds no tools.

  const hostPage = () => (win && !win.isDestroyed() ? win.webContents : null);
  const door = registerDoor({ dataDir: financeDir, logsDir: financeLogsDir, dev: DEV, version: app.getVersion(), isHost, host: hostPage, mainTools: PAPERCLIP_TOOLS });
  registerPaperclip({ isHost, logsDir: financeLogsDir });
  const terminal = registerTerminal({ isHost, host: hostPage, chatPanelOn: door.chatPanelOn });
  app.on('will-quit', () => {
    door.close();
    terminal.close();
  });

  // --- Social module handlers ---------------------------------------------

  // Social starts empty every time; only a shortcut's `--app=` opens one.
  ipcMain.handle('social:state', (event: IpcMainInvokeEvent) =>
    isHost(event.sender) ? { openApp: argApp(process.argv)?.id ?? null, dev: DEV, splitRatio: state.splitRatio ?? null } : null,
  );

  ipcMain.on('social:split-ratio', (event, ratio: unknown) => {
    if (!isHost(event.sender) || typeof ratio !== 'number' || ratio < 0.2 || ratio > 0.8) return;
    state.splitRatio = ratio;
    writeStateSoon();
  });

  // Which apps are on screen, so the others can freeze (background.ts). Social
  // says so for its window, the Storeroom's side pane for its own.
  ipcMain.on('social:shown', (event, ids: unknown) => {
    if (!isStoreroomHost(event.sender) || !Array.isArray(ids)) return;
    shownByHost.set(
      event.sender.id,
      ids.map((id) => appById(typeof id === 'string' ? id : null)?.id).filter((id): id is SocialAppId => Boolean(id)),
    );
    refreshShownApps();
  });

  // Free memory, in MB: the dock sleeps background apps sooner when it is low.
  ipcMain.handle('social:free-memory', (event) => (isHost(event.sender) ? Math.round(process.getSystemMemoryInfo().free / 1024) : null));

  ipcMain.handle('social:capture', async (event, id: unknown, appId: unknown) => {
    const target = appById(typeof appId === 'string' ? appId : null);
    const guest = target && isHost(event.sender) ? ownGuest(target, id) : undefined;
    // A frozen page draws nothing new; the picture taken when it left stands.
    if (!guest || isFrozen(guest)) return null;
    const image = await guest.capturePage();
    if (image.isEmpty()) return null;
    const { width } = image.getSize();
    return `data:image/jpeg;base64,${image.resize({ width: Math.min(width, 960), quality: 'good' }).toJPEG(78).toString('base64')}`;
  });

  ipcMain.on('social:badge-total', (event, dataUrl: unknown, count: unknown) => {
    if (!isHost(event.sender) || !win) return;
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,') && typeof count === 'number' && count > 0) {
      win.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `${count} unread`);
    } else {
      win.setOverlayIcon(null, '');
    }
  });

  ipcMain.on('social:open-axonix', () => {
    send('social:shortcut', 'home');
  });

  ipcMain.on('guest:login-form', (event, present: unknown) => {
    const target = guestOf(event);
    if (!target) return;
    const login = present === true && onLoginPage(target, event.sender) ? readLogin(target.id) : null;
    send('social:login-form', { app: target.id, webContentsId: event.sender.id, present: present === true, username: login?.username ?? null });
  });

  ipcMain.on('guest:credential', (event, payload: unknown) => {
    const target = guestOf(event);
    if (!target || !onLoginPage(target, event.sender) || state.neverSave?.includes(target.id)) return;
    const { username, password } = (payload ?? {}) as Partial<Login>;
    if (typeof username !== 'string' || typeof password !== 'string') return;
    const user = username.trim();
    if (!user || !password || user.length > 256 || password.length > 512) return;
    const saved = readLogin(target.id);
    if (saved && saved.username === user && saved.password === password) return;
    for (const [token, p] of pending) if (p.app === target.id) pending.delete(token);
    const token = randomUUID();
    pending.set(token, { app: target.id, login: { username: user, password }, expires: Date.now() + 10 * 60_000 });
    send('social:save-prompt', { token, app: target.id, username: user, replaces: saved ? saved.username : null });
  });

  ipcMain.handle('passwords:decide', (event, token: unknown, decision: unknown) => {
    if (!isHost(event.sender) || typeof token !== 'string') return false;
    const entry = pending.get(token);
    pending.delete(token);
    if (!entry || entry.expires < Date.now()) return false;
    if (decision === 'never') {
      state.neverSave = [...new Set([...(state.neverSave ?? []), entry.app])];
      writeStateSoon();
      return true;
    }
    if (decision !== 'save') return false;
    saveLogin(entry.app, entry.login);
    return true;
  });

  ipcMain.handle('passwords:list', (event) => (isHost(event.sender) ? { saved: listLogins(), never: state.neverSave ?? [] } : null));

  ipcMain.handle('passwords:remove', (event, appId: unknown) => {
    const target = appById(typeof appId === 'string' ? appId : null);
    if (!isHost(event.sender) || !target) return false;
    removeLogin(target.id);
    return true;
  });

  ipcMain.handle('passwords:allow', (event, appId: unknown) => {
    const target = appById(typeof appId === 'string' ? appId : null);
    if (!isHost(event.sender) || !target) return false;
    state.neverSave = (state.neverSave ?? []).filter((id) => id !== target.id);
    writeStateSoon();
    return true;
  });

  ipcMain.handle('passwords:fill', async (event, appId: unknown, id: unknown) => {
    const target = appById(typeof appId === 'string' ? appId : null);
    const guest = target && isHost(event.sender) ? ownGuest(target, id) : undefined;
    if (!target || !guest || !onLoginPage(target, guest)) return false;
    const login = readLogin(target.id);
    if (!login) return false;
    guest.focus();
    let filled = false;
    if (await focusField(guest, 'user')) {
      await guest.insertText(login.username);
      filled = true;
    }
    if (onLoginPage(target, guest) && (await focusField(guest, 'pass'))) {
      await guest.insertText(login.password);
      filled = true;
    }
    return filled;
  });
}

// ---------------------------------------------------------------------------
// App Lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--storeroom')) {
      openStoreroomWindow();
      return;
    }
    // Only the Storeroom was open: Axonix itself opens now.
    if (!win) {
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    const target = argApp(argv);
    if (target) send('social:shortcut', `open:${target.id}`);
  });

  app.on('web-contents-created', (_e, contents) => {
    const target = sessionApps.get(contents.session);
    if (!target) return;
    guardGuest(contents, target);
    // The app's own page (not a sign-in popup on the same session).
    if (contents.getType() === 'webview') adopt(contents, target.id);
  });

  app.whenReady().then(() => {
    // Started from inside another app's sandbox (a Claude terminal, for one),
    // this process sees a stale private copy of the data folder. Opening it made
    // the owner's accounts look deleted on 2026-09-13; the Tauri shell refused
    // to start there, and so does this one. `--sandbox-check` above is how the
    // rebuild script asks the same question without opening a window.
    if (isSandboxed() && !process.env.AXONIX_ALLOW_SANDBOX) {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Axonix',
        message: "Axonix was started from inside another app's sandbox.",
        detail:
          'From there it cannot see your real data and would open an old private copy instead, so it will close now. ' +
          'Your data has not been touched.\n\nOpen Axonix from its shortcut or the Start menu.',
      });
      app.quit();
      return;
    }
    initLogging();
    ensureCaptureServer();
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    prepareSessions();
    registerIpc();
    // The Storeroom's pinned taskbar button starts Axonix with `--storeroom`.
    if (process.argv.includes('--storeroom')) openStoreroomWindow();
    else createWindow();
  });

  // Sign-ins reach disk before the process goes: the first quit waits (at most
  // 2.5s) for every app's cookies and storage to flush, then quits for real.
  let flushedForQuit = false;
  app.on('before-quit', (event) => {
    if (!flushedForQuit) {
      event.preventDefault();
      flushedForQuit = true;
      void flushAllSessions().finally(() => app.quit());
      return;
    }
    if (captureChild) {
      try { captureChild.kill(); } catch {}
    }
  });

  app.on('window-all-closed', () => app.quit());
}
