import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RATING_COMMENT_MAX_LENGTH,
  type ProductDetail,
  type ProductWithRatings,
  type RatingListPage,
} from '@product-rating/shared';
import { seedDatabase } from '../db/testing.js';
import { createUser } from '../services/users.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/** Ratings over HTTP: saving, replacing, removing and the list of own ones. */

const PASSWORD = 'a-long-enough-password';

/** Valid EAN-13 codes; the check digit matters, these are not random digits. */
const EAN = {
  juice: '4260000000011',
  oats: '4260000000028',
  muesli: '4260000000035',
  toothpaste: '4260000000042',
} as const;

let harness: TestApp;
let annaCookie: string;
let bertCookie: string;
let annaId: string;
let bertId: string;
let productIds: Record<keyof typeof EAN, string>;

async function makeUser(username: string): Promise<string> {
  const user = await createUser(harness.app.db, harness.config, {
    username,
    password: PASSWORD,
    role: 'user',
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

function seedCatalogue(): void {
  const seeded = seedDatabase(harness.app.db, {
    products: [
      { ean: EAN.juice, name: 'Apfelsaft', brand: 'Bio Hof', createdBy: annaId },
      { ean: EAN.oats, name: 'Haferflocken', brand: 'Kölln', createdBy: annaId },
      { ean: EAN.muesli, name: 'Müsli Knusper', brand: 'Kölln', createdBy: bertId },
      { ean: EAN.toothpaste, name: 'Zahnpasta', createdBy: bertId },
    ],
  });

  const [juice, oats, muesli, toothpaste] = seeded.products ?? [];
  productIds = {
    juice: juice?.id ?? '',
    oats: oats?.id ?? '',
    muesli: muesli?.id ?? '',
    toothpaste: toothpaste?.id ?? '',
  };
}

function putRating(productId: string, payload: Record<string, unknown>, cookie = annaCookie) {
  return harness.app.inject({
    method: 'PUT',
    url: `/api/v1/products/${productId}/rating`,
    headers: writeHeaders(cookie),
    payload,
  });
}

async function readProduct(productId: string, cookie = annaCookie): Promise<ProductWithRatings> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/products/${productId}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json().product as ProductWithRatings;
}

async function myRatings(query = '', cookie = annaCookie): Promise<RatingListPage> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/ratings/mine${query}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as RatingListPage;
}

function namesOf(page: RatingListPage): string[] {
  return page.ratings.map((entry) => entry.name);
}

beforeEach(async () => {
  harness = await createTestApp();
  annaId = await makeUser('anna');
  bertId = await makeUser('bert');
  annaCookie = await loginAs('anna');
  bertCookie = await loginAs('bert');
  seedCatalogue();
});

afterEach(async () => {
  await harness.close();
});

describe('saving a rating', () => {
  it('stores a new rating with 201 and reports the new average', async () => {
    const response = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productIds.juice}/rating`,
      headers: writeHeaders(annaCookie),
      payload: { stars: 4, comment: '  schmeckt  ' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.rating.stars).toBe(4);
    expect(body.rating.comment).toBe('schmeckt');
    expect(body.rating.userId).toBe(annaId);
    expect(body.rating.productId).toBe(productIds.juice);
    expect(body.ratings).toEqual({ average: 4, count: 1 });

    const product = await readProduct(productIds.juice);
    expect(product.ownRating?.stars).toBe(4);
    expect(product.ratings).toEqual({ average: 4, count: 1 });
  });

  it('replaces an earlier rating instead of adding a second one', async () => {
    const first = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productIds.juice}/rating`,
      headers: writeHeaders(annaCookie),
      payload: { stars: 2, comment: 'geht so' },
    });
    expect(first.statusCode).toBe(201);

    const second = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productIds.juice}/rating`,
      headers: writeHeaders(annaCookie),
      payload: { stars: 5 },
    });

    // Updating is not creating: 200, and the count stays at one.
    expect(second.statusCode).toBe(200);
    expect(second.json().ratings).toEqual({ average: 5, count: 1 });

    const rating = second.json().rating;
    expect(rating.stars).toBe(5);
    // A left out comment clears the earlier one; PUT replaces the whole rating.
    expect(rating.comment).toBeNull();
    expect(rating.createdAt).toBe(first.json().rating.createdAt);
    expect(new Date(rating.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.json().rating.updatedAt).getTime(),
    );
  });

  it('accepts the bounds zero and five', async () => {
    const zero = await putRating(productIds.juice, { stars: 0 });
    expect(zero.statusCode).toBe(201);
    expect((await readProduct(productIds.juice)).ratings).toEqual({ average: 0, count: 1 });

    const five = await putRating(productIds.oats, { stars: 5 });
    expect(five.statusCode).toBe(201);

    // Zero is a verdict, not a missing rating.
    const page = await myRatings();
    expect(page.total).toBe(2);
  });

  it('rejects values outside the range, fractions and non-numbers', async () => {
    for (const stars of [6, -1, 2.5, '3', null]) {
      const response = await putRating(productIds.juice, { stars });
      expect(response.statusCode).toBe(400);
    }

    const missing = await putRating(productIds.juice, { comment: 'ohne Sterne' });
    expect(missing.statusCode).toBe(400);
  });

  it('rejects a comment beyond the limit', async () => {
    const response = await putRating(productIds.juice, {
      stars: 3,
      comment: 'x'.repeat(RATING_COMMENT_MAX_LENGTH + 1),
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers an unknown product with 404', async () => {
    const response = await putRating('does-not-exist', { stars: 3 });
    expect(response.statusCode).toBe(404);
  });

  it('refuses anonymous callers and foreign origins', async () => {
    const anonymous = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productIds.juice}/rating`,
      headers: writeHeaders(),
      payload: { stars: 3 },
    });
    expect(anonymous.statusCode).toBe(401);

    const foreign = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/products/${productIds.juice}/rating`,
      headers: { cookie: annaCookie, origin: 'https://evil.example' },
      payload: { stars: 3 },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('leaves ratings of other accounts untouched', async () => {
    await putRating(productIds.oats, { stars: 1, comment: 'pappig' }, bertCookie);
    await putRating(productIds.oats, { stars: 5 }, annaCookie);

    const forBert = await readProduct(productIds.oats, bertCookie);
    expect(forBert.ownRating?.stars).toBe(1);
    expect(forBert.ownRating?.comment).toBe('pappig');
    expect(forBert.ratings).toEqual({ average: 3, count: 2 });

    const forAnna = await readProduct(productIds.oats, annaCookie);
    expect(forAnna.ownRating?.stars).toBe(5);
  });
});

describe('the ratings of the household', () => {
  it('lists every verdict with the name behind it, newest first', async () => {
    await putRating(productIds.juice, { stars: 5, comment: 'trüb, wie er soll' }, annaCookie);
    await putRating(productIds.juice, { stars: 2 }, bertCookie);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productIds.juice}`,
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(200);
    const detail = response.json().product as ProductDetail;

    expect(detail.allRatings.map((entry) => entry.username)).toEqual(['bert', 'anna']);
    expect(detail.allRatings.map((entry) => entry.stars)).toEqual([2, 5]);
    expect(detail.allRatings.find((entry) => entry.username === 'anna')?.comment).toBe(
      'trüb, wie er soll',
    );
    // The caller's own rating stays where it was; the list is the addition.
    expect(detail.ownRating?.stars).toBe(5);
  });

  it('shows every verdict to everybody, and lets nobody change a foreign one', async () => {
    await putRating(productIds.juice, { stars: 4 }, bertCookie);

    const seen = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productIds.juice}`,
      headers: { cookie: annaCookie },
    });
    expect((seen.json().product as ProductDetail).allRatings).toHaveLength(1);

    // Rating the same product writes anna's own row, it does not touch bert's.
    await putRating(productIds.juice, { stars: 1 }, annaCookie);

    const after = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productIds.juice}`,
      headers: { cookie: bertCookie },
    });
    const detail = after.json().product as ProductDetail;
    expect(detail.allRatings).toHaveLength(2);
    expect(detail.allRatings.find((entry) => entry.username === 'bert')?.stars).toBe(4);
  });

  it('stays empty for a product nobody has rated', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productIds.toothpaste}`,
      headers: { cookie: annaCookie },
    });

    expect((response.json().product as ProductDetail).allRatings).toEqual([]);
  });
});

describe('removing a rating', () => {
  it('removes the own rating only and reports the new average', async () => {
    await putRating(productIds.oats, { stars: 1 }, bertCookie);
    await putRating(productIds.oats, { stars: 5 }, annaCookie);

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productIds.oats}/rating`,
      headers: writeHeaders(annaCookie),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ratings).toEqual({ average: 1, count: 1 });

    const forAnna = await readProduct(productIds.oats, annaCookie);
    expect(forAnna.ownRating).toBeNull();
    expect((await readProduct(productIds.oats, bertCookie)).ownRating?.stars).toBe(1);
  });

  it('answers 404 when there is no rating of ones own to remove', async () => {
    await putRating(productIds.oats, { stars: 1 }, bertCookie);

    const foreign = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productIds.oats}/rating`,
      headers: writeHeaders(annaCookie),
    });
    expect(foreign.statusCode).toBe(404);

    // Bert's rating survived the attempt.
    expect((await readProduct(productIds.oats, bertCookie)).ratings.count).toBe(1);
  });
});

describe('own ratings', () => {
  /** Anna rates three products at known times, Bert one. */
  function seedRatings(): void {
    seedDatabase(harness.app.db, {
      ratings: [
        {
          productId: productIds.juice,
          userId: annaId,
          stars: 5,
          updatedAt: new Date('2026-08-01T10:00:00Z'),
        },
        {
          productId: productIds.oats,
          userId: annaId,
          stars: 2,
          comment: 'geht so',
          updatedAt: new Date('2026-08-03T10:00:00Z'),
        },
        {
          productId: productIds.muesli,
          userId: annaId,
          stars: 3,
          updatedAt: new Date('2026-08-02T10:00:00Z'),
        },
        { productId: productIds.oats, userId: bertId, stars: 4 },
      ],
    });
  }

  beforeEach(() => {
    seedRatings();
  });

  it('lists own ratings only, latest verdict first', async () => {
    const page = await myRatings();

    expect(page.total).toBe(3);
    expect(namesOf(page)).toEqual(['Haferflocken', 'Müsli Knusper', 'Apfelsaft']);
    expect(page.nextCursor).toBeNull();

    const bert = await myRatings('', bertCookie);
    expect(namesOf(bert)).toEqual(['Haferflocken']);
    expect(bert.total).toBe(1);
  });

  it('carries product, own rating and overall average', async () => {
    const page = await myRatings('?sort=name');
    const oats = page.ratings.find((entry) => entry.name === 'Haferflocken');

    expect(oats?.ean).toBe(EAN.oats);
    expect(oats?.brand).toBe('Kölln');
    expect(oats?.ownRating.stars).toBe(2);
    expect(oats?.ownRating.comment).toBe('geht so');
    // Anna gave two stars, Bert four.
    expect(oats?.ratings).toEqual({ average: 3, count: 2 });
  });

  it('sorts by stars and by product name', async () => {
    expect(namesOf(await myRatings('?sort=stars'))).toEqual([
      'Apfelsaft',
      'Müsli Knusper',
      'Haferflocken',
    ]);
    expect(namesOf(await myRatings('?sort=stars&order=asc'))).toEqual([
      'Haferflocken',
      'Müsli Knusper',
      'Apfelsaft',
    ]);
    expect(namesOf(await myRatings('?sort=name'))).toEqual([
      'Apfelsaft',
      'Haferflocken',
      'Müsli Knusper',
    ]);
  });

  it('walks all pages with the cursor without repeating an entry', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page: RatingListPage = await myRatings(
        `?sort=stars&limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      expect(page.total).toBe(3);
      seen.push(...namesOf(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(2);
    expect(seen).toEqual(['Apfelsaft', 'Müsli Knusper', 'Haferflocken']);
  });

  it('rejects a cursor that belongs to another sorting', async () => {
    const first = await myRatings('?sort=name&limit=2');
    expect(first.nextCursor).not.toBeNull();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/ratings/mine?sort=stars&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('sorting');
  });

  it('refuses anonymous callers', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/ratings/mine' });
    expect(response.statusCode).toBe(401);
  });
});
