import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { Photo, ProductDetail, ProductListPage } from '@product-rating/shared';
import { seedDatabase } from '../db/testing.js';
import { photoFilePath, findPhotoById } from '../services/photos.js';
import { createUser } from '../services/users.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/**
 * Photos over HTTP: uploading, promoting, deleting and handing the images out.
 *
 * The interesting part is what the route refuses — a file that is too large, a
 * type that is not an image, someone else's photo, and an anonymous request for
 * a picture.
 */

const PASSWORD = 'a-long-enough-password';
const BOUNDARY = '----producttestboundary';

const EAN = { juice: '4260000000011', oats: '4260000000028' } as const;

let harness: TestApp;
let annaCookie: string;
let bertCookie: string;
let adminCookie: string;
let annaId: string;
let productId: string;
let otherProductId: string;

/** A multipart body with one file part, built by hand so it stays predictable. */
function multipart(
  data: Buffer,
  options: { field?: string; filename?: string; contentType?: string } = {},
): { payload: Buffer; contentType: string } {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="${options.field ?? 'photo'}"; ` +
      `filename="${options.filename ?? 'IMG_0001.JPG'}"\r\n` +
      `Content-Type: ${options.contentType ?? 'image/jpeg'}\r\n\r\n`,
  );

  return {
    payload: Buffer.concat([head, data, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

async function testJpeg(width = 900, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#8b1e3f' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N' } })
    .jpeg()
    .toBuffer();
}

function postPhoto(
  data: Buffer,
  options: {
    cookie?: string;
    product?: string;
    origin?: string;
    field?: string;
    filename?: string;
    contentType?: string;
  } = {},
) {
  const body = multipart(data, options);
  const headers: Record<string, string> = {
    ...writeHeaders(options.cookie ?? annaCookie),
    'content-type': body.contentType,
  };
  if (options.origin !== undefined) headers.origin = options.origin;

  return harness.app.inject({
    method: 'POST',
    url: `/api/v1/products/${options.product ?? productId}/photos`,
    headers,
    payload: body.payload,
  });
}

/** Uploads one photo and returns it, failing the test if that did not work. */
async function uploadPhoto(cookie = annaCookie, product = productId): Promise<Photo> {
  const response = await postPhoto(await testJpeg(), { cookie, product });
  expect(response.statusCode).toBe(201);
  return response.json().photo as Photo;
}

async function readProduct(id = productId, cookie = annaCookie): Promise<ProductDetail> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/products/${id}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json().product as ProductDetail;
}

async function makeUser(username: string, role: 'admin' | 'user' = 'user'): Promise<string> {
  const user = await createUser(harness.app.db, harness.config, {
    username,
    password: PASSWORD,
    role,
  });
  return user.id;
}

async function loginAs(username: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: writeHeaders(),
    payload: { username, password: PASSWORD },
  });
  return sessionCookie(response);
}

beforeEach(async () => {
  harness = await createTestApp({ config: { uploads: { max_file_size_mb: 1 } } });

  annaId = await makeUser('anna');
  await makeUser('bert');
  await makeUser('chef', 'admin');
  annaCookie = await loginAs('anna');
  bertCookie = await loginAs('bert');
  adminCookie = await loginAs('chef');

  const seeded = seedDatabase(harness.app.db, {
    products: [
      { ean: EAN.juice, name: 'Apfelsaft', createdBy: annaId },
      { ean: EAN.oats, name: 'Haferflocken', createdBy: annaId },
    ],
  });
  productId = seeded.products?.[0]?.id ?? '';
  otherProductId = seeded.products?.[1]?.id ?? '';
});

afterEach(async () => {
  await harness.close();
});

describe('uploading a photo', () => {
  it('stores the image and reports it as the primary one', async () => {
    const response = await postPhoto(await testJpeg());

    expect(response.statusCode).toBe(201);
    const photo = response.json().photo as Photo;
    expect(photo.productId).toBe(productId);
    expect(photo.userId).toBe(annaId);
    expect(photo.mime).toBe('image/webp');
    expect(photo.isPrimary).toBe(true);
    expect(photo.width).toBeGreaterThan(0);

    // Nothing of the client's file name or claimed type survives.
    expect(JSON.stringify(photo)).not.toContain('IMG_0001');
    expect(JSON.stringify(photo)).not.toContain('jpeg');
  });

  it('shows up on the product detail and as a thumbnail in the list', async () => {
    const photo = await uploadPhoto();

    const product = await readProduct();
    expect(product.photos.map((entry) => entry.id)).toEqual([photo.id]);
    expect(product.primaryPhotoId).toBe(photo.id);

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { cookie: annaCookie },
    });
    const page = list.json() as ProductListPage;
    expect(page.products.find((entry) => entry.id === productId)?.primaryPhotoId).toBe(photo.id);
    // The other product has no photo and says so.
    expect(page.products.find((entry) => entry.id === otherProductId)?.primaryPhotoId).toBeNull();
  });

  it('refuses a file beyond the configured limit', async () => {
    const tooLarge = Buffer.alloc(harness.config.uploads.max_file_size_mb * 1024 * 1024 + 1024, 7);

    const response = await postPhoto(tooLarge);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('1 MB');
    // Nothing was written for a rejected upload.
    expect(await readProduct().then((product) => product.photos)).toEqual([]);
  });

  it('refuses a type that is not on the whitelist, however it is labelled', async () => {
    const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } })
      .gif()
      .toBuffer();

    const response = await postPhoto(gif, { contentType: 'image/jpeg', filename: 'photo.jpg' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details?.detected).toBe('image/gif');
  });

  it('refuses a file that is not an image', async () => {
    const response = await postPhoto(Buffer.from('<?php echo "hi"; ?>'), {
      contentType: 'image/png',
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a request without a file part', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/photos`,
      headers: {
        ...writeHeaders(annaCookie),
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: Buffer.from(`--${BOUNDARY}--\r\n`),
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers an unknown product with 404', async () => {
    const response = await postPhoto(await testJpeg(), { product: 'does-not-exist' });
    expect(response.statusCode).toBe(404);
  });

  it('refuses anonymous callers and foreign origins', async () => {
    const anonymous = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/photos`,
      headers: { ...writeHeaders(), 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart(await testJpeg()).payload,
    });
    expect(anonymous.statusCode).toBe(401);

    const foreign = await postPhoto(await testJpeg(), { origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
  });
});

describe('the primary photo', () => {
  it('moves to the promoted photo and back', async () => {
    const first = await uploadPhoto(annaCookie);
    const second = await uploadPhoto(bertCookie);

    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/photos/${second.id}/primary`,
      headers: writeHeaders(bertCookie),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json().photo as Photo).isPrimary).toBe(true);

    const product = await readProduct();
    expect(product.primaryPhotoId).toBe(second.id);
    expect(product.photos.filter((entry) => entry.isPrimary).map((entry) => entry.id)).toEqual([
      second.id,
    ]);
    expect(product.photos.map((entry) => entry.id)).toEqual([second.id, first.id]);
  });

  it('is refused for a photo of another account', async () => {
    const theirs = await uploadPhoto(bertCookie);

    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/photos/${theirs.id}/primary`,
      headers: writeHeaders(annaCookie),
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('the order of the gallery', () => {
  it('moves a photo and answers with the whole gallery', async () => {
    const first = await uploadPhoto(annaCookie);
    const second = await uploadPhoto(annaCookie);
    const third = await uploadPhoto(annaCookie);

    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/photos/${third.id}/position`,
      headers: writeHeaders(annaCookie),
      payload: { position: 0 },
    });

    expect(response.statusCode).toBe(200);
    const gallery = response.json().photos as Photo[];
    expect(gallery.map((entry) => entry.id)).toEqual([third.id, first.id, second.id]);
    expect(gallery.map((entry) => entry.position)).toEqual([0, 1, 2]);

    const product = await readProduct();
    expect(product.photos.map((entry) => entry.id)).toEqual([third.id, first.id, second.id]);
    expect(product.primaryPhotoId).toBe(third.id);
  });

  it('refuses a photo of another account and a position that is not a number', async () => {
    const theirs = await uploadPhoto(bertCookie);
    const mine = await uploadPhoto(annaCookie);

    const foreign = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/photos/${theirs.id}/position`,
      headers: writeHeaders(annaCookie),
      payload: { position: 0 },
    });
    expect(foreign.statusCode).toBe(403);

    const invalid = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/photos/${mine.id}/position`,
      headers: writeHeaders(annaCookie),
      payload: { position: -1 },
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('deleting a photo', () => {
  it('removes the row and the files from disk', async () => {
    const photo = await uploadPhoto();
    const row = findPhotoById(harness.app.db, photo.id);
    expect(row).toBeDefined();
    if (row === undefined) return;

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/photos/${photo.id}`,
      headers: writeHeaders(annaCookie),
    });

    expect(response.statusCode).toBe(200);
    expect(existsSync(photoFilePath(harness.config, row, 'full'))).toBe(false);
    expect(existsSync(photoFilePath(harness.config, row, 'thumb'))).toBe(false);
    expect((await readProduct()).photos).toEqual([]);
  });

  it('falls back to the next photo instead of leaving the product blank', async () => {
    const first = await uploadPhoto(annaCookie);
    const second = await uploadPhoto(bertCookie);

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/photos/${first.id}`,
      headers: writeHeaders(annaCookie),
    });

    expect((await readProduct()).primaryPhotoId).toBe(second.id);
  });

  it('is refused for a foreign photo but allowed for an administrator', async () => {
    const theirs = await uploadPhoto(bertCookie);

    const foreign = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/photos/${theirs.id}`,
      headers: writeHeaders(annaCookie),
    });
    expect(foreign.statusCode).toBe(403);

    const admin = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/photos/${theirs.id}`,
      headers: writeHeaders(adminCookie),
    });
    expect(admin.statusCode).toBe(200);
  });
});

describe('handing out an image', () => {
  it('serves the detail image and the thumbnail', async () => {
    const photo = await uploadPhoto();

    const full = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
      headers: { cookie: annaCookie },
    });

    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/webp');
    expect(full.headers['cache-control']).toContain('private');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Number(full.headers['content-length'])).toBe(full.rawPayload.length);

    const thumbnail = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}?size=thumb`,
      headers: { cookie: annaCookie },
    });

    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.rawPayload.length).toBeLessThan(full.rawPayload.length);
    // Separate entities, so a cached thumbnail is never served as the detail.
    expect(thumbnail.headers.etag).not.toBe(full.headers.etag);
  });

  it('answers a known ETag with 304 and no body', async () => {
    const photo = await uploadPhoto();
    const first = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
      headers: { cookie: annaCookie },
    });

    const again = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
      headers: { cookie: annaCookie, 'if-none-match': first.headers.etag as string },
    });

    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);
  });

  it('serves a byte range with 206 and rejects one beyond the end', async () => {
    const photo = await uploadPhoto();
    const whole = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
      headers: { cookie: annaCookie },
    });
    const size = whole.rawPayload.length;

    const partial = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
      headers: { cookie: annaCookie, range: 'bytes=0-9' },
    });

    expect(partial.statusCode).toBe(206);
    expect(partial.headers['content-range']).toBe(`bytes 0-9/${size}`);
    expect(partial.rawPayload.length).toBe(10);
    expect(partial.rawPayload).toEqual(whole.rawPayload.subarray(0, 10));

    const tail = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
      headers: { cookie: annaCookie, range: 'bytes=-5' },
    });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload).toEqual(whole.rawPayload.subarray(size - 5));

    const beyond = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
      headers: { cookie: annaCookie, range: `bytes=${size + 10}-` },
    });
    expect(beyond.statusCode).toBe(416);
    expect(beyond.headers['content-range']).toBe(`bytes */${size}`);
  });

  it('is readable by every account, because the catalogue is shared', async () => {
    const photo = await uploadPhoto(annaCookie);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
      headers: { cookie: bertCookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it('refuses anonymous callers and unknown identifiers', async () => {
    const photo = await uploadPhoto();

    const anonymous = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}`,
    });
    expect(anonymous.statusCode).toBe(401);

    const unknown = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/media/does-not-exist',
      headers: { cookie: annaCookie },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('rejects a size it does not know', async () => {
    const photo = await uploadPhoto();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photo.id}?size=huge`,
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('deleting a product', () => {
  it('takes the image files along', async () => {
    const photo = await uploadPhoto(annaCookie);
    const second = await uploadPhoto(bertCookie);
    const rows = [photo.id, second.id].map((id) => findPhotoById(harness.app.db, id));

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productId}`,
      headers: writeHeaders(adminCookie),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().removedPhotos).toBe(2);

    for (const row of rows) {
      expect(row).toBeDefined();
      if (row === undefined) continue;
      expect(existsSync(photoFilePath(harness.config, row, 'full'))).toBe(false);
      expect(existsSync(photoFilePath(harness.config, row, 'thumb'))).toBe(false);
    }

    // And no empty directory tree is left standing.
    expect(await readdir(harness.config.paths.uploads)).toEqual([]);
  });
});
