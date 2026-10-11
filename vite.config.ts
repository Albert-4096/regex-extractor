import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', sourcemap: false },
  worker: { format: 'es' },
  plugins: [
    {
      // The dev server needs a WebSocket for HMR, which the production CSP forbids.
      name: 'dev-no-csp',
      apply: 'serve',
      transformIndexHtml: (html: string) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''),
    },
  ],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
