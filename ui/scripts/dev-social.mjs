/**
 * Run Axonix Social against the Vite dev server (hot reload for the dock).
 *
 *   pnpm social:dev
 *
 * Uses its own profile ("Axonix Social (dev)") and its own Credential Manager
 * entries, so development never touches real sign-ins or sessions.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createServer } from 'vite';
import { compileBlocklist } from './blocklist.mjs';

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ui, 'package.json'));
const out = path.join(ui, 'dist-social-dev');
const url = 'http://localhost:5274/social.html';

await build({
  entryPoints: {
    main: path.join(ui, 'electron/main.ts'),
    'preload-host': path.join(ui, 'electron/preload-host.ts'),
    'preload-guest': path.join(ui, 'electron/preload-guest.ts'),
    'preload-chrome': path.join(ui, 'electron/preload-chrome.ts'),
  },
  outdir: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', '@napi-rs/keyring'],
  logLevel: 'warning',
});
// ui/package.json says "type": "module"; the bundles are CommonJS.
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }));
compileBlocklist(out);

const vite = await createServer({ configFile: path.join(ui, 'vite.social.config.ts'), root: ui });
await vite.listen();

const electron = spawn(require('electron'), [path.join(out, 'main.js'), ...process.argv.slice(2)], {
  cwd: ui,
  stdio: 'inherit',
  env: { ...process.env, AXONIX_SOCIAL_DEV: '1', AXONIX_SOCIAL_DEV_URL: url, NODE_PATH: path.join(ui, 'node_modules') },
});
electron.on('exit', () => {
  void vite.close().then(() => process.exit(0));
});
