import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // The shared workspace ships TypeScript sources, so it has to be bundled in.
  // Runtime dependencies stay external and are installed alongside the bundle.
  noExternal: ['@product-rating/shared'],
});
