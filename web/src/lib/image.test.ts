import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_MAX_EDGE, preparePhoto } from './image.js';

/**
 * Shrinking before the upload. Every path through this module has to end with a
 * usable blob: the optimisation is a courtesy, and a browser that cannot decode
 * the picture must cost the wait, never the photo.
 */

/** A file of a given size; the content does not matter, only the byte count. */
function fakeFile(name: string, bytes: number, type = 'image/jpeg'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Stands in for `createImageBitmap`, which jsdom does not implement. */
function stubBitmap(width: number, height: number): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve({ width, height, close: vi.fn() })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preparePhoto', () => {
  it('sends a small file as it is', async () => {
    const file = fakeFile('klein.jpg', 100 * 1024);
    stubBitmap(4000, 3000);

    const prepared = await preparePhoto(file);

    expect(prepared.reduced).toBe(false);
    expect(prepared.blob).toBe(file);
    // Not worth decoding a file that is already small.
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('keeps the original when the browser cannot decode it', async () => {
    // An iPhone HEIC in a browser that is not Safari.
    const file = fakeFile('IMG_4711.HEIC', 4 * 1024 * 1024, 'image/heic');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('unsupported image type'))),
    );

    const prepared = await preparePhoto(file);

    expect(prepared.reduced).toBe(false);
    expect(prepared.blob).toBe(file);
    expect(prepared.filename).toBe('IMG_4711.HEIC');
  });

  it('keeps the original when it is already small enough in pixels', async () => {
    const file = fakeFile('gross-aber-klein.jpg', 2 * 1024 * 1024);
    stubBitmap(1600, 1200);

    const prepared = await preparePhoto(file);

    expect(prepared.reduced).toBe(false);
  });

  it('re-encodes a large picture as a JPEG and says so', async () => {
    const file = fakeFile('IMG_0815.HEIC', 4 * 1024 * 1024, 'image/heic');
    stubBitmap(4032, 3024);

    const drawImage = vi.fn();
    const smaller = new Blob([new Uint8Array(200 * 1024)], { type: 'image/jpeg' });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(smaller);
    });

    const prepared = await preparePhoto(file);

    expect(prepared.reduced).toBe(true);
    expect(prepared.blob).toBe(smaller);
    // The extension follows the content, since the content is now a JPEG.
    expect(prepared.filename).toBe('IMG_0815.jpg');
    expect(prepared.originalBytes).toBe(file.size);
    expect(drawImage).toHaveBeenCalledTimes(1);

    // The longest edge lands on the limit, the shorter one keeps the ratio.
    const [, , , width, height] = drawImage.mock.calls[0] as number[];
    expect(width).toBe(UPLOAD_MAX_EDGE);
    expect(height).toBe(Math.round((3024 / 4032) * UPLOAD_MAX_EDGE));
  });

  it('keeps the original when re-encoding would make it bigger', async () => {
    const file = fakeFile('schon-optimal.jpg', 1024 * 1024);
    stubBitmap(4032, 3024);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/jpeg' }));
    });

    const prepared = await preparePhoto(file);

    expect(prepared.reduced).toBe(false);
    expect(prepared.blob).toBe(file);
  });

  it('survives a canvas that refuses to encode', async () => {
    const file = fakeFile('kaputt.jpg', 4 * 1024 * 1024);
    stubBitmap(4032, 3024);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(null);
    });

    const prepared = await preparePhoto(file);

    expect(prepared.reduced).toBe(false);
    expect(prepared.blob).toBe(file);
  });
});
