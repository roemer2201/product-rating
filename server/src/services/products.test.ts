import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productListQuerySchema, type ProductListQuery } from '@product-rating/shared';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../db/testing.js';
import { ConflictError, NotFoundError } from './errors.js';
import { createProduct, deleteProduct, listProducts, updateProduct } from './products.js';

/**
 * Service level tests for the parts the route tests cannot reach comfortably:
 * paging across rows whose sort key is identical, and the bookkeeping of a
 * deletion.
 */

let database: TestDatabase;
let annaId: string;

function query(overrides: Record<string, unknown> = {}): ProductListQuery {
  return productListQuerySchema.parse(overrides);
}

/** Walks the whole list one page at a time and collects the names in order. */
function walk(size: number, overrides: Record<string, unknown> = {}): string[] {
  const names: string[] = [];
  let cursor: string | null = null;
  let guard = 0;

  do {
    const page = listProducts(database.db, annaId, {
      ...query({ ...overrides, limit: size }),
      ...(cursor === null ? {} : { cursor }),
    });
    names.push(...page.products.map((product) => product.name));
    cursor = page.nextCursor;
    guard += 1;
  } while (cursor !== null && guard < 50);

  return names;
}

beforeEach(() => {
  database = createTestDatabase();
  const seeded = seedDatabase(database.db, { users: [{ username: 'anna' }] });
  annaId = seeded.users?.[0]?.id ?? '';
});

afterEach(() => {
  database.close();
});

describe('listProducts', () => {
  it('pages through products whose sort key is identical', () => {
    seedDatabase(database.db, {
      products: [
        { ean: '4260000000011', name: 'Gleicher Name', createdBy: annaId },
        { ean: '4260000000028', name: 'Gleicher Name', createdBy: annaId },
        { ean: '4260000000035', name: 'Gleicher Name', createdBy: annaId },
        { ean: '4260000000042', name: 'Gleicher Name', createdBy: annaId },
        { ean: '4260000000059', name: 'Gleicher Name', createdBy: annaId },
      ],
    });

    // None of them is rated either, so the rating sort ties as well.
    expect(walk(2, { sort: 'name' })).toHaveLength(5);
    expect(walk(1, { sort: 'rating' })).toHaveLength(5);
    expect(walk(3, { sort: 'created' })).toHaveLength(5);
  });

  it('reports the total across all pages', () => {
    seedDatabase(database.db, {
      products: [
        { ean: '4260000000011', name: 'Eins', createdBy: annaId },
        { ean: '4260000000028', name: 'Zwei', createdBy: annaId },
        { ean: '4260000000035', name: 'Drei', createdBy: annaId },
      ],
    });

    const page = listProducts(database.db, annaId, query({ limit: 2 }));
    expect(page.products).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.nextCursor).not.toBeNull();
  });

  it('rounds the average to two decimals', () => {
    const seeded = seedDatabase(database.db, {
      users: [{ username: 'bert' }, { username: 'carla' }],
      products: [{ ean: '4260000000011', name: 'Apfelsaft', createdBy: annaId }],
    });
    const productId = seeded.products?.[0]?.id ?? '';

    seedDatabase(database.db, {
      // 1, 2 and 2 stars average to 1.6666…
      ratings: [
        { productId, userId: annaId, stars: 1 },
        { productId, userId: seeded.users?.[0]?.id ?? '', stars: 2 },
        { productId, userId: seeded.users?.[1]?.id ?? '', stars: 2 },
      ],
    });

    const page = listProducts(database.db, annaId, query());
    expect(page.products[0]?.ratings).toEqual({ average: 1.67, count: 3 });
  });
});

describe('createProduct', () => {
  it('carries the existing product in the conflict', () => {
    const first = createProduct(database.db, annaId, {
      ean: '4260000000011',
      name: 'Apfelsaft',
      brand: null,
      category: null,
      notes: null,
    });

    try {
      createProduct(database.db, annaId, {
        ean: '4260000000011',
        name: 'Anderer Name',
        brand: null,
        category: null,
        notes: null,
      });
      expect.unreachable('a taken EAN has to be a conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toMatchObject({ productId: first.id });
    }
  });
});

describe('updateProduct', () => {
  it('only touches the fields that were sent', () => {
    const created = createProduct(database.db, annaId, {
      ean: '4260000000011',
      name: 'Apfelsaft',
      brand: 'Bio Hof',
      category: 'Getränke',
      notes: 'trüb',
    });

    const updated = updateProduct(database.db, created.id, { category: 'Saft' });

    expect(updated.category).toBe('Saft');
    expect(updated.brand).toBe('Bio Hof');
    expect(updated.notes).toBe('trüb');
  });

  it('fails for an unknown product', () => {
    expect(() => updateProduct(database.db, 'nope', { name: 'X' })).toThrow(NotFoundError);
  });
});

describe('deleteProduct', () => {
  it('removes ratings with the product and reports how many', () => {
    const seeded = seedDatabase(database.db, {
      users: [{ username: 'bert' }],
      products: [{ ean: '4260000000011', name: 'Apfelsaft', createdBy: annaId }],
    });
    const productId = seeded.products?.[0]?.id ?? '';

    seedDatabase(database.db, {
      ratings: [
        { productId, userId: annaId, stars: 5 },
        { productId, userId: seeded.users?.[0]?.id ?? '', stars: 3 },
      ],
    });

    const removed = deleteProduct(database.db, productId);

    expect(removed.removedRatings).toBe(2);
    expect(removed.removedPhotos).toEqual([]);
    expect(listProducts(database.db, annaId, query()).total).toBe(0);
    expect(() => deleteProduct(database.db, productId)).toThrow(NotFoundError);
  });
});
