/**
 * Saved sign-ins for Axonix Social.
 *
 * Electron has no password manager, so this is one. Each app keeps at most one
 * sign-in (its pages share one session), stored in Windows Credential Manager
 * under "<app>.Axonix Social" — encrypted to the Windows user, the same place
 * Axonix keeps bank statement passwords. Never in a file, a log, or the dock's
 * renderer: the renderer only ever sees usernames.
 */
import { Entry } from '@napi-rs/keyring';
import { SOCIAL_APPS, type SocialAppId } from '../src/social/apps';

export interface Login {
  username: string;
  password: string;
}

/** Dev builds keep their own entries so testing never touches real sign-ins. */
const SERVICE = process.env.AXONIX_SOCIAL_DEV ? 'Axonix Social (dev)' : 'Axonix Social';

const entry = (app: SocialAppId) => new Entry(SERVICE, app);

export function readLogin(app: SocialAppId): Login | null {
  try {
    const raw = entry(app).getPassword();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Login>;
    return typeof parsed.username === 'string' && typeof parsed.password === 'string' ? { username: parsed.username, password: parsed.password } : null;
  } catch {
    return null;
  }
}

export function saveLogin(app: SocialAppId, login: Login): void {
  entry(app).setPassword(JSON.stringify({ username: login.username, password: login.password }));
}

export function removeLogin(app: SocialAppId): void {
  try {
    entry(app).deleteCredential();
  } catch {
    // Nothing saved is the state we wanted.
  }
}

/** Usernames only, for the Passwords panel. */
export function listLogins(): { app: SocialAppId; username: string }[] {
  return SOCIAL_APPS.flatMap((a) => {
    const login = readLogin(a.id);
    return login ? [{ app: a.id, username: login.username }] : [];
  });
}
