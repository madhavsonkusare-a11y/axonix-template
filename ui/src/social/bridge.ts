/**
 * The dock's view of the main process (`electron/preload-host.ts`).
 *
 * `bridge` is null in a plain browser (the Vite dev server without Electron),
 * where the dock still renders — with stand-in pages — so its design and motion
 * can be iterated on without launching the app.
 */
import type { SocialAppId } from './apps';

export interface LoginFormEvent {
  app: SocialAppId;
  webContentsId: number;
  present: boolean;
  /** The saved username, when there is a sign-in to offer. Never the password. */
  username: string | null;
}

export interface SavePrompt {
  token: string;
  app: SocialAppId;
  username: string;
  /** The username already saved for this app, which saving would replace. */
  replaces: string | null;
}

export interface PasswordList {
  saved: { app: SocialAppId; username: string }[];
  never: SocialAppId[];
}

export interface SocialBridge {
  state(): Promise<{
    /** An app named on the command line (a shortcut); Social otherwise starts empty. */
    openApp: SocialAppId | null;
    dev: boolean;
    splitRatio?: number | null;
  } | null>;
  /** Remember where the split divider sits. */
  setSplitRatio?(ratio: number): void;
  /** The apps on screen; the main process freezes the others after a while. */
  setShown?(apps: SocialAppId[]): void;
  /** Free system memory in MB, or null. */
  freeMemory?(): Promise<number | null>;
  capture(webContentsId: number, app: SocialAppId): Promise<string | null>;
  setBadge(pngDataUrl: string | null, count: number): void;
  openAxonix(): void;
  onShortcut(cb: (action: string) => void): () => void;
  onLoginForm(cb: (p: LoginFormEvent) => void): () => void;
  onSavePrompt(cb: (p: SavePrompt) => void): () => void;
  decideSave(token: string, decision: 'save' | 'never' | 'dismiss'): Promise<boolean>;
  fill(app: SocialAppId, webContentsId: number): Promise<boolean>;
  listPasswords(): Promise<PasswordList | null>;
  removePassword(app: SocialAppId): Promise<boolean>;
  allowSaving(app: SocialAppId): Promise<boolean>;
}

export const bridge: SocialBridge | null = (window as unknown as { axonixSocial?: SocialBridge }).axonixSocial ?? null;

/** The subset of Electron's `<webview>` element the dock uses. */
export interface WebviewTag extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getWebContentsId(): number;
  isLoading(): boolean;
  getZoomFactor(): number;
  insertCSS?(css: string): Promise<string>;
  executeJavaScript(code: string): Promise<unknown>;
}
