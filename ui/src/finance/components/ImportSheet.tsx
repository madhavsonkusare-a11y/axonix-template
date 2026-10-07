/**
 * Import a bank statement (CSV or PDF).
 *
 * Nothing is written until the owner has seen the parser's reading: format
 * detected, rows found, which are duplicates, what each would be filed under,
 * and whether the rows add up to the balances the statement prints.
 * Everything imported lands `autoCategorized` — the review queue in
 * Transactions — because a keyword table guessed the category, not a person.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, FileUp, Lock, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import Sheet, { Field, SheetFooter, useUnsavedChanges } from './Sheet';
import { BrandMark } from './BrandMark';
import { PopUpButton } from './Menu';
import { newId, useFinance } from '../FinanceContext';
import type { Account, FinanceData, Transaction } from '../types';
import { parseCsv, type CsvParseResult } from '../csv';
import { LockedPdfError, pdfText, statementFromPdf } from '../pdf';
import { readNarration } from '../narration';
import { forgetStatementPassword, rememberStatementPassword, savedStatementPassword } from '../statementPasswords';
import { categorize } from '../parse';
import { accountById, learnedCategory } from '../ledger';
import { moneyIn, shortDate } from '../format';

const key = (date: string, amount: number, text: string) =>
  `${date}|${amount.toFixed(2)}|${text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)}`;

function plan(result: CsvParseResult, data: FinanceData, accountId: string) {
  const existing = data.transactions.filter((t) => t.accountId === accountId);
  // Earlier imports stored the raw narration as the merchant; newer ones keep it as the note.
  const known = new Set(existing.flatMap((t) => [key(t.date, t.amount, t.merchant), ...(t.note ? [key(t.date, t.amount, t.note)] : [])]));
  // A UPI reference identifies one payment exactly, so two genuine ₹20 teas on
  // the same day are not mistaken for one imported twice.
  const refs = new Set(existing.flatMap((t) => t.note?.match(/\b\d{12}\b/g) ?? []));
  const inFile = new Set<string>();
  const names = data.categories.map((c) => c.name);
  return result.rows.map((r) => {
    const { merchant, ref } = readNarration(r.description);
    const byText = known.has(key(r.date, r.amount, merchant)) || known.has(key(r.date, r.amount, r.description));
    const duplicate = ref ? refs.has(ref) || byText : byText || inFile.has(key(r.date, r.amount, r.description));
    if (ref) refs.add(ref);
    else inFile.add(key(r.date, r.amount, r.description));
    const income = r.amount > 0;
    const category =
      learnedCategory(data, merchant) ??
      learnedCategory(data, r.description) ??
      categorize(r.description, income ? 1 : -1, names) ??
      (income ? 'Other income' : 'Everything else');
    return {
      ...r,
      merchant,
      note: merchant !== r.description ? r.description : undefined,
      duplicate,
      category,
      kind: income ? ('income' as const) : ('expense' as const),
    };
  });
}

/** pdf.js and its worker load only when a PDF is chosen. */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Passwords are remembered per bank: SBI uses the same one on every account's statement. */
const passwordKey = (account: Account | undefined) => account?.brand ?? account?.id ?? 'statement';

export default function ImportSheet({ open, onClose, accountId, file }: { open: boolean; onClose: () => void; accountId?: string; /** A statement to read at once (one dragged onto Finance). */ file?: File }) {
  return (
    <Sheet open={open} onClose={onClose} width={720} title="Import a statement" subtitle="CSV or PDF from SBI, ICICI, HDFC or most other banks. Nothing is saved until you confirm.">
      <ImportBody onClose={onClose} initialAccount={accountId} initialFile={file} />
    </Sheet>
  );
}

function ImportBody({ onClose, initialAccount, initialFile }: { onClose: () => void; initialAccount?: string; initialFile?: File }) {
  const { data, dispatch, undo } = useFinance();
  const banks = data.accounts.filter((a) => !a.archived);
  const [accountId, setAccountId] = useState(initialAccount ?? banks[0]?.id ?? '');
  const [file, setFile] = useState<{ name: string; result: CsvParseResult; savedPassword?: boolean } | null>(null);
  const [locked, setLocked] = useState<{ name: string; bytes: ArrayBuffer; wrong: boolean; savedFailed: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const account = accountById(data, accountId);
  const bank = passwordKey(account);
  const bankName = account?.brand === 'sbi' ? 'SBI' : account?.name ?? 'this bank';

  const openPdf = async (name: string, bytes: ArrayBuffer, pass: string | undefined, how: { saved?: boolean; remember?: boolean }) => {
    setBusy(true);
    try {
      const result = statementFromPdf(await pdfText(await loadPdfjs(), bytes, pass));
      setLocked(null);
      setPassword('');
      setFile({ name, result, savedPassword: how.saved });
      if (pass && how.remember) {
        await rememberStatementPassword(bank, pass).catch((e) => toast.error(`Opened, but the password could not be saved: ${String(e)}`));
      }
    } catch (e) {
      if (e instanceof LockedPdfError) {
        setFile(null);
        // A saved password that stopped working is not "wrong" — just ask again.
        setLocked({ name, bytes, wrong: e.wrongPassword && !how.saved, savedFailed: !!how.saved });
      } else {
        setLocked(null);
        setFile({ name, result: { rows: [], warnings: [`This PDF could not be read: ${e instanceof Error ? e.message : String(e)}`], format: 'pdf' } });
      }
    } finally {
      setBusy(false);
    }
  };

  const read = async (f: File) => {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      const bytes = await f.arrayBuffer();
      const saved = await savedStatementPassword(bank).catch(() => undefined);
      await openPdf(f.name, bytes, saved, { saved: saved !== undefined });
      return;
    }
    setLocked(null);
    setFile({ name: f.name, result: parseCsv(await f.text()) });
  };

  // A statement handed in with the sheet is read as if it had been chosen here.
  const handed = useRef(false);
  useEffect(() => {
    if (!initialFile || handed.current) return;
    handed.current = true;
    void read(initialFile);
    // Once, for the file the sheet was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const forget = async () => {
    await forgetStatementPassword(bank)
      .then(() => {
        setFile((cur) => (cur ? { ...cur, savedPassword: false } : cur));
        toast(`Forgot the saved ${bankName} statement password`);
      })
      .catch((e) => toast.error(`Could not forget it: ${String(e)}`));
  };

  // Per-row fixes made before importing, by position in the file.
  const [edits, setEdits] = useState<Record<number, { merchant?: string; category?: string }>>({});
  const edit = (index: number, change: { merchant?: string; category?: string }) =>
    setEdits((all) => ({ ...all, [index]: { ...all[index], ...change } }));
  // Renames and picked categories are work; closing asks before dropping them.
  const requestClose = useUnsavedChanges(Object.keys(edits).length > 0, 'Discard your edits');
  const [lastFile, setLastFile] = useState(file);
  if (lastFile !== file) {
    setLastFile(file);
    setEdits({});
  }

  const rows = (file && accountId ? plan(file.result, data, accountId) : []).map((r, index) => {
    const fix = edits[index];
    const merchant = fix?.merchant ?? r.merchant;
    // A renamed row takes the category that name was last filed under, unless one was picked here.
    const learned = fix?.merchant !== undefined ? learnedCategory(data, merchant.trim()) : undefined;
    return { ...r, index, read: r.merchant, merchant, category: fix?.category ?? learned ?? r.category, picked: fix?.category !== undefined };
  });
  const fresh = rows.filter((r) => !r.duplicate);
  const categoriesFor = (income: boolean, current: string) => {
    const list = data.categories.filter((c) => c.kind === (income ? 'income' : 'expense'));
    return list.some((c) => c.name === current) ? list : [...list, { id: `current-${current}`, name: current, color: 'rgba(255,255,255,.32)', kind: income ? 'income' : 'expense' }];
  };
  const { check, totals } = file?.result ?? {};
  const adds = totals ? totals.matches : check && check.checked > 0 ? check.breaks.length === 0 : undefined;

  const commit = () => {
    if (!account || fresh.length === 0) return;
    const txs: Transaction[] = fresh.map((r) => ({
      id: newId('imp'),
      kind: r.kind,
      date: r.date,
      amount: r.amount,
      accountId,
      // A name cleared by mistake falls back to the one read from the statement.
      merchant: r.merchant.trim() || r.read,
      ...(r.note ? { note: r.note } : {}),
      category: r.category,
      source: 'import',
      // A category picked here was chosen by a person, so it skips review.
      autoCategorized: !r.picked,
      // Start of that day: a balance set later the same day already includes
      // this row, so it must sort before the checkpoint.
      createdAt: `${r.date}T00:00:01.000Z`,
    }));
    const change = dispatch({ type: 'ADD_TRANSACTIONS', txs });
    const toReview = txs.filter((t) => t.autoCategorized).length;
    toast(`Imported ${txs.length} into ${account.name}`, {
      description:
        toReview === 0
          ? 'Filed under the categories you picked.'
          : `${toReview === txs.length ? 'They are' : `${toReview} are`} waiting in Transactions → Needs review.`,
      action: { label: 'Undo', onClick: () => undo(change) },
    });
    onClose();
  };

  return (
    <div className="fin-form">
      <Field label="Into">
        <div className="fin-chiprow">
          {banks.map((a) => (
            <button key={a.id} type="button" className="fin-paychip" aria-pressed={accountId === a.id} onClick={() => setAccountId(a.id)}>
              <BrandMark brand={a.brand} fallback={a.name} size={20} />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      </Field>

      <button
        type="button"
        className="fin-drop"
        data-dragging={dragging}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) void read(f);
        }}
      >
        <FileUp size={20} strokeWidth={1.5} aria-hidden="true" />
        {busy ? (
          <span>Reading…</span>
        ) : file || locked ? (
          <span>
            <strong>{file?.name ?? locked?.name}</strong> · choose another
          </span>
        ) : (
          <span>
            Drop a CSV or PDF here, or <strong>choose a file</strong>
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept=".csv,.txt,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Cleared, so choosing the same file again still reads it.
          e.target.value = '';
          if (f) void read(f);
        }}
      />

      {locked && (
        <form
          className="fin-import__lock"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void openPdf(locked.name, locked.bytes, password, { remember });
          }}
        >
          <p className="fin-import__lock-title">
            <Lock size={14} strokeWidth={1.8} aria-hidden="true" /> This statement is password-protected
          </p>
          <Field
            label="Password"
            hint={account?.brand === 'sbi' ? 'SBI: last 5 digits of your registered mobile, then your date of birth as DDMMYY' : undefined}
          >
            <input className="fin-input fin-num" type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <label className="fin-toggle">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span className="fin-toggle__track" aria-hidden="true" />
            <span>Remember it for {bankName} statements on this laptop</span>
          </label>
          {locked.wrong && (
            <p className="fin-error" role="alert">
              That password didn’t open it.
            </p>
          )}
          {locked.savedFailed && <p className="fin-hint">The saved {bankName} password didn’t open this one. Enter it again to replace it.</p>}
          <button type="submit" className="fin-pill fin-pill--sm" disabled={!password || busy}>
            {busy ? 'Opening…' : 'Open'}
          </button>
        </form>
      )}

      {file && (
        <>
          <div className="fin-import__summary">
            {file.result.format !== 'unknown' && <span className="fin-chip fin-chip--accent">{file.result.format.toUpperCase()}</span>}
            {adds === true && (
              <span
                className="fin-chip fin-chip--up"
                title={check ? `Opening ${moneyIn(check.opening, account?.currency ?? 'INR')} · closing ${moneyIn(check.closing, account?.currency ?? 'INR')}` : undefined}
              >
                <Check size={12} strokeWidth={2.2} aria-hidden="true" /> {totals ? 'Matches the statement’s totals' : 'Balances add up'}
              </span>
            )}
            {adds === false && (
              <span className="fin-chip fin-chip--down">
                <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" /> {totals ? 'Doesn’t match the statement’s totals' : 'Balances don’t add up'}
              </span>
            )}
            <span>{file.result.rows.length} rows read</span>
            <span className="fin-dotsep" aria-hidden="true" />
            <span className="fin-positive">{fresh.length} new</span>
            {rows.length - fresh.length > 0 && (
              <>
                <span className="fin-dotsep" aria-hidden="true" />
                <span>{rows.length - fresh.length} already here</span>
              </>
            )}
            {file.result.warnings.length > 0 && (
              <details className="fin-import__warn">
                <summary>{file.result.warnings.length} skipped</summary>
                <ul>
                  {file.result.warnings.slice(0, 12).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {adds === false && (
            <p className="fin-error fin-import__mismatch" role="alert">
              {check && check.breaks.length > 0
                ? `The printed balance stops following on ${[...new Set(check.breaks)].map(shortDate).join(', ')}. Check those rows against the statement before importing.`
                : totals
                  ? `The statement says ${totals.printed.debitCount} debits of ${moneyIn(totals.printed.debits, 'INR')} and ${totals.printed.creditCount} credits of ${moneyIn(totals.printed.credits, 'INR')}; the rows read here differ.`
                  : null}
            </p>
          )}
          {file.savedPassword && (
            <p className="fin-hint">
              Opened with the saved {bankName} password.{' '}
              <button type="button" className="fin-link" onClick={() => void forget()}>
                Forget it
              </button>
            </p>
          )}

          {rows.length > 0 && (
            <div className="fin-import__table" role="table">
              {rows.map((r) => {
                const amount = moneyIn(r.amount, account?.currency ?? 'INR', { signed: true });
                if (r.duplicate) {
                  return (
                    <div key={r.index} className="fin-import__row" data-duplicate="true" role="row">
                      <span className="fin-num fin-import__date">{shortDate(r.date)}</span>
                      <span className="fin-import__desc" title={r.note}>
                        {r.merchant}
                      </span>
                      <span className="fin-import__cat">Already imported</span>
                      <span className="fin-num">{amount}</span>
                    </div>
                  );
                }
                const options = categoriesFor(r.amount > 0, r.category);
                return (
                  <div key={r.index} className="fin-import__row" role="row">
                    <span className="fin-num fin-import__date">{shortDate(r.date)}</span>
                    <input
                      className="fin-import__name"
                      value={r.merchant}
                      title={r.note}
                      spellCheck={false}
                      aria-label={`Name for ${amount} on ${shortDate(r.date)}`}
                      onChange={(e) => edit(r.index, { merchant: e.target.value })}
                    />
                    <span className="fin-import__cat">
                      <PopUpButton
                        className="fin-import__pick"
                        label={`Category for ${amount} on ${shortDate(r.date)}`}
                        value={r.category}
                        onChange={(category) => edit(r.index, { category })}
                        options={options.map((c) => ({
                          value: c.name,
                          label: c.name,
                          icon: <span className="fin-import__swatch" style={{ background: c.color }} />,
                        }))}
                      />
                      {!r.picked && <span className="fin-auto">auto</span>}
                    </span>
                    <span className={r.amount > 0 ? 'fin-num fin-positive' : 'fin-num'}>{amount}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <SheetFooter>
        <span className="fin-hint">Rename or re-file any row above. Categories you leave on auto wait in the review queue.</span>
        <span className="fin-spacer" />
        <button type="button" className="fin-pill" onClick={(e) => requestClose(e.currentTarget)}>
          Cancel
        </button>
        <button type="button" className="fin-pill fin-pill--action" disabled={!account || fresh.length === 0} onClick={commit}>
          {fresh.length ? `Import ${fresh.length}` : 'Import'}
        </button>
      </SheetFooter>
    </div>
  );
}
