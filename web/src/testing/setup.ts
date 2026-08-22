import '@testing-library/jest-dom/vitest';
// jsdom has no IndexedDB, and the offline queue is read by every screen that
// shows what is waiting. An in-memory implementation is closer to the truth
// than a stub that answers nothing.
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { clearCaptures } from '@/lib/offlineQueue';
import { restoreOnline } from '@/testing/online';
import { resetRegisterSWMock } from '@/testing/pwaRegister';

/**
 * Setup for the web tests: the `jest-dom` matchers, a torn down DOM, a `fetch`
 * that is its own again after every test, an empty offline queue, and the same
 * for the two browser facts a test may pretend to change — the network status
 * and the state of the service worker. Without the cleanup, queries of the next
 * test would find the markup of the previous one.
 */

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  restoreOnline();
  resetRegisterSWMock();
  // The queue outlives a test otherwise: it is a database, not a render.
  await clearCaptures();
});
