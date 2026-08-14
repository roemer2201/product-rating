import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
    },
  },
  test: {
    include: ['{shared,server,web}/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['{shared,server,web}/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'web/src/main.tsx'],
    },
  },
});
