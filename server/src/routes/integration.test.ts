import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type {
  Invite,
  Photo,
  Product,
  ProductDetail,
  ProductListPage,
  RatingSummary,
} from '@product-rating/shared';
import { bootstrapAdmin } from '../services/bootstrap.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/**
 * The whole way through the application, once, in the order a household walks
 * it: the first administrator out of the bootstrap variables, an invitation, a
 * registration, a scanned product, a photo, ratings by two accounts, and the
 * searches the catalogue is browsed with afterwards.
 *
 * The route tests next to this file each take one route apart. This one exists
 * for what only shows up in between: that the session from the registration
 * carries the next request, that a product stored from a UPC-A is found again
 * by its EAN-13, that an upload becomes an image the media route hands out,
 * and that two ratings become one average. Nothing is stubbed — the requests go
 * through `app.inject()` into the real stack, including cookie signing, origin
 * check and authentication hook.
 *
 * The tests build on each other on purpose and share one instance, so they run
 * in the order they are written.
 */

const BOUNDARY = '----productintegrationboundary';

/** Same product, once as printed on a US import and once as stored. */
const SCANNED_UPC_A = '036000291452';
const STORED_EAN = '0036000291452';

const OATS_EAN = '4260000000028';

const ADMIN = { user: 'ilse', password: 'the-first-administrator' };
const ANNA = { username: 'anna', password: 'a-long-enough-password' };
const BERT = { username: 'bert', password: 'another-long-password' };

let harness: TestApp;
let adminCookie: string;
let annaCookie: string;
let bertCookie: string;
let productId: string;
let photoId: string;

/** A real JPEG with a GPS tag, the way a phone hands one over. */
async function cameraJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: '#2f6f4f' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } })
    .jpeg()
    .toBuffer();
}

/** One file part, built by hand so the body stays predictable. */
function multipart(data: Buffer): { payload: Buffer; contentType: string } {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="photo"; filename="IMG_4711.HEIC"\r\n` +
      `Content-Type: image/heic\r\n\r\n`,
  );

  return {
    payload: Buffer.concat([head, data, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

beforeAll(async () => {
  harness = await createTestApp();
});

afterAll(async () => {
  await harness.close();
});

describe('from an empty instance to a rated catalogue', () => {
  it('creates the first administrator from the bootstrap variables', async () => {
    const result = await bootstrapAdmin(harness.app.db, harness.config, {
      env: { BOOTSTRAP_ADMIN_USER: ADMIN.user, BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password },
    });

    expect(result).toMatchObject({ created: true, username: ADMIN.user, warning: null });
  });

  it('lets the administrator log in', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: writeHeaders(),
      payload: { username: ADMIN.user, password: ADMIN.password },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe('admin');
    adminCookie = sessionCookie(response);
  });

  it('refuses a registration without an invite code', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { ...ANNA, invite: 'NOPE-NOPE-NOPE' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe('invite');
  });

  it('registers two accounts on two invitations', async () => {
    for (const account of [ANNA, BERT]) {
      const created = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/invites',
        headers: writeHeaders(adminCookie),
        payload: { note: `for ${account.username}` },
      });
      expect(created.statusCode).toBe(201);
      const invite = created.json().invite as Invite;

      const registered = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: writeHeaders(),
        payload: { ...account, invite: invite.code },
      });

      expect(registered.statusCode).toBe(201);
      expect(registered.json().user).toMatchObject({ username: account.username, role: 'user' });
      // Registering signs the account in, so no separate login is needed.
      const cookie = sessionCookie(registered);
      if (account === ANNA) annaCookie = cookie;
      else bertCookie = cookie;
    }

    // The codes are spent; a second use of Anna's would be a stolen invitation.
    const invites = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/invites',
      headers: { cookie: adminCookie },
    });
    expect((invites.json().invites as Invite[]).every((entry) => entry.usedBy !== null)).toBe(true);
  });

  it('carries the session of the registration into the next request', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe(ANNA.username);
  });

  it('stores a scanned UPC-A as a thirteen digit product', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(annaCookie),
      payload: {
        ean: SCANNED_UPC_A,
        name: 'Erdnussbutter',
        brand: 'Nutty',
        category: 'Aufstrich',
        notes: '',
      },
    });

    expect(response.statusCode).toBe(201);
    const product = response.json().product as Product;
    expect(product.ean).toBe(STORED_EAN);
    expect(product.notes).toBeNull();
    productId = product.id;
  });

  it('finds it again from every symbology the scanner may read', async () => {
    for (const scanned of [SCANNED_UPC_A, STORED_EAN, '036000-291452']) {
      const response = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/products/by-ean/${encodeURIComponent(scanned)}`,
        headers: { cookie: annaCookie },
      });

      expect(response.statusCode).toBe(200);
      expect((response.json().product as ProductDetail).id).toBe(productId);
    }
  });

  it('keeps a second scan of the same code out of the catalogue', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(bertCookie),
      payload: { ean: STORED_EAN, name: 'Erdnussbutter noch mal' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('takes a photo from the phone and strips its GPS position', async () => {
    const body = multipart(await cameraJpeg());

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/products/${productId}/photos`,
      headers: { ...writeHeaders(annaCookie), 'content-type': body.contentType },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(201);
    const photo = response.json().photo as Photo;
    // The declared HEIC and the file name of the client are both ignored; what
    // is stored is what the bytes turned out to be, re-encoded by sharp.
    expect(photo.mime).toBe('image/webp');
    expect(photo.isPrimary).toBe(true);
    photoId = photo.id;
  });

  it('hands the image out to any account, but only with a session', async () => {
    const anonymous = await harness.app.inject({ method: 'GET', url: `/api/v1/media/${photoId}` });
    expect(anonymous.statusCode).toBe(401);

    // Bert did not upload it; the catalogue is shared, so he still sees it.
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photoId}?size=thumb`,
      headers: { cookie: bertCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['cache-control']).toContain('private');

    const metadata = await sharp(response.rawPayload).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.width).toBe(harness.config.uploads.thumbnail_px);
  });

  it('shows the photo on the product', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { cookie: annaCookie },
    });

    const product = response.json().product as ProductDetail;
    expect(product.photos.map((entry) => entry.id)).toEqual([photoId]);
    expect(product.primaryPhotoId).toBe(photoId);
  });

  it('rates the product from both accounts and averages them', async () => {
    const first = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productId}/rating`,
      headers: writeHeaders(annaCookie),
      payload: { stars: 5, comment: 'schmeckt' },
    });
    expect(first.statusCode).toBe(201);

    // Repeating the rating replaces it rather than adding a second one.
    const corrected = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productId}/rating`,
      headers: writeHeaders(annaCookie),
      payload: { stars: 4 },
    });
    expect(corrected.statusCode).toBe(200);

    const second = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productId}/rating`,
      headers: writeHeaders(bertCookie),
      payload: { stars: 2, comment: 'zu süß' },
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().ratings as RatingSummary).toEqual({ average: 3, count: 2 });
  });

  it('shows each account its own rating, not the other one', async () => {
    const forAnna = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { cookie: annaCookie },
    });
    const forBert = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { cookie: bertCookie },
    });

    expect((forAnna.json().product as ProductDetail).ownRating?.stars).toBe(4);
    expect((forBert.json().product as ProductDetail).ownRating?.stars).toBe(2);
  });
});

describe('browsing the catalogue afterwards', () => {
  beforeAll(async () => {
    // A second product, so the searches have something to leave out.
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(bertCookie),
      payload: { ean: OATS_EAN, name: 'Haferflocken', brand: 'Mühle', category: 'Frühstück' },
    });
    expect(response.statusCode).toBe(201);
  });

  /** Runs a search as Anna and returns the names it found, in order. */
  async function search(query: string, cookie = annaCookie): Promise<string[]> {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products?${query}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    return (response.json() as ProductListPage).products.map((product) => product.name);
  }

  it('finds by name, by brand and by the beginning of the EAN', async () => {
    expect(await search('q=erdnuss')).toEqual(['Erdnussbutter']);
    expect(await search('q=m%C3%BChle')).toEqual(['Haferflocken']);
    expect(await search(`q=${STORED_EAN.slice(0, 7)}`)).toEqual(['Erdnussbutter']);
  });

  it('filters by category, by rating and by who rated', async () => {
    expect(await search('category=Fr%C3%BChst%C3%BCck')).toEqual(['Haferflocken']);
    // Only the peanut butter has been rated at all, with an average of three.
    expect(await search('minStars=3')).toEqual(['Erdnussbutter']);
    expect(await search('minStars=4')).toEqual([]);
    expect(await search('ratedByMe=true')).toEqual(['Erdnussbutter']);
  });

  it('sorts and pages', async () => {
    expect(await search('sort=name&order=asc')).toEqual(['Erdnussbutter', 'Haferflocken']);
    expect(await search('sort=name&order=desc')).toEqual(['Haferflocken', 'Erdnussbutter']);

    const firstPage = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/products?sort=name&order=asc&limit=1',
      headers: { cookie: annaCookie },
    });
    const page = firstPage.json() as ProductListPage;
    expect(page.products.map((product) => product.name)).toEqual(['Erdnussbutter']);
    expect(page.nextCursor).not.toBeNull();

    const secondPage = await search(
      `sort=name&order=asc&limit=1&cursor=${encodeURIComponent(page.nextCursor as string)}`,
    );
    expect(secondPage).toEqual(['Haferflocken']);
  });

  it('shows the account its own ratings', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/ratings/mine',
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ratings).toHaveLength(1);
    expect(response.json().ratings[0].ownRating).toMatchObject({ stars: 4 });
  });
});

describe('what the catalogue does not allow', () => {
  it('answers every route of the catalogue with 401 without a session', async () => {
    for (const url of ['/api/v1/products', `/api/v1/products/${productId}`, '/api/v1/ratings/mine'])
      expect((await harness.app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });

  it('keeps deleting a product with the administrators', async () => {
    const asUser = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productId}`,
      headers: writeHeaders(annaCookie),
    });

    expect(asUser.statusCode).toBe(403);
  });

  it('keeps a photo with the account that took it', async () => {
    const asOther = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/photos/${photoId}`,
      headers: writeHeaders(bertCookie),
    });

    expect(asOther.statusCode).toBe(403);
  });

  it('refuses a writing request from a foreign origin', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productId}/rating`,
      headers: { cookie: annaCookie, origin: 'https://evil.example' },
      payload: { stars: 0 },
    });

    expect(response.statusCode).toBe(403);
  });

  it('ends the session on logout', async () => {
    const logout = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: writeHeaders(bertCookie),
    });
    expect(logout.statusCode).toBe(200);

    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: bertCookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it('lets the administrator move the product to the trash and bring it back', async () => {
    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productId}`,
      headers: writeHeaders(adminCookie),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      trashed: true,
      removedRatings: 2,
      removedPhotos: 1,
    });

    // Out of the catalogue for everybody …
    const hidden = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { cookie: annaCookie },
    });
    expect(hidden.statusCode).toBe(404);

    // … but whole in the trash, ratings and photos included.
    const trash = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/trash',
      headers: { cookie: adminCookie },
    });
    expect(trash.statusCode).toBe(200);
    expect(trash.json().entries).toMatchObject([{ ratings: 2, photos: 1 }]);

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/trash/${productId}/restore`,
      headers: writeHeaders(adminCookie),
    });
    expect(restored.statusCode).toBe(200);

    const back = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productId}`,
      headers: { cookie: annaCookie },
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().product.ratings).toMatchObject({ count: 2 });
  });

  it('removes the product for good once the trash is emptied', async () => {
    await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productId}`,
      headers: writeHeaders(adminCookie),
    });

    const purged = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/trash/${productId}`,
      headers: writeHeaders(adminCookie),
    });
    expect(purged.statusCode).toBe(200);
    expect(purged.json()).toMatchObject({ ok: true, removedRatings: 2, removedPhotos: 1 });

    const gone = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/media/${photoId}`,
      headers: { cookie: annaCookie },
    });
    expect(gone.statusCode).toBe(404);
  });
});
