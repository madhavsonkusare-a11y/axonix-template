/**
 * CSV import for bank statements, plus what every statement reader shares:
 * dates, money with CR/DR, and the running-balance cross-check. PDF statements
 * are rebuilt into the same rows in `pdf.ts`.
 *
 * Header detection is heuristic — SBI, HDFC and ICICI name their columns
 * differently — so the importer always shows its reading before writing
 * anything. Categorisation lives in `parse.ts` and is shared with quick entry.
 */

export interface ParsedRow {
  date: string;
  description: string;
  amount: number;
  /** The balance the statement prints after this row, when it has a balance column. */
  balance?: number;
  raw: Record<string, string>;
}

/**
 * Does each printed balance follow from the one before it? A misread amount,
 * a debit taken for a credit, or a row the reader dropped all break the chain,
 * so this is the check that the reading is right.
 */
export interface BalanceCheck {
  /** Rows whose balance was compared with the previous row's. */
  checked: number;
  /** Dates of the rows where the chain breaks, in file order. */
  breaks: string[];
  opening: number;
  closing: number;
}

/** The totals a statement prints about itself (SBI's Statement Summary). */
export interface StatementTotals {
  opening: number;
  closing: number;
  debitCount: number;
  creditCount: number;
  debits: number;
  credits: number;
}

export interface CsvParseResult {
  rows: ParsedRow[];
  warnings: string[];
  format: string;
  check?: BalanceCheck;
  /** Printed totals, and whether the rows read add up to them. */
  totals?: { printed: StatementTotals; matches: boolean };
}

/** A real calendar date as `YYYY-MM-DD`, or null — "31/02/2026" used to pass as 2026-02-31. */
function isoDate(y: number, mo: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) return isoDate(parseInt(m[3]), parseInt(m[2]), parseInt(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoDate(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // "13 Sep 2026" and "13-Sep-2026" (both appear in Indian bank exports).
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*[\s-]+(\d{2,4})/);
  if (m && months[m[2].toLowerCase()]) return isoDate(parseInt(m[3]), months[m[2].toLowerCase()], parseInt(m[1]));
  return null;
}

function parseAmount(raw: string, defaultSign = -1): number | null {
  const s = raw.trim().replace(/,/g, '');
  if (!s) return null;
  const isCR = /cr$/i.test(s);
  const isDR = /dr$/i.test(s);
  const numStr = s.replace(/\s*(cr|dr)$/i, '').trim();
  const num = parseFloat(numStr);
  if (isNaN(num)) return null;
  if (isCR) return num;
  if (isDR) return -num;
  return num * defaultSign;
}

/** "15,383.27", "14,675.62CR", "-500.00", "1,000 Dr" → signed rupees; a dash or blank → null. */
export function parseMoney(raw: string): number | null {
  const m = raw.trim().replace(/,/g, '').match(/^(-)?\s*(\d+(?:\.\d+)?)\s*(cr|dr)?$/i);
  if (!m) return null;
  const n = parseFloat(m[2]);
  return m[1] || m[3]?.toLowerCase() === 'dr' ? -n : n;
}

export const paise = (n: number) => Math.round(n * 100);

/**
 * Checks the balance chain in whichever order the file runs (some banks list
 * newest first). Undefined when no row carries a balance.
 */
export function checkBalances(rows: ParsedRow[]): BalanceCheck | undefined {
  const chain = rows.filter((r): r is ParsedRow & { balance: number } => r.balance !== undefined);
  if (chain.length === 0) return undefined;
  const breaksWhere = (follows: (prev: (typeof chain)[number], cur: (typeof chain)[number]) => boolean) =>
    chain.slice(1).flatMap((cur, i) => (follows(chain[i], cur) ? [] : [cur.date]));
  const oldestFirst = breaksWhere((prev, cur) => paise(prev.balance + cur.amount) === paise(cur.balance));
  const newestFirst = breaksWhere((prev, cur) => paise(cur.balance + prev.amount) === paise(prev.balance));
  const first = chain[0];
  const last = chain[chain.length - 1];
  return newestFirst.length < oldestFirst.length
    ? { checked: chain.length - 1, breaks: newestFirst, opening: last.balance - last.amount, closing: first.balance }
    : { checked: chain.length - 1, breaks: oldestFirst, opening: first.balance - first.amount, closing: last.balance };
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += c;
  }
  result.push(current.trim());
  return result;
}

function findColumns(headers: string[]) {
  const lower = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = (patterns: string[], exact: string[] = []): number => {
    // Exact short names first ("dr", "cr"): as substrings they would match
    // "address" and "description".
    for (const p of exact) { const i = lower.indexOf(p); if (i !== -1) return i; }
    for (const p of patterns) { const i = lower.findIndex((h) => h.includes(p)); if (i !== -1) return i; }
    return -1;
  };
  // A single amount column with a separate "Dr/Cr" (or "Type") column saying
  // which way it went. Without reading it, every credit imported as an expense.
  const direction = lower.findIndex((h) => ['drcr', 'crdr', 'debitcredit', 'creditdebit', 'type', 'txntype', 'transactiontype'].includes(h));
  const debit = find(['debit', 'withdrawal', 'withdrawl'], ['dr', 'withdrawalamt']);
  const credit = find(['credit', 'deposit'], ['cr', 'depositamt']);
  return {
    direction,
    date: find(['txndate', 'transactiondate', 'trandate', 'valuedate', 'date']),
    description: find(['description', 'narration', 'particulars', 'details', 'remarks']),
    balance: find(['closingbalance', 'runningbalance', 'balance']),
    debit,
    credit,
    // A lone amount column only counts when there is no debit/credit pair —
    // ICICI's "Withdrawal Amount" would otherwise claim every row as a debit.
    amount: debit !== -1 && credit !== -1 ? -1 : lower.findIndex((h) => h === 'amount' || h.startsWith('amount') || h.endsWith('amount')),
  };
}

function detectFormat(headers: string[]): string {
  const joined = headers.map((h) => h.toLowerCase()).join('|');
  if (joined.includes('transaction particulars') || joined.includes('txn date')) return 'sbi';
  if (joined.includes('narration') && joined.includes('value date')) return 'hdfc';
  if (joined.includes('cheque') && joined.includes('credit') && joined.includes('balance')) return 'icici';
  if (joined.includes('transaction remarks') || joined.includes('withdrawal amount')) return 'icici';
  if (joined.includes('description') && joined.includes('debit') && joined.includes('credit')) return 'generic';
  return 'unknown';
}

export function parseCsv(text: string): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const warnings: string[] = [];
  if (lines.length < 2) return { rows: [], warnings: ['File appears to be empty'], format: 'unknown' };

  let headerLine = 0;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (splitCsvLine(lines[i]).length >= 3) { headerLine = i; break; }
  }

  const headers = splitCsvLine(lines[headerLine]);
  const cols = findColumns(headers);
  const format = detectFormat(headers);

  if (cols.date === -1 || cols.description === -1) {
    return { rows: [], warnings: ['Could not identify date and description columns'], format: 'unknown' };
  }
  if (cols.debit === -1 && cols.credit === -1 && cols.amount === -1) {
    return { rows: [], warnings: ['Could not identify amount columns'], format: 'unknown' };
  }

  const signedAmounts =
    cols.amount !== -1 && lines.slice(headerLine + 1).some((l) => /^\s*-\s*\d/.test(splitCsvLine(l)[cols.amount] ?? ''));

  const rows: ParsedRow[] = [];
  for (let i = headerLine + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 3) continue;
    const dateStr = cells[cols.date] || '';
    const desc = cells[cols.description] || '';
    if (!dateStr && !desc) continue;
    const date = parseDate(dateStr);
    if (!date) { warnings.push(`Row ${i + 1}: could not parse date "${dateStr}"`); continue; }

    let amount: number | null = null;
    if (cols.amount !== -1) {
      if (cols.direction !== -1) {
        const marker = (cells[cols.direction] || '').trim().toLowerCase();
        amount = parseAmount((cells[cols.amount] || '').replace(/^[-+]/, ''), /^(cr|c|credit|deposit)\b/.test(marker) ? 1 : -1);
      } else {
        // A signed column (debits negative) keeps its signs; an unsigned one
        // is all debits. Multiplying a "-500" by the debit sign made it +500.
        amount = parseAmount(cells[cols.amount] || '', signedAmounts ? 1 : -1);
      }
    }
    else if (cols.debit !== -1 && cols.credit !== -1) {
      // Banks pad the empty side with "0.00" or "-", so a zero credit is not a credit.
      const debit = cells[cols.debit] ? parseAmount(cells[cols.debit], -1) : null;
      const credit = cells[cols.credit] ? parseAmount(cells[cols.credit], 1) : null;
      amount = credit ? credit : debit;
    }
    if (amount === null || amount === 0) { warnings.push(`Row ${i + 1}: no valid amount`); continue; }

    const balance = cols.balance !== -1 ? parseMoney(cells[cols.balance] || '') : null;
    rows.push({
      date,
      description: desc.replace(/\s+/g, ' ').trim(),
      amount,
      ...(balance !== null ? { balance } : {}),
      raw: Object.fromEntries(headers.map((h, j) => [h, cells[j] || ''])),
    });
  }

  return { rows, warnings, format, check: checkBalances(rows) };
}

