import { confirmCaptureOwner } from '@/lib/captureIdentity';
import { testUser } from '@/testing/fetchMock';
import '@testing-library/jest-dom/vitest';
// jsdom has no IndexedDB, and the offline queue is read by every screen that
// shows what is waiting. An in-memory implementation is closer to the truth
// than a stub that answers nothing.
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { beforeEach, afterEach, vi } from 'vitest';
import { APPEARANCE_STORAGE_KEY } from '@/lib/appearance';
import { clearCaptures } from '@/lib/offlineQueue';
import { restoreOnline } from '@/testing/online';
import { resetRegisterSWMock } from '@/testing/pwaRegister';

/**
 * Setup for the web tests: the `jest-dom` matchers, a torn down DOM, a `fetch`
 * that is its own again after every test, an empty offline queue, a document
 * without a chosen appearance, and the same for the two browser facts a test
 * may pretend to change — the network status and the state of the service
 * worker. Without the cleanup, queries of the next test would find the markup
 * of the previous one.
 */

beforeEach(() => {
  confirmCaptureOwner(testUser.id);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  restoreOnline();
  resetRegisterSWMock();
  // The queue outlives a test otherwise: it is a database, not a render.
  await clearCaptures();
  // So does the appearance: it sits on `<html>`, which no render replaces, and
  // in the storage of the browser.
  for (const key of ['layout', 'scheme', 'palette']) {
    Reflect.deleteProperty(document.documentElement.dataset, key);
  }
  localStorage.removeItem(APPEARANCE_STORAGE_KEY);
});
