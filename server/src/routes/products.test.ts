import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProductListPage, ProductWithRatings } from '@product-rating/shared';
import { seedDatabase } from '../db/testing.js';
import { createUser } from '../services/users.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/** The product catalogue: creation, lookup, search, paging and permissions. */

const PASSWORD = 'a-long-enough-password';

/** Valid EAN-13 codes; the check digit matters, these are not random digits. */
const EAN = {
  juice: '4260000000011',
  oats: '4260000000028',
  muesli: '4260000000035',
  toothpaste: '4260000000042',
  fresh: '4006381333931',
} as const;

/** The same article as EAN-8 and in its normalised thirteen digit form. */
const SHORT_EAN = '96385074';
const SHORT_EAN_NORMALISED = '0000096385074';

let harness: TestApp;
let adminCookie: string;
let annaCookie: string;
let annaId: string;
let bertId: string;
let productIds: Record<keyof typeof EAN, string>;

async function makeUser(username: string, role: 'admin' | 'user'): Promise<string> {
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

/** Four products with a known rating distribution, seeded past the API. */
function seedCatalogue(): void {
  const seeded = seedDatabase(harness.app.db, {
    products: [
      {
        ean: EAN.juice,
        name: 'Apfelsaft',
        brand: 'Bio Hof',
        category: 'Getränke',
        createdBy: annaId,
      },
      {
        ean: EAN.oats,
        name: 'Haferflocken',
        brand: 'Kölln',
        category: 'Frühstück',
        createdBy: annaId,
      },
      {
        ean: EAN.muesli,
        name: 'Müsli Knusper',
        brand: 'Kölln',
        category: 'Frühstück',
        createdBy: bertId,
      },
      { ean: EAN.toothpaste, name: 'Zahnpasta', brand: null, createdBy: bertId },
    ],
  });

  const [juice, oats, muesli, toothpaste] = seeded.products ?? [];
  productIds = {
    juice: juice?.id ?? '',
    oats: oats?.id ?? '',
    muesli: muesli?.id ?? '',
    toothpaste: toothpaste?.id ?? '',
    fresh: '',
  };

  seedDatabase(harness.app.db, {
    // Averages: juice 5, oats 3 (2 and 4), muesli 1, toothpaste none.
    ratings: [
      { productId: productIds.juice, userId: annaId, stars: 5 },
      { productId: productIds.oats, userId: annaId, stars: 2, comment: 'geht so' },
      { productId: productIds.oats, userId: bertId, stars: 4 },
      { productId: productIds.muesli, userId: bertId, stars: 1 },
    ],
  });
}

async function listProducts(query: string, cookie = annaCookie): Promise<ProductListPage> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/products${query}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as ProductListPage;
}

function namesOf(page: ProductListPage): string[] {
  return page.products.map((product) => product.name);
}

beforeEach(async () => {
  harness = await createTestApp();
  await makeUser('chef', 'admin');
  annaId = await makeUser('anna', 'user');
  bertId = await makeUser('bert', 'user');
  adminCookie = await loginAs('chef');
  annaCookie = await loginAs('anna');
});

afterEach(async () => {
  await harness.close();
});

describe('creating products', () => {
  it('stores a product and normalises its EAN', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(annaCookie),
      payload: { ean: SHORT_EAN, name: '  Apfelsaft  ', brand: 'Bio Hof', notes: '' },
    });

    expect(response.statusCode).toBe(201);
    const product = response.json().product;
    expect(product.ean).toBe(SHORT_EAN_NORMALISED);
    expect(product.name).toBe('Apfelsaft');
    expect(product.notes).toBeNull();
    expect(product.createdBy).toBe(annaId);
  });

  it('answers a taken EAN with 409 and the existing product', async () => {
    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(annaCookie),
      payload: { ean: SHORT_EAN, name: 'Apfelsaft' },
    });
    expect(first.statusCode).toBe(201);

    // The same article, scanned in its long form this time.
    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(annaCookie),
      payload: { ean: SHORT_EAN_NORMALISED, name: 'Apfelsaft anders benannt' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('conflict');
    expect(second.json().error.details.productId).toBe(first.json().product.id);
  });

  it('rejects a broken check digit', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(annaCookie),
      payload: { ean: '4006381333932', name: 'Apfelsaft' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });

  it('refuses anonymous callers', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(),
      payload: { ean: EAN.fresh, name: 'Apfelsaft' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('reading products', () => {
  beforeEach(() => {
    seedCatalogue();
  });

  it('returns own rating, average and count', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productIds.oats}`,
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(200);
    const product = response.json().product as ProductWithRatings;
    expect(product.ratings).toEqual({ average: 3, count: 2 });
    expect(product.ownRating?.stars).toBe(2);
    expect(product.ownRating?.comment).toBe('geht so');
    expect(product.primaryPhotoId).toBeNull();
  });

  it('reports no own rating for a product the caller has not rated', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productIds.muesli}`,
      headers: { cookie: annaCookie },
    });

    const product = response.json().product as ProductWithRatings;
    expect(product.ownRating).toBeNull();
    expect(product.ratings).toEqual({ average: 1, count: 1 });
  });

  it('answers an unknown identifier with 404', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/products/does-not-exist',
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('finds a product by any form of its EAN', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/by-ean/${EAN.juice}`,
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().product.name).toBe('Apfelsaft');

    // A product stored from an EAN-8 is found through its long form as well.
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: writeHeaders(annaCookie),
      payload: { ean: SHORT_EAN, name: 'Kaugummi' },
    });

    const long = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/by-ean/${SHORT_EAN_NORMALISED}`,
      headers: { cookie: annaCookie },
    });
    expect(long.json().product.name).toBe('Kaugummi');
  });

  it('answers an unknown EAN with 404 and an invalid one with 400', async () => {
    const unknown = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/by-ean/${EAN.fresh}`,
      headers: { cookie: annaCookie },
    });
    expect(unknown.statusCode).toBe(404);

    const invalid = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/products/by-ean/1234567890123',
      headers: { cookie: annaCookie },
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('category suggestions', () => {
  it('lists each used category once, sorted, without the empty ones', async () => {
    seedCatalogue();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/products/categories',
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(200);
    // "Frühstück" is on two products and appears once; the toothpaste has no
    // category at all and contributes nothing.
    expect(response.json()).toEqual({ categories: ['Frühstück', 'Getränke'] });
  });

  it('answers an empty catalogue with an empty list', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/products/categories',
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ categories: [] });
  });

  it('refuses anonymous callers', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/products/categories',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('searching and filtering', () => {
  beforeEach(() => {
    seedCatalogue();
  });

  it('lists everything by default', async () => {
    const page = await listProducts('');
    expect(page.total).toBe(4);
    expect(page.products).toHaveLength(4);
    expect(page.nextCursor).toBeNull();
  });

  it('searches case insensitively across umlauts', async () => {
    expect(namesOf(await listProducts('?q=m%C3%9CSLI'))).toEqual(['Müsli Knusper']);
    expect(namesOf(await listProducts('?q=m%C3%BCsli'))).toEqual(['Müsli Knusper']);
  });

  it('searches the brand as well', async () => {
    const page = await listProducts('?q=k%C3%B6lln&sort=name');
    expect(namesOf(page)).toEqual(['Haferflocken', 'Müsli Knusper']);
  });

  it('searches an EAN, whole or in part', async () => {
    expect(namesOf(await listProducts(`?q=${EAN.oats}`))).toEqual(['Haferflocken']);
    expect(namesOf(await listProducts('?q=4260000000011'))).toEqual(['Apfelsaft']);
    // The trigram index finds the tail of a barcode too, which is what someone
    // reading the last digits off a label types.
    expect(namesOf(await listProducts('?q=0000028'))).toEqual(['Haferflocken']);
  });

  it('finds a word inside a compound', async () => {
    // The case a word based index cannot do and German needs constantly.
    expect(namesOf(await listProducts('?q=knusper'))).toEqual(['Müsli Knusper']);
    expect(namesOf(await listProducts('?q=flocken'))).toEqual(['Haferflocken']);
  });

  it('narrows down with every word instead of widening', async () => {
    expect(namesOf(await listProducts('?q=k%C3%B6lln%20m%C3%BCsli'))).toEqual(['Müsli Knusper']);
    // Two words that are nowhere together find nothing.
    expect((await listProducts('?q=k%C3%B6lln%20zahnpasta')).total).toBe(0);
  });

  it('falls back to LIKE for a word the index cannot answer', async () => {
    // Two characters are shorter than a trigram; the answer has to be exact
    // all the same.
    expect(namesOf(await listProducts('?q=%C3%BCs'))).toEqual(['Müsli Knusper']);
  });

  it('treats wildcards and quotes in a search term as text', async () => {
    expect((await listProducts('?q=%25')).total).toBe(0);
    expect((await listProducts('?q=%22apfel')).total).toBe(0);
    // A hyphen would be query syntax to FTS5 if the term were not quoted.
    expect((await listProducts('?q=bio-hof')).total).toBe(0);
  });

  it('keeps the index in step with the catalogue', async () => {
    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productIds.juice}`,
      headers: writeHeaders(annaCookie),
      payload: { name: 'Birnensaft' },
    });
    expect(renamed.statusCode).toBe(200);

    expect((await listProducts('?q=apfel')).total).toBe(0);
    expect(namesOf(await listProducts('?q=birnen'))).toEqual(['Birnensaft']);

    // A product in the trash is out of the catalogue, index or not.
    const trashed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productIds.juice}`,
      headers: writeHeaders(adminCookie),
    });
    expect(trashed.statusCode).toBe(200);
    expect((await listProducts('?q=birnen')).total).toBe(0);
  });

  it('filters by category, ignoring case', async () => {
    const page = await listProducts('?category=fr%C3%BChst%C3%BCck&sort=name');
    expect(namesOf(page)).toEqual(['Haferflocken', 'Müsli Knusper']);
  });

  it('filters by minimum average rating and leaves unrated products out', async () => {
    const page = await listProducts('?minStars=3&sort=name');
    expect(namesOf(page)).toEqual(['Apfelsaft', 'Haferflocken']);
  });

  it('filters down to the products the caller rated', async () => {
    const page = await listProducts('?ratedByMe=true&sort=name');
    expect(namesOf(page)).toEqual(['Apfelsaft', 'Haferflocken']);
    expect(page.total).toBe(2);
  });

  it('sorts by name and by average rating', async () => {
    expect(namesOf(await listProducts('?sort=name'))).toEqual([
      'Apfelsaft',
      'Haferflocken',
      'Müsli Knusper',
      'Zahnpasta',
    ]);

    // Unrated products come last, not first.
    expect(namesOf(await listProducts('?sort=rating'))).toEqual([
      'Apfelsaft',
      'Haferflocken',
      'Müsli Knusper',
      'Zahnpasta',
    ]);
    expect(namesOf(await listProducts('?sort=rating&order=asc'))).toEqual([
      'Zahnpasta',
      'Müsli Knusper',
      'Haferflocken',
      'Apfelsaft',
    ]);
  });

  it('walks all pages with the cursor without repeating a product', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const page: ProductListPage = await listProducts(
        `?sort=rating&limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...namesOf(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(2);
    expect(seen).toEqual(['Apfelsaft', 'Haferflocken', 'Müsli Knusper', 'Zahnpasta']);
  });

  it('rejects a cursor that belongs to another sorting', async () => {
    const first = await listProducts('?sort=name&limit=2');
    expect(first.nextCursor).not.toBeNull();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products?sort=rating&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('sorting');
  });

  it('rejects a page size above the maximum', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/products?limit=500',
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('changing and removing products', () => {
  beforeEach(() => {
    seedCatalogue();
  });

  it('lets any account correct the shared catalogue', async () => {
    const before = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productIds.muesli}`,
      headers: { cookie: annaCookie },
    });

    // Seeded by bert, changed by anna: the catalogue belongs to everyone.
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productIds.muesli}`,
      headers: writeHeaders(annaCookie),
      payload: { name: 'Knuspermüsli', category: '' },
    });

    expect(response.statusCode).toBe(200);
    const product = response.json().product;
    expect(product.name).toBe('Knuspermüsli');
    expect(product.category).toBeNull();
    expect(new Date(product.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before.json().product.updatedAt).getTime(),
    );
  });

  it('refuses an empty change', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productIds.muesli}`,
      headers: writeHeaders(annaCookie),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('only lets administrators delete, and takes the ratings along', async () => {
    const forbidden = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productIds.oats}`,
      headers: writeHeaders(annaCookie),
    });
    expect(forbidden.statusCode).toBe(403);

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/products/${productIds.oats}`,
      headers: writeHeaders(adminCookie),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().removedRatings).toBe(2);

    const gone = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${productIds.oats}`,
      headers: { cookie: annaCookie },
    });
    expect(gone.statusCode).toBe(404);

    // The remaining ratings of other products are untouched.
    const page = await listProducts('?ratedByMe=true');
    expect(namesOf(page)).toEqual(['Apfelsaft']);
  });

  it('rejects a writing request from a foreign origin', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${productIds.oats}`,
      headers: { cookie: annaCookie, origin: 'https://evil.example' },
      payload: { name: 'Übernommen' },
    });

    expect(response.statusCode).toBe(403);
  });
});
