import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productListQuerySchema, type ProductListQuery } from '@product-rating/shared';
import { productCategories } from '../db/index.js';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../db/testing.js';
import { createCategory, deleteCategory, listCategories } from './categories.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import {
  createProduct,
  getProduct,
  listProducts,
  listTrash,
  purgeExpiredTrash,
  purgeProduct,
  restoreProduct,
  trashProduct,
  updateProduct,
} from './products.js';

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
      variant: null,
      brand: null,
      categoryIds: [],
      notes: null,
    });

    try {
      createProduct(database.db, annaId, {
        ean: '4260000000011',
        name: 'Anderer Name',
        variant: null,
        brand: null,
        categoryIds: [],
        notes: null,
      });
      expect.unreachable('a taken EAN has to be a conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toMatchObject({ productId: first.product.id });
    }
  });
});

describe('categories of a product', () => {
  it('carries the chosen categories, alphabetically', () => {
    const drinks = createCategory(database.db, { name: 'Getränke', frequent: true });
    const organic = createCategory(database.db, { name: 'Bio', frequent: false });

    const created = createProduct(database.db, annaId, {
      ean: '4260000000011',
      name: 'Apfelsaft',
      variant: null,
      brand: null,
      categoryIds: [drinks.id, organic.id],
      notes: null,
    });

    expect(created.product.categories.map((entry) => entry.name)).toEqual(['Bio', 'Getränke']);
    expect(getProduct(database.db, annaId, created.product.id).categories).toEqual([
      { id: organic.id, name: 'Bio' },
      { id: drinks.id, name: 'Getränke' },
    ]);
    expect(listProducts(database.db, annaId, query()).products[0]?.categories).toHaveLength(2);
  });

  it('refuses an identifier that is not on the list, and writes nothing', () => {
    expect(() =>
      createProduct(database.db, annaId, {
        ean: '4260000000011',
        name: 'Apfelsaft',
        variant: null,
        brand: null,
        categoryIds: ['gone'],
        notes: null,
      }),
    ).toThrow(ValidationError);

    expect(listProducts(database.db, annaId, query()).total).toBe(0);
  });

  it('filters the list by one category among several', () => {
    const seeded = seedDatabase(database.db, {
      products: [
        {
          ean: '4260000000011',
          name: 'Hafermilch',
          categories: ['Getränke', 'Vegan'],
          createdBy: annaId,
        },
        { ean: '4260000000028', name: 'Apfelsaft', categories: ['Getränke'], createdBy: annaId },
        { ean: '4260000000035', name: 'Tofu', categories: ['Vegan'], createdBy: annaId },
      ],
    });
    const vegan = seeded.categories?.find((entry) => entry.name === 'Vegan')?.id ?? '';

    const page = listProducts(database.db, annaId, query({ categoryId: vegan, sort: 'name' }));

    expect(page.total).toBe(2);
    expect(page.products.map((product) => product.name)).toEqual(['Hafermilch', 'Tofu']);
  });

  it('loses a deleted category, and nothing else', () => {
    const seeded = seedDatabase(database.db, {
      products: [
        {
          ean: '4260000000011',
          name: 'Hafermilch',
          categories: ['Getränke', 'Vegan'],
          createdBy: annaId,
        },
      ],
    });
    const productId = seeded.products?.[0]?.id ?? '';
    const vegan = seeded.categories?.find((entry) => entry.name === 'Vegan')?.id ?? '';

    expect(deleteCategory(database.db, vegan).removedFrom).toBe(1);

    const product = getProduct(database.db, annaId, productId);
    expect(product.categories.map((entry) => entry.name)).toEqual(['Getränke']);
  });
});

describe('updateProduct', () => {
  it('only touches the fields that were sent', () => {
    const drinks = createCategory(database.db, { name: 'Getränke', frequent: false });
    const juice = createCategory(database.db, { name: 'Saft', frequent: false });
    const created = createProduct(database.db, annaId, {
      ean: '4260000000011',
      name: 'Apfelsaft',
      variant: 'naturtrüb',
      brand: 'Bio Hof',
      categoryIds: [drinks.id],
      notes: 'trüb',
    });

    const updated = updateProduct(database.db, created.product.id, { categoryIds: [juice.id] });

    expect(updated.categories).toEqual([{ id: juice.id, name: 'Saft' }]);
    expect(updated.variant).toBe('naturtrüb');
    expect(updated.brand).toBe('Bio Hof');
    expect(updated.notes).toBe('trüb');
  });

  it('clears the variant when an empty one is sent', () => {
    const created = createProduct(database.db, annaId, {
      ean: '4260000000011',
      name: '5 Minuten Terrine',
      variant: 'Spaghetti Bolognese',
      brand: null,
      categoryIds: [],
      notes: null,
    });

    // `null` is a value, not "leave it alone" — the form sends it when
    // somebody empties the field.
    expect(updateProduct(database.db, created.product.id, { variant: null }).variant).toBeNull();
  });

  it('keeps the categories unless they are sent, and clears them with an empty list', () => {
    const drinks = createCategory(database.db, { name: 'Getränke', frequent: false });
    const created = createProduct(database.db, annaId, {
      ean: '4260000000011',
      name: 'Apfelsaft',
      variant: null,
      brand: null,
      categoryIds: [drinks.id],
      notes: null,
    });

    expect(updateProduct(database.db, created.product.id, { name: 'Saft' }).categories).toEqual([
      { id: drinks.id, name: 'Getränke' },
    ]);
    expect(updateProduct(database.db, created.product.id, { categoryIds: [] }).categories).toEqual(
      [],
    );
  });

  it('fails for an unknown product', () => {
    expect(() => updateProduct(database.db, 'nope', { name: 'X' })).toThrow(NotFoundError);
  });
});

describe('the trash', () => {
  /** A product with two ratings, the case both trash routes have to handle. */
  function ratedProduct(): string {
    const seeded = seedDatabase(database.db, {
      users: [{ username: 'bert' }],
      products: [
        { ean: '4260000000011', name: 'Apfelsaft', categories: ['Getränke'], createdBy: annaId },
      ],
    });
    const productId = seeded.products?.[0]?.id ?? '';

    seedDatabase(database.db, {
      ratings: [
        { productId, userId: annaId, stars: 5 },
        { productId, userId: seeded.users?.[0]?.id ?? '', stars: 3 },
      ],
    });

    return productId;
  }

  it('takes a deleted product out of every reading query, but keeps its rows', () => {
    const productId = ratedProduct();

    const trashed = trashProduct(database.db, productId, annaId);

    expect(trashed.ratings).toBe(2);
    expect(listProducts(database.db, annaId, query()).total).toBe(0);
    // The category stays on the product, but the count is of the catalogue.
    expect(listCategories(database.db)).toMatchObject([{ name: 'Getränke', productCount: 0 }]);
    expect(listTrash(database.db)[0]?.product.categories).toMatchObject([{ name: 'Getränke' }]);
    expect(() => getProduct(database.db, annaId, productId)).toThrow(NotFoundError);
    expect(listTrash(database.db).map((entry) => entry.product.id)).toEqual([productId]);
    expect(listTrash(database.db)[0]).toMatchObject({ ratings: 2, photos: 0 });
  });

  it('brings a restored product back with its ratings', () => {
    const productId = ratedProduct();
    trashProduct(database.db, productId, annaId);

    restoreProduct(database.db, productId);

    expect(getProduct(database.db, annaId, productId).ratings).toEqual({ average: 4, count: 2 });
    expect(listTrash(database.db)).toEqual([]);
  });

  it('answers a scan of a trashed EAN by bringing the product back', () => {
    const productId = ratedProduct();
    trashProduct(database.db, productId, annaId);

    const created = createProduct(database.db, annaId, {
      ean: '4260000000011',
      name: 'Apfelsaft naturtrüb',
      variant: null,
      brand: null,
      categoryIds: [],
      notes: null,
    });

    expect(created.restored).toBe(true);
    expect(created.product.id).toBe(productId);
    // The freshly entered data wins, categories included; the ratings come
    // back untouched.
    expect(created.product.name).toBe('Apfelsaft naturtrüb');
    expect(created.product.categories).toEqual([]);
    expect(getProduct(database.db, annaId, productId).ratings.count).toBe(2);
  });

  it('removes rows only when the trash is emptied', () => {
    const productId = ratedProduct();

    expect(() => purgeProduct(database.db, productId)).toThrow(NotFoundError);

    trashProduct(database.db, productId, annaId);
    const removed = purgeProduct(database.db, productId);

    expect(removed.removedRatings).toBe(2);
    expect(removed.removedPhotos).toEqual([]);
    // The assignment went with the product, the entry of the list did not.
    expect(database.db.select().from(productCategories).all()).toEqual([]);
    expect(listCategories(database.db).map((entry) => entry.name)).toEqual(['Getränke']);
    expect(listTrash(database.db)).toEqual([]);
    expect(() => purgeProduct(database.db, productId)).toThrow(NotFoundError);
  });

  it('empties by retention, and never when it is switched off', () => {
    const productId = ratedProduct();
    const deletedAt = new Date('2026-08-01T10:00:00Z');
    const later = new Date('2026-09-01T10:00:00Z');

    trashProduct(database.db, productId, annaId, deletedAt);

    expect(purgeExpiredTrash(database.db, 0, later)).toEqual([]);
    expect(purgeExpiredTrash(database.db, 90, later)).toEqual([]);

    const purged = purgeExpiredTrash(database.db, 30, later);
    expect(purged.map((entry) => entry.product.id)).toEqual([productId]);
    expect(listTrash(database.db)).toEqual([]);
  });
});
