/**
 * The dock's bridge to the main process. Sandboxed and context-isolated: the
 * page gets these functions and nothing else — no Node, no raw ipcRenderer.
 * Nothing here can return a password; sign-ins are filled by the main process
 * straight into the site's page.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

function listen<T>(channel: string, cb: (payload: T) => void) {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('axonixSocial', {
  state: () => ipcRenderer.invoke('social:state'),
  setSplitRatio: (ratio: number) => ipcRenderer.send('social:split-ratio', ratio),
  setShown: (apps: string[]) => ipcRenderer.send('social:shown', apps),
  freeMemory: () => ipcRenderer.invoke('social:free-memory'),
  capture: (webContentsId: number, app: string) => ipcRenderer.invoke('social:capture', webContentsId, app),
  setBadge: (pngDataUrl: string | null, count: number) => ipcRenderer.send('social:badge-total', pngDataUrl, count),
  openAxonix: () => ipcRenderer.send('social:open-axonix'),
  onShortcut: (cb: (action: string) => void) => listen('social:shortcut', cb),
  onLoginForm: (cb: (p: unknown) => void) => listen('social:login-form', cb),
  onSavePrompt: (cb: (p: unknown) => void) => listen('social:save-prompt', cb),
  decideSave: (token: string, decision: 'save' | 'never' | 'dismiss') => ipcRenderer.invoke('passwords:decide', token, decision),
  fill: (app: string, webContentsId: number) => ipcRenderer.invoke('passwords:fill', app, webContentsId),
  listPasswords: () => ipcRenderer.invoke('passwords:list'),
  removePassword: (app: string) => ipcRenderer.invoke('passwords:remove', app),
  allowSaving: (app: string) => ipcRenderer.invoke('passwords:allow', app),
});

// Closing the window: every page-registered handler (Finance writing its
// pending change) gets up to 2.8s before the main process closes it anyway.
const closingHandlers = new Set<() => unknown>();
ipcRenderer.on('app:closing', async () => {
  await Promise.race([Promise.allSettled([...closingHandlers].map((h) => h())), new Promise((r) => setTimeout(r, 2800))]);
  ipcRenderer.send('app:close-ready');
});

contextBridge.exposeInMainWorld('axonixFinance', {
  onClosing: (handler: () => unknown) => {
    closingHandlers.add(handler);
    return () => {
      closingHandlers.delete(handler);
    };
  },
  openExternal: (url: string) => ipcRenderer.send('finance:open-external', url),
  showInFolder: (file: string) => ipcRenderer.invoke('finance:show-in-folder', file),
  readData: () => ipcRenderer.invoke('finance:read'),
  writeData: (json: string) => ipcRenderer.invoke('finance:write', json),
  backupData: (reason: string) => ipcRenderer.invoke('finance:backup', reason),
  exportFile: (fileName: string, contents: string) => ipcRenderer.invoke('finance:export', fileName, contents),
  fetchIbjaRates: () => ipcRenderer.invoke('finance:ibja-rates'),
  statementPassword: (bank: string) => ipcRenderer.invoke('finance:statement-password', bank),
  rememberStatementPassword: (bank: string, password: string) => ipcRenderer.invoke('finance:remember-statement-password', bank, password),
  forgetStatementPassword: (bank: string) => ipcRenderer.invoke('finance:forget-statement-password', bank),
});

// The assistant, through electron/chatgpt.ts. Tokens stay in the main process:
// the page asks for a response and gets text and tool calls back.
contextBridge.exposeInMainWorld('axonixAssistant', {
  status: () => ipcRenderer.invoke('assistant:status'),
  signIn: () => ipcRenderer.invoke('assistant:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('assistant:cancel-sign-in'),
  signOut: () => ipcRenderer.invoke('assistant:sign-out'),
  models: (fresh?: boolean) => ipcRenderer.invoke('assistant:models', fresh === true),
  setModel: (slug: string) => ipcRenderer.invoke('assistant:set-model', slug),
  welcomed: () => ipcRenderer.invoke('assistant:welcomed'),
  selfTest: () => ipcRenderer.invoke('assistant:self-test'),
  openUsage: () => ipcRenderer.invoke('assistant:open-usage'),
  respond: (id: string, request: unknown) => ipcRenderer.invoke('assistant:respond', id, request),
  cancel: (id: string) => ipcRenderer.invoke('assistant:cancel', id),
  onEvent: (cb: (event: unknown) => void) => listen('assistant:event', cb),
});

// Workspace: links between things and the Pocket, in a file of their own.
contextBridge.exposeInMainWorld('axonixWorkspace', {
  read: () => ipcRenderer.invoke('workspace:read'),
  write: (json: string) => ipcRenderer.invoke('workspace:write', json),
});

// Tasks: the vault's Tasks/ folder, through electron/tasks.ts. Paths are relative
// to that folder; the main process refuses anything outside it.
contextBridge.exposeInMainWorld('axonixTasks', {
  list: () => ipcRenderer.invoke('tasks:list'),
  write: (path: string, text: string, expected: string | null) => ipcRenderer.invoke('tasks:write', path, text, expected),
  rename: (from: string, to: string, expected: string) => ipcRenderer.invoke('tasks:rename', from, to, expected),
  trash: (path: string, expected: string) => ipcRenderer.invoke('tasks:trash', path, expected),
  restore: (trashPath: string, to: string) => ipcRenderer.invoke('tasks:restore', trashPath, to),
  mkdir: (folder: string) => ipcRenderer.invoke('tasks:mkdir', folder),
  renameProject: (from: string, to: string) => ipcRenderer.invoke('tasks:rename-project', from, to),
  onChanged: (cb: () => void) => listen('tasks:changed', () => cb()),
  openInObsidian: (path: string) => ipcRenderer.send('tasks:open-in-obsidian', path),
  showInFolder: (path?: string) => ipcRenderer.send('tasks:show-in-folder', path ?? ''),
});

// Notes: any markdown file in the vault, through electron/vault.ts. Paths are
// relative to the vault; dot-folders and Obsidian's excluded paths are refused.
contextBridge.exposeInMainWorld('axonixVault', {
  tree: () => ipcRenderer.invoke('vault:tree'),
  read: (path: string) => ipcRenderer.invoke('vault:read', path),
  write: (path: string, text: string, expected: string | null) => ipcRenderer.invoke('vault:write', path, text, expected),
  readBlocks: (path: string) => ipcRenderer.invoke('vault:blocks-read', path),
  saveDocument: (path: string, text: string, blocks: string | null, expected: string, expectedBlocks: string | null) => ipcRenderer.invoke('vault:document-save', path, text, blocks, expected, expectedBlocks),
  listTrash: () => ipcRenderer.invoke('vault:notes-trash-list'),
  writeBlocks: (path: string, text: string, expected: string | null) => ipcRenderer.invoke('vault:blocks-write', path, text, expected),
  renameBlocks: (from: string, to: string) => ipcRenderer.invoke('vault:blocks-rename', from, to),
  trashBlocks: (path: string) => ipcRenderer.invoke('vault:blocks-trash', path),
  rename: (from: string, to: string, expected: string) => ipcRenderer.invoke('vault:rename', from, to, expected),
  trash: (path: string, expected: string) => ipcRenderer.invoke('vault:trash', path, expected),
  restore: (trashPath: string, to: string) => ipcRenderer.invoke('vault:restore', trashPath, to),
  attach: (note: string, name: string, base64: string) => ipcRenderer.invoke('vault:attach', note, name, base64),
  backlinks: (path: string) => ipcRenderer.invoke('vault:backlinks', path),
  onChanged: (cb: (paths: string[]) => void) => listen<string[]>('vault:changed', cb),
  openInObsidian: (path: string) => ipcRenderer.send('vault:open-in-obsidian', path),
  showInFolder: (path: string) => ipcRenderer.send('vault:show-in-folder', path),
  openUrl: (url: string) => ipcRenderer.send('vault:open-url', url),
});

// The door (electron/door.ts): outside agents call the page's tools through the
// main process. The page never sees a token; it is told who called and answers.
contextBridge.exposeInMainWorld('axonixDoor', {
  ready: (specs: unknown[]) => ipcRenderer.send('door:ready', specs),
  onCall: (cb: (call: unknown) => void) => listen('door:call', cb),
  onUndo: (cb: (call: unknown) => void) => listen('door:undo', cb),
  result: (id: string, result: unknown) => ipcRenderer.send('door:result', id, result),
  onEvent: (cb: (event: unknown) => void) => listen('door:event', cb),
  onChanged: (cb: () => void) => listen('door:changed', () => cb()),
  status: () => ipcRenderer.invoke('door:status'),
  setChatPanel: (on: boolean) => ipcRenderer.invoke('door:set-chat-panel', on),
  calls: (agent: string, from: string, to: string) => ipcRenderer.invoke('door:calls', agent, from, to),
  // Claude in a terminal (electron/terminal.ts): only ever the `claude` program.
  termStart: (cols: number, rows: number) => ipcRenderer.invoke('term:start', cols, rows),
  termInput: (data: string) => ipcRenderer.send('term:input', data),
  termResize: (cols: number, rows: number) => ipcRenderer.send('term:resize', cols, rows),
  termKill: () => ipcRenderer.send('term:kill'),
  onTermData: (cb: (data: string) => void) => listen<string>('term:data', cb),
  onTermExit: (cb: (code: number) => void) => listen<number>('term:exit', cb),
  // The experimental chat panel: refused by the main process unless the owner turned it on.
  chatSend: (text: string) => ipcRenderer.invoke('chat:send', text),
  chatStop: () => ipcRenderer.send('chat:stop'),
  onChatEvent: (cb: (event: unknown) => void) => listen('chat:event', cb),
  // Paperclip's roster, work orders, runs and spend (electron/paperclip.ts).
  agentsOverview: () => ipcRenderer.invoke('agents:overview'),
  agentsStart: () => ipcRenderer.invoke('agents:start'),
  agentsAssign: (issue: string, agent: string) => ipcRenderer.invoke('agents:assign', issue, agent),
  agentsComment: (issue: string, body: string) => ipcRenderer.invoke('agents:comment', issue, body),
});

// Storeroom: the inspiration library, through electron/storeroom.ts. Items are
// named by id (R0042); the main process decides where files go and refuses
// anything outside the Storeroom's own folder.
contextBridge.exposeInMainWorld('axonixStoreroom', {
  list: () => ipcRenderer.invoke('storeroom:list'),
  /** A dropped file's real path, so large media is copied on disk, not through the page. */
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  addFiles: (paths: string[], via: string) => ipcRenderer.invoke('storeroom:add-files', paths, via),
  addBytes: (name: string, data: Uint8Array, via: string) => ipcRenderer.invoke('storeroom:add-bytes', name, data, via),
  addText: (text: string, via: string) => ipcRenderer.invoke('storeroom:add-text', text, via),
  addUrl: (url: string, via: string) => ipcRenderer.invoke('storeroom:add-url', url, via),
  /** A drag out of a social page beside the Storeroom, saved through that app's session. */
  saveSocial: (app: string, drag: unknown) => ipcRenderer.invoke('storeroom:save-social', app, drag),
  update: (id: string, patch: unknown) => ipcRenderer.invoke('storeroom:update', id, patch),
  trash: (id: string) => ipcRenderer.invoke('storeroom:trash', id),
  restore: (trashName: string) => ipcRenderer.invoke('storeroom:restore', trashName),
  recapture: (id: string) => ipcRenderer.invoke('storeroom:recapture', id),
  copyImage: (pngDataUrl: string) => ipcRenderer.invoke('storeroom:copy-image', pngDataUrl),
  showInFolder: (id: string | null) => ipcRenderer.send('storeroom:show-in-folder', id),
  openUrl: (url: string) => ipcRenderer.send('storeroom:open-url', url),
  startDrag: (id: string) => ipcRenderer.send('storeroom:start-drag', id),
  openWindow: () => ipcRenderer.send('storeroom:open-window'),
  onChanged: (cb: () => void) => listen('storeroom:changed', () => cb()),
  onSaved: (cb: (p: unknown) => void) => listen('storeroom:saved', cb),
  onFailed: (cb: (p: unknown) => void) => listen('storeroom:failed', cb),
});

// Google Calendar, through electron/gcal.ts. Tokens and the client secret stay in
// the main process and Windows Credential Manager; the page sees events only.
/**
 * Research: the only path to the internet, and it is a narrow one — the main
 * process holds the allowlist, the cache and the keys (see electron/research.ts).
 */
contextBridge.exposeInMainWorld('axonixResearch', {
  openalex: (kind: string, params: Record<string, string>) => ipcRenderer.invoke('research:openalex', kind, params),
  scorecard: (params: Record<string, string>) => ipcRenderer.invoke('research:scorecard', params),
  ror: (query: string) => ipcRenderer.invoke('research:ror', query),
  universities: (query: string, country?: string) => ipcRenderer.invoke('research:universities', query, country),
  rates: (base: string) => ipcRenderer.invoke('research:rates', base),
  page: (url: string) => ipcRenderer.invoke('research:page', url),
  keys: () => ipcRenderer.invoke('research:keys'),
  setKey: (name: string, value: string) => ipcRenderer.invoke('research:setKey', name, value),
  cache: (action?: 'clear') => ipcRenderer.invoke('research:cache', action),
});

contextBridge.exposeInMainWorld('axonixCalendar', {
  status: () => ipcRenderer.invoke('gcal:status'),
  setClient: (id: string, secret: string) => ipcRenderer.invoke('gcal:set-client', id, secret),
  connect: () => ipcRenderer.invoke('gcal:connect'),
  disconnect: (forgetClient: boolean) => ipcRenderer.invoke('gcal:disconnect', forgetClient),
  calendars: () => ipcRenderer.invoke('gcal:calendars'),
  setShown: (ids: string[]) => ipcRenderer.invoke('gcal:set-shown', ids),
  events: (fromDay: string, toDay: string) => ipcRenderer.invoke('gcal:events', fromDay, toDay),
  syncBlocks: (blocks: unknown[], keep: string[]) => ipcRenderer.invoke('gcal:sync-blocks', blocks, keep),
});
