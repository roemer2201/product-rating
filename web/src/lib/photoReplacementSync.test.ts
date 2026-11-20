import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmCaptureOwner } from '@/lib/captureIdentity';
import { api, ApiError } from '@/lib/api';
import {
  enqueueCapture,
  enqueuePhotoReplacement,
  listCaptures,
  listPhotoReplacements,
  removePhotoReplacementIfCurrent,
  updatePhotoReplacementIfCurrent,
  type PhotoReplacement,
} from '@/lib/offlineQueue';
import { addReplacementAsNewPhoto, retryPhotoReplacement, syncCaptures } from '@/lib/sync';
import { testUser } from '@/testing/fetchMock';
import { makePhoto, TEST_EAN } from '@/testing/fixtures';

/**
 * Edited gallery photos that waited for a connection. They ride along in the
 * same sync run as the captures, after them, with the same rules: a broken
 * connection waits, a refusal stays visible, and a photo that is gone by now
 * turns into a question rather than an error.
 */

const NETWORK = () => new ApiError({ status: 0, code: 'network_error' });

function keep(photoId = 'photo-1', filename = 'produktfoto.jpg'): Promise<PhotoReplacement> {
  return enqueuePhotoReplacement({
    photoId,
    productId: 'prod-1',
    label: 'Apfelsaft',
    blob: new Blob(['edited'], { type: 'image/jpeg' }),
    filename,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the photo replacement queue', () => {
  it('keeps one edit per photo, the newer one in place of the older', async () => {
    await keep('photo-1', 'first.jpg');
    await keep('photo-2');
    await keep('photo-1', 'second.jpg');

    // The bytes cannot be compared here: the in-memory IndexedDB double hands
    // a `Blob` back as a plain object. The file name tells the edits apart.
    const waiting = await listPhotoReplacements();
    expect(waiting.map((entry) => [entry.photoId, entry.filename])).toEqual([
      ['photo-2', 'produktfoto.jpg'],
      ['photo-1', 'second.jpg'],
    ]);
  });

  it('does not remove or change a newer edit using an older edit generation', async () => {
    const older = await keep('photo-1', 'first.jpg');
    const newer = await keep('photo-1', 'second.jpg');

    expect(await removePhotoReplacementIfCurrent(older)).toBe(false);
    expect(
      await updatePhotoReplacementIfCurrent(older, {
        state: 'conflict',
        lastError: 'old error',
      }),
    ).toBe(false);
    expect(await listPhotoReplacements()).toMatchObject([
      { revision: newer.revision, filename: 'second.jpg', state: 'pending', lastError: null },
    ]);
  });

  it('belongs to the account that made the edit', async () => {
    await keep();
    confirmCaptureOwner('someone-else');
    expect(await listPhotoReplacements()).toEqual([]);
  });
});

describe('sending photo replacements', () => {
  it('replaces the photo as the account that edited it and leaves the queue', async () => {
    await keep();
    const replace = vi.spyOn(api.photos, 'replace').mockResolvedValue({ photo: makePhoto() });

    expect(await syncCaptures()).toMatchObject({ synced: 1, pending: 0 });
    expect(replace).toHaveBeenCalledWith('photo-1', expect.anything(), 'produktfoto.jpg', {
      expectedUserId: testUser.id,
    });
    expect(await listPhotoReplacements()).toEqual([]);
  });

  it('preserves a newer edit queued while the older replacement is uploading', async () => {
    await keep('photo-1', 'first.jpg');
    let finish: ((response: { photo: ReturnType<typeof makePhoto> }) => void) | undefined;
    const replace = vi.spyOn(api.photos, 'replace').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const sending = syncCaptures();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const newer = await keep('photo-1', 'second.jpg');

    finish!({ photo: makePhoto() });
    expect((await sending).synced).toBe(1);
    expect(await listPhotoReplacements()).toMatchObject([
      { revision: newer.revision, filename: 'second.jpg', state: 'pending' },
    ]);
  });

  it('does not mark a newer edit as conflicted when an older upload gets 404', async () => {
    await keep('photo-1', 'first.jpg');
    let fail: ((error: unknown) => void) | undefined;
    const replace = vi.spyOn(api.photos, 'replace').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );

    const sending = syncCaptures();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const newer = await keep('photo-1', 'second.jpg');

    fail!(new ApiError({ status: 404, code: 'not_found' }));
    expect((await sending).conflicts).toBe(1);
    expect(await listPhotoReplacements()).toMatchObject([
      { revision: newer.revision, filename: 'second.jpg', state: 'pending' },
    ]);
  });

  it('waits for the next run when the connection is gone', async () => {
    await keep();
    vi.spyOn(api.photos, 'replace').mockRejectedValue(NETWORK());

    expect(await syncCaptures()).toMatchObject({ synced: 0, pending: 1 });
    expect(await listPhotoReplacements()).toMatchObject([
      { state: 'pending', attempts: 1, lastError: expect.any(String) },
    ]);
  });

  it('is not tried once the captures before it found no connection', async () => {
    await enqueueCapture({ ean: TEST_EAN, label: 'Apfelsaft' });
    await keep();
    vi.spyOn(api.products, 'byEan').mockRejectedValue(NETWORK());
    const replace = vi.spyOn(api.photos, 'replace');

    expect((await syncCaptures()).pending).toBe(1);
    expect(replace).not.toHaveBeenCalled();
    expect(await listCaptures()).toHaveLength(1);
    expect(await listPhotoReplacements()).toHaveLength(1);
  });

  it('asks when the photo is gone, and adds the picture as a new photo if told to', async () => {
    await keep();
    vi.spyOn(api.photos, 'replace').mockRejectedValue(
      new ApiError({ status: 404, code: 'not_found' }),
    );

    expect((await syncCaptures()).conflicts).toBe(1);
    const [conflict] = await listPhotoReplacements();
    expect(conflict).toMatchObject({ state: 'conflict', lastError: null });

    await addReplacementAsNewPhoto(conflict!);
    const upload = vi.spyOn(api.photos, 'upload').mockResolvedValue({ photo: makePhoto() });

    expect((await syncCaptures()).synced).toBe(1);
    expect(upload).toHaveBeenCalledWith('prod-1', expect.anything(), {
      filename: 'produktfoto.jpg',
      expectedUserId: testUser.id,
    });
    expect(await listPhotoReplacements()).toEqual([]);
  });

  it('keeps a refused edit with the reason until somebody retries it', async () => {
    await keep();
    vi.spyOn(api.photos, 'replace').mockRejectedValueOnce(
      new ApiError({ status: 403, code: 'forbidden' }),
    );

    expect((await syncCaptures()).failed).toBe(1);
    const [refused] = await listPhotoReplacements();
    expect(refused).toMatchObject({ state: 'failed', attempts: 1 });
    expect(refused?.lastError).not.toBeNull();

    // A second run leaves it alone: the same request would get the same answer.
    expect((await syncCaptures()).failed).toBe(1);

    await retryPhotoReplacement(refused!);
    vi.spyOn(api.photos, 'replace').mockResolvedValue({ photo: makePhoto() });
    expect((await syncCaptures()).synced).toBe(1);
  });

  it('sends nothing of another account', async () => {
    await keep();
    confirmCaptureOwner('someone-else');
    const replace = vi.spyOn(api.photos, 'replace');

    expect(await syncCaptures()).toMatchObject({ synced: 0, pending: 0 });
    expect(replace).not.toHaveBeenCalled();
  });
});
