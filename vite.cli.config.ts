import { defineConfig } from 'vite';

// Bundles src/core (pure TypeScript, no DOM) into one ES module that bin/extract.mjs imports.
export default defineConfig({
  publicDir: false,
  build: {
    lib: { entry: 'src/core/index.ts', formats: ['es'], fileName: () => 'core.mjs' },
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
  },
});
