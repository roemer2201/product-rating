import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCaptures, enqueueCapture, listCaptures } from '@/lib/offlineQueue';
import { captureOwner } from '@/lib/captureIdentity';
import { TEST_EAN } from '@/testing/fixtures';

/**
 * How the queue stores, rather than what it stores — the resolution of a
 * capture is `sync.test.ts`.
 *
 * The point of these tests is durability. A queue that reports a capture as
 * kept and then loses it is worse than one that refuses to take it, because
 * the person walks out of the shop believing the work is done. The case that
 * produced this file: an iOS home screen app swiped out of the app switcher is
 * killed on the spot, and everything that had not committed yet went with it.
 */

beforeEach(async () => {
  await clearCaptures();
});

afterEach(async () => {
  await clearCaptures();
  vi.restoreAllMocks();
});

describe('writing', () => {
  it('reports a capture as saved only once its transaction has committed', async () => {
    const order: string[] = [];

    const open = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const transaction = open.apply(this, args);
      if (args[1] === 'readwrite') {
        transaction.addEventListener('complete', () => order.push('committed'));
      }
      return transaction;
    });

    await enqueueCapture({ ean: TEST_EAN, label: 'Apfelsaft' });
    order.push('resolved');

    // The other way round is the bug: `request.onsuccess` fires while the
    // transaction is still open, so the interface counts a capture that a kill
    // a moment later would take with it.
    expect(order).toEqual(['committed', 'resolved']);
  });

  it('survives being read back through a new connection', async () => {
    await enqueueCapture({ ean: TEST_EAN, label: 'Apfelsaft' });

    const waiting = await listCaptures();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.label).toBe('Apfelsaft');
    expect(waiting[0]?.state).toBe('pending');
  });
});

describe('persistent storage', () => {
  /** A fresh module, because the request is made once per session. */
  async function freshQueue() {
    vi.resetModules();
    return import('@/lib/offlineQueue');
  }

  it('asks for persistence when the first capture is written', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('navigator', { ...navigator, storage: { persist, persisted } });

    const queue = await freshQueue();
    await queue.enqueueCapture({ ean: TEST_EAN, label: 'Apfelsaft' });
    await queue.requestPersistentStorage();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when the storage is already persistent', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { ...navigator, storage: { persist, persisted } });

    const queue = await freshQueue();
    expect(await queue.requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('carries on where the browser has no storage manager', async () => {
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });

    const queue = await freshQueue();
    expect(await queue.requestPersistentStorage()).toBe(false);
    await expect(
      queue.enqueueCapture({ ean: TEST_EAN, label: 'Apfelsaft' }),
    ).resolves.toBeDefined();
  });
});

describe('upgrading the database', () => {
  it('keeps what version 1 queued when it adds the store for photo replacements', async () => {
    const name = 'product-rating-offline';
    // The connection this module holds closes itself on the version change.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('captures', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('captures', 'readwrite');
        transaction.objectStore('captures').put({
          id: 'from-version-1',
          ownerId: captureOwner(),
          ean: TEST_EAN,
          label: 'vor dem Update',
          createdAt: 1,
          updatedAt: 1,
          state: 'pending',
          attempts: 0,
          lastError: null,
          product: null,
          rating: null,
          price: null,
          photos: [],
          progress: { productId: null, rating: false, price: false, photos: 0 },
          conflict: null,
        });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      request.onerror = () => reject(request.error);
    });

    vi.resetModules();
    const upgraded = await import('@/lib/offlineQueue');

    expect((await upgraded.listCaptures()).map((entry) => entry.label)).toEqual(['vor dem Update']);
    expect(await upgraded.listPhotoReplacements()).toEqual([]);
  });
});
