import { desktop } from './desktop';

/**
 * Open a URL in the system browser.
 *
 * Inside the desktop app a link cannot simply navigate — that would replace
 * Axonix in its own window, which refuses new windows — so the main process
 * opens it. In a plain browser (dev server) it opens a new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) throw new Error(`Refusing to open a non-https link: ${url}`);
  if (desktop) {
    desktop.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** `https://www.onlinesbi.sbi/…` → `onlinesbi.sbi`, for showing where a link goes. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
