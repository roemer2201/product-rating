import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { restoreOnline } from '@/testing/online';
import { resetRegisterSWMock } from '@/testing/pwaRegister';

/**
 * Setup for the web tests: the `jest-dom` matchers, a torn down DOM, a `fetch`
 * that is its own again after every test, and the same for the two browser
 * facts a test may pretend to change — the network status and the state of the
 * service worker. Without the cleanup, queries of the next test would find the
 * markup of the previous one.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  restoreOnline();
  resetRegisterSWMock();
});
