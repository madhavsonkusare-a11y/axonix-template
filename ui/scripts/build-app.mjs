/**
 * Build the unified Axonix desktop app (Electron).
 *
 *   node scripts/build-app.mjs
 *
 * 1. Type-checks the Electron main process and preloads.
 * 2. Builds the unified frontend (Home, Finance, Social) with Vite → dist-app/renderer
 * 3. Bundles the main process and preloads with esbuild → dist-app/*.js
 * 4. Compiles the tracker blocklist → dist-app/easyprivacy.bin
 * 5. Adds native @napi-rs/keyring module for Windows Credential Manager, and
 *    node-pty (the console behind Claude's terminal tab)
 * 6. Packages with @electron/packager → <cargo target>\release\Axonix\
 *
 * Touches no user data (%LOCALAPPDATA%\Axonix\finance-data.json).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { packager } from '@electron/packager';
import { compileBlocklist } from './blocklist.mjs';

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ui, 'dist-app');
const release = path.resolve(process.env.CARGO_TARGET_DIR ?? 'D:/06 Projects/_build/cargo-target/axonix', 'release');
const dest = path.join(release, 'Axonix');
const require = createRequire(path.join(ui, 'package.json'));
const pkg = JSON.parse(fs.readFileSync(path.join(ui, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(require.resolve('electron/package.json'), 'utf8')).version;

const step = (text) => console.log(`\n==> ${text}`);

step('Type-checking the main process and preloads');
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.electron.json'], { cwd: ui, stdio: 'inherit' });

step('Building the unified renderer (Home, Finance, Social)');
fs.rmSync(out, { recursive: true, force: true });
await viteBuild({
  configFile: path.join(ui, 'vite.config.ts'),
  root: ui,
  logLevel: 'warn',
  build: {
    outDir: path.join(out, 'renderer'),
    emptyOutDir: true,
  },
});

step('Bundling the main process and preloads');
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
  external: ['electron', '@napi-rs/keyring', '@lydell/node-pty'],
  logLevel: 'warning',
});

step('Compiling the tracker blocklist');
compileBlocklist(out);

step('Adding the native keyring module');
for (const name of ['@napi-rs/keyring', '@napi-rs/keyring-win32-x64-msvc']) {
  const from = path.dirname(require.resolve(`${name}/package.json`, { paths: [path.dirname(require.resolve('@napi-rs/keyring'))] }));
  fs.cpSync(from, path.join(out, 'node_modules', name), { recursive: true, dereference: true });
}
// node-pty: its loader, and the Windows build beside it (pnpm keeps them as siblings).
// It starts helper programs of its own, so it cannot run from inside the archive.
const ptyDir = path.dirname(require.resolve('@lydell/node-pty'));
for (const name of ['node-pty', 'node-pty-win32-x64']) {
  fs.cpSync(path.join(ptyDir, '..', name), path.join(out, 'node_modules', '@lydell', name), { recursive: true, dereference: true });
}
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify({ name: 'axonix', productName: 'Axonix', version: pkg.version, main: 'main.js', private: true }, null, 2),
);
fs.copyFileSync(path.join(ui, 'electron/icon.ico'), path.join(out, 'icon.ico'));

// Preserve the source and license notices for the integrated AFFiNE editor.
const notices = path.join(out, 'third-party-notices');
fs.mkdirSync(notices, { recursive: true });
const themeLicense = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.resolve('@toeverything/theme')))), 'LICENSE');
for (const name of ['@blocksuite/blocks', '@blocksuite/presets', '@blocksuite/store', '@toeverything/theme']) {
  // BlockSuite exports ESM only, so resolve through this ESM build script.
  let folder = path.dirname(fileURLToPath(import.meta.resolve(name)));
  while (!fs.existsSync(path.join(folder, 'package.json')) && path.dirname(folder) !== folder) folder = path.dirname(folder);
  const license = path.join(folder, 'LICENSE');
  fs.copyFileSync(fs.existsSync(license) ? license : themeLicense, path.join(notices, name.replaceAll('/', '-') + '-LICENSE.txt'));
}
fs.copyFileSync(path.join(ui, '../docs/notes-v2-open-source.md'), path.join(notices, 'Notes-v2.md'));

step(`Packaging with Electron ${electronVersion}`);
const staging = path.join(ui, 'dist-app-pack');
fs.rmSync(staging, { recursive: true, force: true });
const [appDir] = await packager({
  dir: out,
  out: staging,
  name: 'Axonix',
  executableName: 'Axonix',
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  appVersion: pkg.version,
  icon: path.join(out, 'icon.ico'),
  asar: { unpack: '**/*.node', unpackDir: 'node_modules/@lydell' },
  prune: false,
  overwrite: true,
  quiet: true,
  win32metadata: { CompanyName: 'Axonix', FileDescription: 'Axonix', ProductName: 'Axonix', InternalName: 'Axonix' },
});

step(`Installing to ${dest}`);
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(release, { recursive: true });
fs.cpSync(appDir, dest, { recursive: true });
fs.rmSync(staging, { recursive: true, force: true });

console.log(`\nBuilt Axonix ${pkg.version} (Electron ${electronVersion})\nEXE ${path.join(dest, 'Axonix.exe')}`);
