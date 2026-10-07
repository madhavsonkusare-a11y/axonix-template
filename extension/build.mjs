// Bundle the extension into dist/. Chrome MV3 content scripts cannot use ESM
// imports, so defuddle has to be bundled into content.js rather than loaded.

import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const out = 'dist';
const watch = process.argv.includes('--watch');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const opts = {
  entryPoints: ['src/content.js', 'src/background.js', 'src/popup.js', 'src/options.js'],
  outdir: out,
  bundle: true,
  format: 'esm',
  target: ['chrome120'],
  platform: 'browser',
  // Readable output keeps the extension auditable — it runs on every page you clip.
  minify: false,
  // Inline sourcemaps roughly triple content.js, and that bundle is injected into
  // the page on every clip. Dev builds only.
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

async function copyStatic() {
  await cp('manifest.json', `${out}/manifest.json`);
  for (const f of ['popup.html', 'options.html', 'ui.css']) {
    await cp(`src/${f}`, `${out}/${f}`);
  }
  // Chrome refuses to load an extension whose manifest names a missing icon, so
  // this copy is load-bearing, not cosmetic. Run `pnpm run icons` if absent.
  await cp('icons', `${out}/icons`, { recursive: true });
}

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  await copyStatic();
  console.log('watching…');
} else {
  await esbuild.build(opts);
  await copyStatic();
  console.log(`built → ${out}/`);
}
