/**
 * Reading what arrives: a drop, a paste, or a line typed into the add field.
 *
 * After Karakeep's editor card: every line a web address → that many links;
 * otherwise text. SVG markup (Paper's and Figma's "Copy as SVG") is kept as a
 * vector file, not as a note. Files win over text when both arrive, because a
 * browser that copies an image also puts its HTML on the clipboard.
 */

export const SVG_TEXT = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;

export type Intake = { type: 'file'; file: File } | { type: 'url'; url: string } | { type: 'svg'; text: string } | { type: 'text'; text: string };

const ACCEPTED = /\.(png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v)$/i;

export const acceptedFile = (file: File) => ACCEPTED.test(file.name) || /^(image|video)\//.test(file.type);

/** Web addresses, when every non-empty line is one; otherwise null. */
export function urlsIn(text: string): string[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || lines.length > 50) return null;
  const urls: string[] = [];
  for (const line of lines) {
    try {
      const url = new URL(line);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      urls.push(url.href);
    } catch {
      return null;
    }
  }
  return urls;
}

export function classifyText(text: string): Intake[] {
  if (!text.trim()) return [];
  if (SVG_TEXT.test(text)) return [{ type: 'svg', text }];
  const urls = urlsIn(text);
  if (urls) return urls.map((url) => ({ type: 'url', url }));
  return [{ type: 'text', text }];
}

/** What a drop or a paste carries, best form first. */
export function readTransfer(data: DataTransfer | null): Intake[] {
  if (!data) return [];
  const files = [...data.files];
  if (files.length) return files.map((file) => ({ type: 'file', file }));
  const uriList = data.getData('text/uri-list');
  if (uriList) {
    const urls = uriList.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    const web = urls.map((u) => urlsIn(u)?.[0]).filter((u): u is string => Boolean(u));
    if (web.length) return web.map((url) => ({ type: 'url', url }));
  }
  return classifyText(data.getData('text/plain'));
}

/** Does this drag carry anything the Storeroom can keep? */
export function carriesIntake(data: DataTransfer | null): boolean {
  if (!data) return false;
  const types = [...data.types];
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
}
