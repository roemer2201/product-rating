import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Setup for the web tests: the `jest-dom` matchers, a torn down DOM and a
 * `fetch` that is its own again after every test. Without the cleanup, queries
 * of the next test would find the markup of the previous one.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
