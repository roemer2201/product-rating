import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Price, ProductDetail } from '@product-rating/shared';
import { seedDatabase } from '../db/testing.js';
import { createUser } from '../services/users.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/**
 * The price history over HTTP.
 *
 * What matters here is the split of rights that runs through the whole
 * application: the catalogue is shared, so everybody may record what something
 * cost — but an entry belongs to whoever wrote it down.
 */

const PASSWORD = 'a-long-enough-password';
const EAN = { juice: '4260000000011', oats: '4260000000028' } as const;

let harness: TestApp;
let annaCookie: string;
let bertCookie: string;
let adminCookie: string;
let productId: string;

async function makeUser(username: string, role: 'user' | 'admin' = 'user'): Promise<string> {
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

function addPrice(payload: Record<string, unknown>, cookie = annaCookie) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/v1/products/${productId}/prices`,
    headers: writeHeaders(cookie),
    payload,
  });
}

async function readProduct(cookie = annaCookie): Promise<ProductDetail> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/products/${productId}`,
    headers: { cookie },
  });
  return response.json().product as ProductDetail;
}

beforeEach(async () => {
  harness = await createTestApp();

  const annaId = await makeUser('anna');
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
});

afterEach(async () => {
  await harness.close();
});

describe('recording a price', () => {
  it('stores the amount, the shop and the day of the purchase', async () => {
    const response = await addPrice({
      cents: 199,
      shop: 'Bioladen',
      note: 'Angebot',
      purchasedAt: '2026-08-10',
    });

    expect(response.statusCode).toBe(201);
    const price = response.json().price as Price;
    expect(price).toMatchObject({
      cents: 199,
      currency: 'EUR',
      shop: 'Bioladen',
      note: 'Angebot',
      username: 'anna',
    });
    // A bare date is read as the middle of that day, so it stays that day in
    // every time zone the household might be in.
    expect(price.purchasedAt.startsWith('2026-08-10')).toBe(true);
  });

  it('is open to every account, and lists the newest purchase first', async () => {
    await addPrice({ cents: 249, shop: 'Supermarkt', purchasedAt: '2026-08-01' }, annaCookie);
    await addPrice({ cents: 179, shop: 'Discounter', purchasedAt: '2026-08-12' }, bertCookie);

    const detail = await readProduct();
    expect(detail.prices.map((entry) => entry.cents)).toEqual([179, 249]);
    expect(detail.prices.map((entry) => entry.username)).toEqual(['bert', 'anna']);
  });

  it('defaults to today and takes an entry without a shop', async () => {
    const response = await addPrice({ cents: 100 });

    expect(response.statusCode).toBe(201);
    const price = response.json().price as Price;
    expect(price.shop).toBeNull();
    expect(Date.parse(price.purchasedAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('refuses a negative amount, an unreadable date and one in the future', async () => {
    expect((await addPrice({ cents: -1 })).statusCode).toBe(400);
    expect((await addPrice({ cents: 199, purchasedAt: 'gestern' })).statusCode).toBe(400);

    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const response = await addPrice({ cents: 199, purchasedAt: future });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe('purchasedAt');
  });

  it('answers an unknown product with 404', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/products/does-not-exist/prices',
      headers: writeHeaders(annaCookie),
      payload: { cents: 199 },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('removing a price', () => {
  async function recorded(cookie: string): Promise<string> {
    const response = await addPrice({ cents: 199, shop: 'Bioladen' }, cookie);
    return (response.json().price as Price).id;
  }

  it('is refused for an entry of another account, but not for an administrator', async () => {
    const id = await recorded(bertCookie);

    const foreign = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/prices/${id}`,
      headers: writeHeaders(annaCookie),
    });
    expect(foreign.statusCode).toBe(403);
    expect((await readProduct()).prices).toHaveLength(1);

    const admin = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/prices/${id}`,
      headers: writeHeaders(adminCookie),
    });
    expect(admin.statusCode).toBe(200);
    expect((await readProduct()).prices).toEqual([]);
  });

  it('removes an own entry', async () => {
    const id = await recorded(annaCookie);

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/prices/${id}`,
      headers: writeHeaders(annaCookie),
    });

    expect(response.statusCode).toBe(200);
    expect((await readProduct()).prices).toEqual([]);
  });
});

describe('the shops that were used before', () => {
  it('offers each one once, sorted the way a German list reads', async () => {
    await addPrice({ cents: 199, shop: 'Bioladen' });
    await addPrice({ cents: 149, shop: 'Aldi' }, bertCookie);
    await addPrice({ cents: 209, shop: 'Bioladen' });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/prices/shops',
      headers: { cookie: annaCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().shops).toEqual(['Aldi', 'Bioladen']);
  });
});
