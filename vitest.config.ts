import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, because the two halves of the repository need different
 * environments: server and shared run against Node, the web client needs a DOM.
 * Coverage is collected across both from here.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['{shared,server}/src/**/*.test.ts'],
          environment: 'node',
          restoreMocks: true,
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./web/src', import.meta.url)),
          },
        },
        test: {
          name: 'web',
          include: ['web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./web/src/testing/setup.ts'],
          restoreMocks: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['{shared,server,web}/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'web/src/main.tsx', 'web/src/testing/**'],
    },
  },
});
