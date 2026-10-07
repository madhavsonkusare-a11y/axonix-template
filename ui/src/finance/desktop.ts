/**
 * The desktop app's side of Finance (`electron/preload-host.ts`): the data file,
 * backups, exports, remembered statement passwords, gold rates, links and
 * folders. Null in a plain browser (the Vite dev server), where Finance keeps
 * its data in localStorage and nothing touches the owner's file.
 */
export interface FinanceBridge {
  readData(): Promise<string | null>;
  writeData(json: string): Promise<void>;
  backupData(reason: string): Promise<string>;
  exportFile(fileName: string, contents: string): Promise<string>;
  fetchIbjaRates(): Promise<string>;
  statementPassword(bank: string): Promise<string | null>;
  rememberStatementPassword(bank: string, password: string): Promise<void>;
  forgetStatementPassword(bank: string): Promise<void>;
  /** Runs (up to ~3s) before the window closes; returns an unsubscribe. */
  onClosing(handler: () => unknown): () => void;
  /** Opens an https link in the default browser. */
  openExternal(url: string): void;
  /** Shows a backup or an export in Explorer. */
  showInFolder(file: string): Promise<boolean>;
}

export const desktop: FinanceBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { axonixFinance?: FinanceBridge }).axonixFinance ?? null) : null;
