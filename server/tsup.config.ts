import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/migrate.ts', 'src/fsck.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // The shared workspace ships TypeScript sources, so it has to be bundled in.
  // Runtime dependencies stay external and are installed alongside the bundle.
  noExternal: ['@product-rating/shared'],
  // The generated SQL is read from disk at runtime, so it has to travel with
  // the bundle. `migrationsFolder()` looks for `dist/migrations` first.
  onSuccess: async () => {
    cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
  },
});
