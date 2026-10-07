/**
 * Axonix Social's renderer (the dock). Same sources and tokens as the Tauri
 * UI, separate entry and output — the Tauri build never includes it.
 *
 *   pnpm social:dev     dev server on 5274 (plain browser shows stand-in pages)
 *   pnpm social:build   renderer + main process + packaged app
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Production builds get a strict CSP: the dock page loads nothing remote. Pages live in <webview>s. */
const csp = (): Plugin => ({
  name: 'axonix-social-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="utf-8" />',
      `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'" />`,
    ),
});

export default defineConfig({
  plugins: [react(), csp()],
  base: './',
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  clearScreen: false,
  server: { port: 5274, strictPort: true },
  build: {
    outDir: 'dist-social/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    rollupOptions: { input: path.resolve(import.meta.dirname, 'social.html') },
  },
});
