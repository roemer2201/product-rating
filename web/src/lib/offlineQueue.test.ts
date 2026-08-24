import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCaptures, enqueueCapture, listCaptures } from '@/lib/offlineQueue';
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
