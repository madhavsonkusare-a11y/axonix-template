/**
 * Remembered bank statement passwords, one per bank.
 *
 * Banks build the password from the owner's details (SBI: the last five digits
 * of the registered mobile number, then the date of birth as DDMMYY), so it is
 * the same on every statement and worth remembering — but never in the finance
 * data file, which is plain JSON. On the desktop it goes to Windows Credential
 * Manager through the desktop app; in the browser dev build it lives only as long
 * as the page, so nothing is written to browser storage.
 */
import { desktop } from './desktop';

const thisPage = new Map<string, string>();

export async function savedStatementPassword(bank: string): Promise<string | undefined> {
  if (desktop) return (await desktop.statementPassword(bank)) ?? undefined;
  return thisPage.get(bank);
}

export async function rememberStatementPassword(bank: string, password: string): Promise<void> {
  if (desktop) await desktop.rememberStatementPassword(bank, password);
  else thisPage.set(bank, password);
}

export async function forgetStatementPassword(bank: string): Promise<void> {
  if (desktop) await desktop.forgetStatementPassword(bank);
  else thisPage.delete(bank);
}
