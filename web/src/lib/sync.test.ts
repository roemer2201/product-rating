import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCaptures, enqueueCapture, listCaptures, type Capture } from '@/lib/offlineQueue';
import { discardCapturedRating, keepCapturedRating, syncCaptures } from '@/lib/sync';
import { mockFetch } from '@/testing/fetchMock';
import { makeProductDetail, makeRating, TEST_EAN } from '@/testing/fixtures';

/**
 * The offline queue and what happens to it when the connection comes back.
 *
 * The interesting part is not the storing — it is the resolution: a capture is
 * an intention ("this article, these stars"), and this is where it becomes
 * either a new product or an addition to one that already exists, or a question
 * to the person who made it.
 */

const PRODUCT = makeProductDetail({ id: 'prod-1', ean: TEST_EAN });

const CAPTURED_AT = Date.parse('2026-08-20T10:00:00.000Z');

/** A capture as the rating editor would leave one behind. */
async function captureRating(stars = 4): Promise<Capture> {
  return enqueueCapture({
    ean: TEST_EAN,
    label: 'Apfelsaft',
    rating: { stars, comment: 'am Regal', capturedAt: CAPTURED_AT },
  });
}

beforeEach(async () => {
  await clearCaptures();
});

afterEach(async () => {
  await clearCaptures();
});

describe('the queue', () => {
  it('keeps captures in the order they were made', async () => {
    await enqueueCapture({ ean: TEST_EAN, label: 'erst' });
    await enqueueCapture({ ean: '4006381333931', label: 'dann' });

    expect((await listCaptures()).map((entry) => entry.label)).toEqual(['erst', 'dann']);
  });

  it('takes a picture along with the capture', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
    await enqueueCapture({
      ean: TEST_EAN,
      label: 'mit Bild',
      photos: [{ blob, filename: 'regal.webp' }],
    });

    const stored = (await listCaptures())[0];
    expect(stored?.photos).toHaveLength(1);
    expect(stored?.photos[0]?.filename).toBe('regal.webp');
    // That the bytes survive is a guarantee of IndexedDB, not of this code:
    // the in-memory double used here hands a `Blob` back as a plain object,
    // so the size cannot be asserted. TODO M9 checks it on a real device.
  });
});

describe('syncing a capture', () => {
  it('adds the rating to a product that exists by now', async () => {
    await captureRating(5);
    const fetchMock = mockFetch([
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: PRODUCT } },
      { path: '/products/prod-1', body: { product: PRODUCT } },
      {
        path: '/products/prod-1/rating',
        method: 'PUT',
        body: { rating: makeRating(), ratings: {} },
      },
    ]);

    const result = await syncCaptures();

    expect(result).toMatchObject({ synced: 1, conflicts: 0, failed: 0 });
    expect(await listCaptures()).toEqual([]);

    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
      stars: 5,
      comment: 'am Regal',
    });
  });

  it('creates the product when the EAN is still unknown', async () => {
    await enqueueCapture({
      ean: TEST_EAN,
      label: 'Apfelsaft',
      product: { name: 'Apfelsaft', brand: 'Bio Hof', category: null, notes: null },
    });

    const fetchMock = mockFetch([
      {
        path: `/products/by-ean/${TEST_EAN}`,
        status: 404,
        body: { error: { code: 'not_found' } },
      },
      { path: '/products', method: 'POST', body: { product: PRODUCT, restored: false } },
    ]);

    const result = await syncCaptures();

    expect(result.synced).toBe(1);
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
      ean: TEST_EAN,
      name: 'Apfelsaft',
    });
  });

  it('adopts the product somebody else created in the meantime', async () => {
    await enqueueCapture({
      ean: TEST_EAN,
      label: 'Apfelsaft',
      product: { name: 'Apfelsaft vom Regal', brand: null, category: null, notes: null },
      price: { cents: 199, shop: 'Bioladen', note: null, purchasedAt: '2026-08-20' },
    });

    const fetchMock = mockFetch([
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: PRODUCT } },
      { path: '/products/prod-1/prices', method: 'POST', body: { price: {} } },
    ]);

    const result = await syncCaptures();

    expect(result.synced).toBe(1);
    // The catalogue entry that was already there is left alone; only what the
    // capture adds goes up.
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/products') && (init as RequestInit)?.method === 'POST',
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/products/prod-1/prices')),
    ).toBe(true);
  });

  it('asks instead of overwriting a verdict that changed in the meantime', async () => {
    await captureRating(2);

    mockFetch([
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: PRODUCT } },
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            id: 'prod-1',
            ean: TEST_EAN,
            // Rated on another device after the capture was written down.
            ownRating: makeRating({ stars: 5, updatedAt: '2026-08-21T09:00:00.000Z' }),
          }),
        },
      },
    ]);

    const result = await syncCaptures();

    expect(result).toMatchObject({ synced: 0, conflicts: 1 });
    const waiting = (await listCaptures())[0];
    expect(waiting?.state).toBe('conflict');
    expect(waiting?.conflict).toMatchObject({ serverStars: 5 });
  });

  it('keeps the older verdict when the server one is not newer', async () => {
    await captureRating(2);

    mockFetch([
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: PRODUCT } },
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            id: 'prod-1',
            ean: TEST_EAN,
            ownRating: makeRating({ stars: 5, updatedAt: '2026-08-19T09:00:00.000Z' }),
          }),
        },
      },
      {
        path: '/products/prod-1/rating',
        method: 'PUT',
        body: { rating: makeRating(), ratings: {} },
      },
    ]);

    expect((await syncCaptures()).synced).toBe(1);
  });

  it('stays in the queue when the connection is still gone', async () => {
    await captureRating();
    mockFetch([{ path: `/products/by-ean/${TEST_EAN}`, networkError: true }]);

    const result = await syncCaptures();

    expect(result).toMatchObject({ synced: 0, pending: 1 });
    const waiting = (await listCaptures())[0];
    expect(waiting?.state).toBe('pending');
    expect(waiting?.attempts).toBe(1);
  });

  it('marks a capture the server refuses, with the reason on it', async () => {
    await captureRating();
    mockFetch([
      // The product was deleted while the phone was away, and the capture
      // carries no product data to recreate it with.
      { path: `/products/by-ean/${TEST_EAN}`, status: 404, body: { error: { code: 'not_found' } } },
    ]);

    const result = await syncCaptures();

    expect(result.failed).toBe(1);
    const waiting = (await listCaptures())[0];
    expect(waiting?.state).toBe('failed');
    expect(waiting?.lastError).toContain('does not exist');
  });

  it('does not send a price twice when the upload after it failed', async () => {
    await enqueueCapture({
      ean: TEST_EAN,
      label: 'Apfelsaft',
      price: { cents: 199, shop: null, note: null, purchasedAt: '2026-08-20' },
      photos: [{ blob: new Blob([new Uint8Array([1])]), filename: 'a.webp' }],
    });

    // The photo upload goes through XHR, which is not stubbed here, so it
    // fails — exactly the half applied capture this is about.
    const first = mockFetch([
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: PRODUCT } },
      { path: '/products/prod-1/prices', method: 'POST', body: { price: {} } },
    ]);
    await syncCaptures();

    const priceCalls = (calls: typeof first.mock.calls): number =>
      calls.filter(([url]) => String(url).includes('/prices')).length;
    expect(priceCalls(first.mock.calls)).toBe(1);

    const second = mockFetch([
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: PRODUCT } },
      { path: '/products/prod-1/prices', method: 'POST', body: { price: {} } },
    ]);
    await syncCaptures();

    // The second run picks up at the photo; the price is already up.
    expect(priceCalls(second.mock.calls)).toBe(0);
  });
});

describe('resolving a conflict', () => {
  async function conflicted(): Promise<Capture> {
    await captureRating(2);
    mockFetch([
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: PRODUCT } },
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            id: 'prod-1',
            ean: TEST_EAN,
            ownRating: makeRating({ stars: 5, updatedAt: '2026-08-21T09:00:00.000Z' }),
          }),
        },
      },
    ]);
    await syncCaptures();

    const capture = (await listCaptures())[0];
    if (capture === undefined) throw new Error('expected a conflicted capture');
    return capture;
  }

  it('pushes the captured verdict when that is the decision', async () => {
    const capture = await conflicted();
    await keepCapturedRating(capture);

    const fetchMock = mockFetch([
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: PRODUCT } },
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            id: 'prod-1',
            ean: TEST_EAN,
            ownRating: makeRating({ stars: 5, updatedAt: '2026-08-21T09:00:00.000Z' }),
          }),
        },
      },
      {
        path: '/products/prod-1/rating',
        method: 'PUT',
        body: { rating: makeRating(), ratings: {} },
      },
    ]);

    expect((await syncCaptures()).synced).toBe(1);
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toMatchObject({ stars: 2 });
    expect(await listCaptures()).toEqual([]);
  });

  it('drops the capture when the server verdict wins and nothing else is left', async () => {
    const capture = await conflicted();
    await discardCapturedRating(capture);

    expect(await listCaptures()).toEqual([]);
  });
});
