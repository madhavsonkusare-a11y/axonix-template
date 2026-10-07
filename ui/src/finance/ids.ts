/**
 * Indian identity documents: how each number is shaped, grouped and masked.
 *
 * Validation is shape-only (length and character classes). It catches a
 * mistyped digit count; it does not prove a number is real — the verified copy
 * of that lives in DigiLocker, which is why each card links to it.
 */
import type { BrandId, IdType } from './types';

export interface IdMeta {
  label: string;
  brand: BrandId;
  placeholder: string;
  /** Uppercased, separators stripped, before testing. */
  pattern: RegExp;
  hint: string;
  /** Grouping for display, as segment lengths. */
  groups?: number[];
  sep?: string;
  expires: boolean;
}

export const ID_META: Record<IdType, IdMeta> = {
  aadhaar:  { label: 'Aadhaar',         brand: 'aadhaar',   placeholder: '0000 0000 0000',  pattern: /^\d{12}$/,               hint: '12 digits',                  groups: [4, 4, 4], expires: false },
  pan:      { label: 'PAN',             brand: 'incometax', placeholder: 'ABCDE1234F',      pattern: /^[A-Z]{5}\d{4}[A-Z]$/,   hint: '5 letters, 4 digits, 1 letter', expires: false },
  dl:       { label: 'Driving licence', brand: 'parivahan', placeholder: 'KA01 20190001234', pattern: /^[A-Z]{2}\d{2}[A-Z0-9]{9,13}$/, hint: 'State code, RTO, year, number', groups: [4, 20], expires: true },
  passport: { label: 'Passport',        brand: 'passport',  placeholder: 'Z1234567',        pattern: /^[A-Z]\d{7}$/,           hint: '1 letter, 7 digits',         expires: true },
  voter:    { label: 'Voter ID',        brand: 'voter',     placeholder: 'ABC1234567',      pattern: /^[A-Z]{3}\d{7}$/,        hint: '3 letters, 7 digits',        expires: false },
  abha:     { label: 'ABHA',            brand: 'abha',      placeholder: '00-0000-0000-0000', pattern: /^\d{14}$/,             hint: '14 digits',                  groups: [2, 4, 4, 4], sep: '-', expires: false },
  uan:      { label: 'UAN · EPFO',      brand: 'umang',     placeholder: '100000000000',    pattern: /^\d{12}$/,               hint: '12 digits',                  groups: [4, 4, 4], expires: false },
  other:    { label: 'Other',           brand: 'digilocker', placeholder: 'Number',         pattern: /^.+$/,                   hint: '',                           expires: true },
};

export const ID_ORDER: IdType[] = ['aadhaar', 'pan', 'dl', 'passport', 'voter', 'abha', 'uan', 'other'];

export const cleanId = (n: string) => n.toUpperCase().replace(/[\s-]/g, '');

export const isValidId = (type: IdType, n: string) => ID_META[type].pattern.test(cleanId(n));

function group(n: string, sizes?: number[], sep = ' '): string {
  if (!sizes) return n;
  const out: string[] = [];
  let i = 0;
  for (const size of sizes) {
    if (i >= n.length) break;
    out.push(n.slice(i, i + size));
    i += size;
  }
  if (i < n.length) out.push(n.slice(i));
  return out.join(sep);
}

export function formatId(type: IdType, n: string): string {
  return group(cleanId(n), ID_META[type].groups, ID_META[type].sep);
}

/**
 * Everything but the last four, the way UIDAI's own masked Aadhaar does it —
 * keeps the grouping so a masked number still looks like the document.
 */
export function maskId(type: IdType, n: string): string {
  const clean = cleanId(n);
  const keep = Math.min(4, clean.length);
  const masked = clean.slice(0, clean.length - keep).replace(/[A-Z0-9]/g, '•') + clean.slice(-keep);
  return group(masked, ID_META[type].groups, ID_META[type].sep);
}
