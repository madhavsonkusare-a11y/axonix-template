/**
 * Compile the vendored tracker list for electron/blocker.ts.
 *
 * `electron/blocklists/easyprivacy.txt` (EasyPrivacy, easylist.to; GPLv3 or
 * CC BY-SA 3.0) plus our own `axonix-exceptions.txt` → `<outDir>/easyprivacy.bin`,
 * the matching engine serialised, which the app loads in ~10ms instead of
 * parsing 57k lines at startup.
 *
 * Refresh the list (it changes weekly; a few months stale is fine):
 *   node scripts/blocklist.mjs --update
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FiltersEngine } from '@ghostery/adblocker';

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(ui, 'electron', 'blocklists', 'easyprivacy.txt');
/** Our own allow rules on top (sites' security checks), kept apart so an update never loses them. */
const exceptions = path.join(ui, 'electron', 'blocklists', 'axonix-exceptions.txt');

export function compileBlocklist(outDir) {
  const text = [fs.readFileSync(source, 'utf8'), fs.readFileSync(exceptions, 'utf8')].join('\n');
  const engine = FiltersEngine.parse(text, {
    loadNetworkFilters: true,
    loadCosmeticFilters: false,
    loadCSPFilters: false,
    enableHtmlFiltering: false,
  });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'easyprivacy.bin'), engine.serialize());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--update')) {
  const res = await fetch('https://easylist.to/easylist/easyprivacy.txt');
  if (!res.ok) throw new Error(`easylist.to answered ${res.status}`);
  const text = await res.text();
  if (!text.startsWith('[Adblock Plus')) throw new Error('that is not a filter list');
  fs.writeFileSync(source, text);
  console.log(`Updated ${source} (${text.split('\n').length} lines)`);
}
