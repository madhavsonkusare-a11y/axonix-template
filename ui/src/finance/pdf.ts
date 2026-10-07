/**
 * PDF bank statements.
 *
 * pdf.js returns positioned text, not a table, so rows are rebuilt from where
 * things sit on the page:
 *
 * - A row starts on a line that begins with a date and carries an amount.
 * - Money columns are found by clustering the positions of amounts and of the
 *   dashes banks print in empty cells. The right-most is the balance and the
 *   two before it are debit then credit (SBI, ICICI and HDFC all print that
 *   order) — swapped only if the balance chain works the other way round.
 * - Description lines join the nearest row: a line sitting just above a date
 *   belongs to that row (SBI prints "WDL TFR" there), lines below belong to
 *   the row above. A line that fills the column was wrapped mid-word (SBI
 *   breaks "McDonald" / "s/UTIB…"), so the next one joins without a space.
 *
 * SBI draws its column headings as shapes, not text, so nothing here depends
 * on reading headings. `pdfText` needs pdf.js; everything else is pure, so it
 * can be checked against a real statement outside the app.
 */
import type * as PdfJs from 'pdfjs-dist';
import { checkBalances, paise, parseDate, parseMoney, type CsvParseResult, type ParsedRow, type StatementTotals } from './csv';

export interface TextBit {
  str: string;
  x: number;
  /** Baseline, measured down from the top of the page. */
  top: number;
  width: number;
  size: number;
  page: number;
}

/** The statement is locked; `wrongPassword` when a password was tried and failed. */
export class LockedPdfError extends Error {
  constructor(readonly wrongPassword: boolean) {
    super(wrongPassword ? 'That password did not open the statement.' : 'This statement is password-protected.');
    this.name = 'LockedPdfError';
  }
}

export async function pdfText(pdfjs: typeof PdfJs, data: ArrayBuffer | Uint8Array, password?: string): Promise<TextBit[]> {
  // pdf.js hands the bytes to its worker, which detaches them; a copy keeps the
  // caller's buffer usable for a retry with the password.
  const bytes = new Uint8Array(data).slice();
  const task = pdfjs.getDocument({ data: bytes, password, disableFontFace: true });
  let doc: PdfJs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    if (e && typeof e === 'object' && 'name' in e && e.name === 'PasswordException') {
      throw new LockedPdfError((e as { code?: number }).code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    }
    throw e;
  }
  const bits: TextBit[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
        bits.push({ str: item.str, x, top: y, width: item.width, size: Math.hypot(c, d) || item.height, page: n });
      }
    }
  } finally {
    await task.destroy();
  }
  return bits;
}

/* ------------------------------------------------------------------ */
/* rebuilding the table                                                */
/* ------------------------------------------------------------------ */

interface Token {
  text: string;
  x: number;
  right: number;
  top: number;
  size: number;
  page: number;
}

interface Line {
  page: number;
  top: number;
  size: number;
  tokens: Token[];
}

const MONEY = /^-?(?:\d{1,3}(?:,\d{2,3})*|\d+)\.\d{2}(?:cr|dr)?$/i;
const DASH = /^[-–—]$/;

/** pdf.js items can hold several words; each word gets its share of the width. */
function tokensOf(bits: TextBit[]): Token[] {
  const out: Token[] = [];
  for (const b of bits) {
    const len = b.str.length || 1;
    for (const m of b.str.matchAll(/\S+/g)) {
      const from = (m.index ?? 0) / len;
      const to = ((m.index ?? 0) + m[0].length) / len;
      out.push({ text: m[0], x: b.x + b.width * from, right: b.x + b.width * to, top: b.top, size: b.size, page: b.page });
    }
  }
  return out;
}

function linesOf(tokens: Token[]): Line[] {
  const sorted = [...tokens].sort((a, b) => a.page - b.page || a.top - b.top || a.x - b.x);
  const lines: Line[] = [];
  for (const t of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === t.page && Math.abs(t.top - last.top) <= Math.max(1.5, t.size * 0.35)) last.tokens.push(t);
    else lines.push({ page: t.page, top: t.top, size: t.size, tokens: [t] });
  }
  for (const l of lines) {
    l.tokens.sort((a, b) => a.x - b.x);
    for (let i = l.tokens.length - 1; i > 0; i--) {
      const [prev, cur] = [l.tokens[i - 1], l.tokens[i]];
      if (/^(cr|dr)$/i.test(cur.text) && MONEY.test(prev.text) && cur.x - prev.right < prev.size) {
        prev.text += cur.text;
        prev.right = cur.right;
        l.tokens.splice(i, 1);
      }
    }
  }
  return lines;
}

const textOf = (tokens: Token[]) =>
  tokens.reduce((s, t, i) => (i === 0 ? t.text : s + (t.x - tokens[i - 1].right < t.size * 0.12 ? '' : ' ') + t.text), '');

/** A date at the start of the line, and how many tokens it used ("13 Sep 2026" is three). */
function leadingDate(l: Line): { date: string; used: number } | null {
  const t = l.tokens;
  if (t[0] && /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$|^\d{4}-\d{2}-\d{2}$|^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(t[0].text)) {
    const date = parseDate(t[0].text);
    return date ? { date, used: 1 } : null;
  }
  if (t.length >= 3 && /^\d{1,2}$/.test(t[0].text) && /^[A-Za-z]{3,9}$/.test(t[1].text) && /^\d{2,4}$/.test(t[2].text)) {
    const date = parseDate(`${t[0].text} ${t[1].text} ${t[2].text}`);
    return date ? { date, used: 3 } : null;
  }
  return null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** SBI's "Statement Summary": Brought Forward, Dr Count, Cr Count, Total Debits, Total Credits, Closing Balance. */
function printedTotals(lines: Line[]): StatementTotals | undefined {
  const at = lines.findIndex((l) => /brought\s*forward/i.test(textOf(l.tokens)));
  if (at < 0) return undefined;
  for (const l of lines.slice(at + 1, at + 4)) {
    const values = l.tokens.map((t) => (/^\d+$/.test(t.text) ? parseInt(t.text, 10) : parseMoney(t.text)));
    if (values.length === 6 && values.every((v) => v !== null)) {
      const [opening, debitCount, creditCount, debits, credits, closing] = values as number[];
      return { opening, closing, debitCount, creditCount, debits, credits };
    }
  }
  return undefined;
}

export function statementFromPdf(bits: TextBit[]): CsvParseResult {
  if (bits.length === 0) {
    return { rows: [], warnings: ['This PDF has no text in it. It may be a scanned image, which cannot be read.'], format: 'pdf' };
  }
  const lines = linesOf(tokensOf(bits));
  const format = bits.some((b) => /state bank of india|SBIN0/i.test(b.str)) ? 'sbi pdf' : 'pdf';

  const anchors = lines
    .map((line, index) => ({ line, index, lead: leadingDate(line) }))
    .filter((a): a is { line: Line; index: number; lead: { date: string; used: number } } =>
      !!a.lead && a.line.tokens.slice(a.lead.used).some((t) => MONEY.test(t.text)),
    );
  if (anchors.length === 0) {
    return { rows: [], warnings: ['No transactions found. Is this a bank account statement?'], format };
  }

  // Where descriptions start: the first word after the date(s) on each row.
  const descX = median(
    anchors.flatMap(({ line, lead }) => {
      const rest = line.tokens.slice(lead.used).filter((t) => !leadingDate({ ...line, tokens: [t] }));
      const first = rest.find((t) => !MONEY.test(t.text) && !DASH.test(t.text));
      return first ? [first.x] : [];
    }),
  );

  // Money columns: cluster the centres of amounts and empty-cell dashes.
  const cells = anchors.flatMap(({ line }) =>
    line.tokens.filter((t) => t.x > descX + 20 && (MONEY.test(t.text) || DASH.test(t.text))).map((t) => ({ c: (t.x + t.right) / 2, money: MONEY.test(t.text) })),
  );
  // Neighbour to neighbour: amounts of different lengths and centred dashes
  // wander within a column (by up to ~20pt), while columns sit 60pt or more apart.
  const clusters: { c: number; n: number; money: number; edge: number }[] = [];
  for (const cell of cells.sort((a, b) => a.c - b.c)) {
    const last = clusters[clusters.length - 1];
    if (last && cell.c - last.edge <= 28) {
      last.c += cell.c;
      last.n++;
      last.money += cell.money ? 1 : 0;
      last.edge = cell.c;
    } else clusters.push({ c: cell.c, n: 1, money: cell.money ? 1 : 0, edge: cell.c });
  }
  const colXs = clusters.map((k) => k.c / k.n);
  const leftmostCell = colXs.length ? Math.min(...colXs) : Infinity;
  const nearest = (x: number) => colXs.reduce((best, c) => (Math.abs(c - x) < Math.abs(best - x) ? c : best), colXs[0]);

  // Each row's cells, keyed by the column they sit under.
  const cellsByRow = anchors.map(({ line }) => {
    const byCol = new Map<number, string>();
    if (colXs.length === 0) return byCol;
    for (const t of line.tokens) {
      if (t.x <= descX + 20 || !(MONEY.test(t.text) || DASH.test(t.text))) continue;
      const centre = (t.x + t.right) / 2;
      const col = nearest(centre);
      if (Math.abs(col - centre) <= 30) byCol.set(col, t.text);
    }
    return byCol;
  });

  // Which columns are debit, credit and balance is not printed in a readable
  // way, and a month with no credits has a credit column of dashes only. So
  // every plausible layout is read, and the one whose balances chain (and
  // match the printed totals, when there are any) wins.
  type Layout = { debit: number; credit: number; balance: number } | { amount: number; balance?: number };
  const layouts: Layout[] = [];
  if (colXs.length >= 3) {
    const [d, c, b] = colXs.slice(-3);
    layouts.push({ debit: d, credit: c, balance: b }, { debit: c, credit: d, balance: b });
  }
  if (colXs.length >= 2) layouts.push({ amount: colXs[colXs.length - 2], balance: colXs[colXs.length - 1] });
  if (colXs.length >= 1) layouts.push({ amount: colXs[colXs.length - 1] });

  /** Amount and balance per row under a layout, or null where the amount cannot be read. */
  const amounts = (layout: Layout) =>
    cellsByRow.map((byCol) => {
      let amount: number | null;
      if ('debit' in layout) {
        const debit = parseMoney(byCol.get(layout.debit) ?? '');
        const credit = parseMoney(byCol.get(layout.credit) ?? '');
        amount = credit ? Math.abs(credit) : debit ? -Math.abs(debit) : null;
      } else {
        // One amount column: it has to say which way the money went.
        const text = byCol.get(layout.amount) ?? '';
        amount = /(cr|dr)$/i.test(text) || text.startsWith('-') ? parseMoney(text) : null;
      }
      const balance = layout.balance !== undefined ? parseMoney(byCol.get(layout.balance) ?? '') : null;
      return amount === null || amount === 0 ? null : { amount, balance };
    });

  // Descriptions, from the description column only.
  const inColumn = (t: Token) => t.x >= descX - 4 && t.x < leftmostCell - 15;
  const anchorAt = new Map(anchors.map((a, i) => [a.index, i]));
  const parts = anchors.map(() => ({ before: [] as Token[][], body: [] as Token[][] }));
  let current = -1;
  let lastTop = 0;
  lines.forEach((line, index) => {
    const own = anchorAt.get(index);
    if (own !== undefined) {
      current = own;
      lastTop = line.top;
      parts[own].body.push(line.tokens.slice(anchors[own].lead.used).filter(inColumn));
      return;
    }
    const words = line.tokens.filter(inColumn);
    if (words.length === 0) return;
    const h = line.size * 1.25;
    const next = anchors.find((a) => a.index > index);
    if (next && next.line.page === line.page && next.line.top - line.top <= h * 1.2) {
      parts[anchorAt.get(next.index)!].before.push(words);
    } else if (current >= 0 && anchors[current].line.page === line.page && line.top - lastTop <= h * 1.6) {
      parts[current].body.push(words);
      lastTop = line.top;
    }
  });
  const widest = Math.max(1, ...parts.flatMap((p) => p.body.filter((w) => w.length).map((w) => w[w.length - 1].right - descX)));
  const describe = (p: (typeof parts)[number]) => {
    const body = p.body
      .filter((w) => w.length)
      .reduce((s, w, i, all) => {
        if (i === 0) return textOf(w);
        const prev = all[i - 1];
        const wrapped = prev[prev.length - 1].right - descX >= widest * 0.85;
        return s + (wrapped ? '' : ' ') + textOf(w);
      }, '');
    return [...p.before.map(textOf), body].filter(Boolean).join(' ');
  };

  const descriptions = parts.map(describe);
  const printed = printedTotals(lines);

  const read = layouts.map((layout) => {
    const found = amounts(layout);
    const rows: ParsedRow[] = found.flatMap((m, n) =>
      m
        ? [{
            date: anchors[n].lead.date,
            description: descriptions[n],
            amount: m.amount,
            ...(m.balance !== null ? { balance: m.balance } : {}),
            raw: { Date: anchors[n].lead.date, Description: descriptions[n], Amount: m.amount.toFixed(2), ...(m.balance !== null ? { Balance: m.balance.toFixed(2) } : {}) },
          }]
        : [],
    );
    const check = checkBalances(rows);
    let matches = false;
    if (printed) {
      const out = rows.filter((r) => r.amount < 0);
      const into = rows.filter((r) => r.amount > 0);
      const sum = (rs: ParsedRow[]) => rs.reduce((s, r) => s + Math.abs(r.amount), 0);
      matches =
        out.length === printed.debitCount &&
        into.length === printed.creditCount &&
        paise(sum(out)) === paise(printed.debits) &&
        paise(sum(into)) === paise(printed.credits) &&
        (!check || (paise(check.opening) === paise(printed.opening) && paise(check.closing) === paise(printed.closing)));
    }
    const missing = found.flatMap((m, n) => (m ? [] : [n]));
    return { rows, check, matches, missing };
  });
  // Printed totals agree > most rows read > fewest balance breaks > listed order.
  const best = read.reduce((a, b) =>
    b.matches !== a.matches ? (b.matches ? b : a)
    : b.rows.length !== a.rows.length ? (b.rows.length > a.rows.length ? b : a)
    : (b.check?.breaks.length ?? 0) < (a.check?.breaks.length ?? 0) ? b : a,
  read[0] ?? { rows: [], check: undefined, matches: false, missing: anchors.map((_, n) => n) });

  const warnings = best.missing.map((n) => `Page ${anchors[n].line.page}: the row dated ${anchors[n].lead.date} has no amount that could be read`);
  return { rows: best.rows, warnings, format, check: best.check, ...(printed ? { totals: { printed, matches: best.matches } } : {}) };
}
