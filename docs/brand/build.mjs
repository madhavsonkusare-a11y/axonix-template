// Assembles axonix-identity.html from identity.template.html:
// the mark path from assets/, the current wordmark and icon for comparison, the refined wordmark.
// Run from this folder: node wordmark.mjs 15 > wordmark.json && node build.mjs
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const mark = read('../../assets/logo-mark.svg').match(/ d="([^"]+)"/)[1];
const oldWord = [...read('../../assets/logo-lockup.svg').matchAll(/<path d="([^"]+)"/g)][1][1];
const letters = JSON.parse(read('wordmark.json')).letters.map(({ ch, x, w, d }) => ({ ch, x, w, d }));
const icon = fs.readFileSync(new URL('../../assets/icon-1024.png', import.meta.url)).toString('base64');

const out = read('identity.template.html')
  .split('__MARK__').join(mark)
  .replace('__WORD_OLD__', oldWord)
  .replace('__WORD_NEW__', letters.map((l) => l.d).join(''))
  .replace('__ICON_B64__', icon)
  .replace('__LETTERS__', JSON.stringify(letters));
const left = out.match(/__[A-Z0-9_]+__/);
if (left) throw new Error(`placeholder left: ${left[0]}`);
fs.writeFileSync(new URL('axonix-identity.html', import.meta.url), out);
console.log(`axonix-identity.html: ${out.length} bytes`);
