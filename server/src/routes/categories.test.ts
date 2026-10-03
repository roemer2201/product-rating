import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Category, Product, ProductDetail } from '@product-rating/shared';
import { createUser } from '../services/users.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/**
 * The category list: kept by administrators, read by everybody, and carried by
 * products through their identifiers.
 */

const PASSWORD = 'a-long-enough-password';

let harness: TestApp;
let adminCookie: string;
let annaCookie: string;

async function loginAs(username: string, role: 'admin' | 'user'): Promise<string> {
  await createUser(harness.app.db, harness.config, { username, password: PASSWORD, role });
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: writeHeaders(),
    payload: { username, password: PASSWORD },
  });
  return sessionCookie(response);
}

async function createCategory(name: string, frequent = false): Promise<Category> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/categories',
    headers: writeHeaders(adminCookie),
    payload: { name, frequent },
  });
  expect(response.statusCode).toBe(201);
  return response.json().category as Category;
}

async function listCategories(cookie = annaCookie): Promise<Category[]> {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/categories',
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json().categories as Category[];
}

async function createProduct(categoryIds: string[]) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/products',
    headers: writeHeaders(annaCookie),
    payload: { ean: '4260000000011', name: 'Hafermilch', categoryIds },
  });
}

beforeEach(async () => {
  harness = await createTestApp();
  adminCookie = await loginAs('chef', 'admin');
  annaCookie = await loginAs('anna', 'user');
});

afterEach(async () => {
  await harness.close();
});

describe('keeping the list', () => {
  it('lists alphabetically, umlauts where a German reader expects them', async () => {
    await createCategory('Zucker');
    await createCategory('Öl', true);
    await createCategory('Obst');

    const list = await listCategories();

    expect(list.map((entry) => entry.name)).toEqual(['Obst', 'Öl', 'Zucker']);
    expect(list.find((entry) => entry.name === 'Öl')).toMatchObject({
      frequent: true,
      productCount: 0,
    });
  });

  it('refuses a second category of the same name, whatever its case', async () => {
    const first = await createCategory('Getränke');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: writeHeaders(adminCookie),
      payload: { name: '  getränke ' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.details).toMatchObject({ field: 'name', categoryId: first.id });
  });

  it('refuses an empty name', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: writeHeaders(adminCookie),
      payload: { name: '   ' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('renames and marks, and lets a change of case through', async () => {
    const drinks = await createCategory('getränke');
    await createCategory('Bad');

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/categories/${drinks.id}`,
      headers: writeHeaders(adminCookie),
      payload: { name: 'Getränke', frequent: true },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().category).toMatchObject({ name: 'Getränke', frequent: true });

    const clash = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/categories/${drinks.id}`,
      headers: writeHeaders(adminCookie),
      payload: { name: 'BAD' },
    });
    expect(clash.statusCode).toBe(409);
  });

  it('answers an unknown category with 404', async () => {
    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/categories/nope',
      headers: writeHeaders(adminCookie),
    });

    expect(response.statusCode).toBe(404);
  });

  it('leaves the list to the administrators', async () => {
    const drinks = await createCategory('Getränke');

    for (const [method, url] of [
      ['POST', '/api/v1/categories'],
      ['PATCH', `/api/v1/categories/${drinks.id}`],
      ['DELETE', `/api/v1/categories/${drinks.id}`],
    ] as const) {
      const response = await harness.app.inject({
        method,
        url,
        headers: writeHeaders(annaCookie),
        payload: { name: 'Bad' },
      });
      expect(response.statusCode).toBe(403);
    }
  });
});

describe('categories on a product', () => {
  it('stores several, counts them and shows a rename on the product', async () => {
    const drinks = await createCategory('Getränke', true);
    const vegan = await createCategory('Vegan');

    const created = await createProduct([vegan.id, drinks.id, drinks.id]);
    expect(created.statusCode).toBe(201);
    const product = created.json().product as Product;
    // Alphabetical, and the doubled identifier is one category.
    expect(product.categories).toEqual([
      { id: drinks.id, name: 'Getränke' },
      { id: vegan.id, name: 'Vegan' },
    ]);

    expect((await listCategories()).map((entry) => entry.productCount)).toEqual([1, 1]);

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/categories/${vegan.id}`,
      headers: writeHeaders(adminCookie),
      payload: { name: 'Pflanzlich' },
    });

    const detail = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${product.id}`,
      headers: { cookie: annaCookie },
    });
    expect((detail.json().product as ProductDetail).categories.map((entry) => entry.name)).toEqual([
      'Getränke',
      'Pflanzlich',
    ]);
  });

  it('refuses an identifier that is not on the list', async () => {
    const response = await createProduct(['deleted-meanwhile']);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details).toMatchObject({
      field: 'categoryIds',
      unknown: ['deleted-meanwhile'],
    });
  });

  it('takes a deleted category off its products and says from how many', async () => {
    const vegan = await createCategory('Vegan');
    const created = await createProduct([vegan.id]);
    const product = created.json().product as Product;

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${vegan.id}`,
      headers: writeHeaders(adminCookie),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true, removedFrom: 1 });

    const detail = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/products/${product.id}`,
      headers: { cookie: annaCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json().product as ProductDetail).categories).toEqual([]);
    expect(await listCategories()).toEqual([]);
  });
});
