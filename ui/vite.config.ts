import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // shadcn generates components that import from '@/...'
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  // Tauri surfaces build errors better with a fixed port and no auto-open.
  clearScreen: false,
  server: {
    port: 5273,
    strictPort: true,
    // Proxying keeps every request same-origin: no CORS preflight, and the bearer
    // token is only ever an Authorization header, never a query parameter.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      // Dev-only stand-in for the desktop app's `fetch_ibja_rates` command:
      // IBJA sends no CORS headers, so the browser cannot fetch it directly.
      '/ibja': {
        target: 'https://ibjarates.com',
        changeOrigin: true,
        rewrite: () => '/',
      },
    },
  },
  build: {
    target: 'chrome120',
    sourcemap: false,
  },
});
