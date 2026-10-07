/**
 * A bank's narration → the merchant name a person would have written.
 *
 * Statements describe a UPI payment as `UPI/DR/662316879472/McDonalds/UTIB/
 * mcdonaldsi/Pay`, which is unreadable in a ledger and never matches the
 * "McDonalds" typed by hand, so learned categories and duplicate checks both
 * missed. The full narration is kept as the note; the 12-digit UPI reference
 * in it identifies the payment exactly.
 */

export interface Narration {
  merchant: string;
  /** The UPI / IMPS reference number, when the narration carries one. */
  ref?: string;
}

const UPI_WORDS = /^(upi|dr|cr|p2a|p2m|pay|payment)$/i;

/** ALL-CAPS words become Title Case; mixed case and codes (MH12JS4808) stay as written. */
function tidy(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (/^[A-Z]{2,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export function readNarration(raw: string): Narration {
  let s = raw.replace(/\s+/g, ' ').trim();
  // SBI prints the transaction type first ("WDL TFR", "DEP TFR") and the
  // branch last ("0097690162095 AT 06273 GOPALNAGAR (NAGPUR)").
  s = s.replace(/^(?:WDL|DEP)\s+TFR\s+/i, '').replace(/\s+\d{6,}\s+AT\s+\d{4,6}\b.*$/i, '');

  if (/^UPI\//i.test(s)) {
    const parts = s.split('/').map((p) => p.trim()).filter(Boolean);
    const refAt = parts.findIndex((p) => /^\d{9,}$/.test(p));
    const ref = refAt >= 0 ? parts[refAt] : undefined;
    // SBI and most banks put the payee straight after the reference.
    const afterRef = refAt >= 0 ? parts[refAt + 1] : undefined;
    const name =
      afterRef && /[a-z]/i.test(afterRef) && !afterRef.includes('@')
        ? afterRef
        : parts.find((p) => !UPI_WORDS.test(p) && !/^\d+$/.test(p) && !p.includes('@') && /[a-z]/i.test(p));
    if (name) return { merchant: tidy(name), ref };
    return { merchant: s, ref };
  }

  // SBI transfers: "BY TRANSFER-NEFT*HDFC0000001*N245…*EXAMPLE EMPLOYER LTD" —
  // the sender (or payee) is the last starred part.
  if (/\b(?:NEFT|IMPS|RTGS)\*/i.test(s)) {
    const name = s
      .split('*')
      .map((p) => p.replace(/-+$/, '').trim())
      .filter((p) => /[a-z]{2,}/i.test(p) && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p) && !/(?:NEFT|IMPS|RTGS)$/i.test(p))
      .pop();
    const ref = s.match(/\b\d{9,}\b/)?.[0];
    if (name) return { merchant: tidy(name), ...(ref ? { ref } : {}) };
  }

  const imps = s.match(/\b(?:IMPS|NEFT|RTGS)[/*-](?:[A-Z]+[/*-])?(\d{9,})/i);
  return { merchant: s, ...(imps ? { ref: imps[1] } : {}) };
}
