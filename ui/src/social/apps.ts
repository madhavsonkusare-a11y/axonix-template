/**
 * Axonix Social — the six apps, and where each one is allowed to go.
 *
 * Shared by the Electron main process (which enforces it) and the dock (which
 * draws it). The main process is the authority: a page can only ever load a
 * `home` below, navigate inside its own `hosts`, open sign-in popups on
 * `AUTH_HOSTS`, and have a saved password filled on its `loginHosts`.
 * Everything else opens in the default browser.
 */

export type SocialAppId = 'instagram' | 'x' | 'threads' | 'reddit' | 'linkedin' | 'pinterest';

export interface SocialApp {
  id: SocialAppId;
  name: string;
  /** Where the app opens, and where "Back to feed" returns. */
  home: string;
  /** Hosts (and their subdomains) the page may navigate to in place. */
  hosts: string[];
  /** Hosts whose pages may receive this app's saved password. */
  loginHosts: string[];
}

export const SOCIAL_APPS: SocialApp[] = [
  {
    id: 'instagram',
    name: 'Instagram',
    home: 'https://www.instagram.com/',
    hosts: ['instagram.com', 'cdninstagram.com', 'facebook.com', 'fbcdn.net'],
    loginHosts: ['www.instagram.com', 'instagram.com'],
  },
  {
    id: 'x',
    name: 'X',
    home: 'https://x.com/home',
    hosts: ['x.com', 'twitter.com', 'twimg.com'],
    loginHosts: ['x.com', 'twitter.com'],
  },
  {
    id: 'threads',
    name: 'Threads',
    home: 'https://www.threads.com/',
    hosts: ['threads.com', 'threads.net', 'instagram.com', 'cdninstagram.com', 'facebook.com', 'fbcdn.net'],
    loginHosts: ['www.threads.com', 'threads.com', 'www.threads.net', 'threads.net'],
  },
  {
    id: 'reddit',
    name: 'Reddit',
    home: 'https://www.reddit.com/',
    hosts: ['reddit.com', 'redditmedia.com', 'redditstatic.com', 'redd.it'],
    loginHosts: ['www.reddit.com', 'reddit.com', 'accounts.reddit.com'],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    home: 'https://www.linkedin.com/feed/',
    hosts: ['linkedin.com', 'licdn.com'],
    loginHosts: ['www.linkedin.com', 'linkedin.com'],
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    home: 'https://www.pinterest.com/',
    hosts: ['pinterest.com', 'pinterest.co.uk', 'pinimg.com'],
    loginHosts: ['www.pinterest.com', 'pinterest.com', 'in.pinterest.com'],
  },
];

/** Sign-in providers the apps offer. They may open as a popup, never as a destination. */
export const AUTH_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'www.facebook.com', 'm.facebook.com'];

/** Link shims that bounce to other sites. Always handed to the default browser. */
export const OUTBOUND_SHIMS = ['l.instagram.com', 'l.facebook.com', 'l.threads.com', 'l.threads.net', 't.co', 'lnkd.in', 'out.reddit.com'];

export const partitionOf = (id: SocialAppId) => `persist:social-${id}`;

export const appById = (id: string | null | undefined): SocialApp | undefined => SOCIAL_APPS.find((a) => a.id === id);

/** `true` when `host` is `domain` or one of its subdomains. */
export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export type Destination = 'inside' | 'auth' | 'outside' | 'refuse';

/** Where a top-level navigation or popup for `app` should go. */
export function classify(app: SocialApp, rawUrl: string): Destination {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'refuse';
  }
  if (url.protocol === 'mailto:') return 'outside';
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return url.href === 'about:blank' ? 'inside' : 'refuse';
  const host = url.hostname.toLowerCase();
  if (OUTBOUND_SHIMS.includes(host)) return 'outside';
  if (app.hosts.some((d) => hostMatches(host, d))) return 'inside';
  if (AUTH_HOSTS.includes(host)) return 'auth';
  return 'outside';
}
