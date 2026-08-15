import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { myRatingsQuerySchema, type MyRatingsQuery } from '@product-rating/shared';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../db/testing.js';
import { NotFoundError } from './errors.js';
import { deleteRating, listOwnRatings, ratingSummary, upsertRating } from './ratings.js';

/**
 * Service level tests for what the route tests cannot reach comfortably: the
 * timestamps of a repeated save, paging across identical star counts and the
 * aggregate on its own.
 */

let database: TestDatabase;
let annaId: string;
let bertId: string;

/** Valid EAN-13 codes; the check digit matters, these are not random digits. */
const EANS = [
  '4260000000011',
  '4260000000028',
  '4260000000035',
  '4260000000042',
  '4260000000059',
] as const;

function query(overrides: Record<string, unknown> = {}): MyRatingsQuery {
  return myRatingsQuerySchema.parse(overrides);
}

/** Seeds `count` products and returns their identifiers. */
function seedProducts(count: number): string[] {
  const seeded = seedDatabase(database.db, {
    products: Array.from({ length: count }, (_, index) => ({
      ean: EANS[index] ?? '',
      name: `Produkt ${index + 1}`,
      createdBy: annaId,
    })),
  });
  return (seeded.products ?? []).map((product) => product.id ?? '');
}

beforeEach(() => {
  database = createTestDatabase();
  const seeded = seedDatabase(database.db, {
    users: [{ username: 'anna' }, { username: 'bert' }],
  });
  annaId = seeded.users?.[0]?.id ?? '';
  bertId = seeded.users?.[1]?.id ?? '';
});

afterEach(() => {
  database.close();
});

describe('upsertRating', () => {
  it('keeps the first verdict as creation date and moves the change date', () => {
    const [productId = ''] = seedProducts(1);
    const first = new Date('2026-08-01T10:00:00Z');
    const second = new Date('2026-08-05T10:00:00Z');

    const created = upsertRating(
      database.db,
      annaId,
      productId,
      { stars: 2, comment: null },
      first,
    );
    expect(created.created).toBe(true);

    const updated = upsertRating(
      database.db,
      annaId,
      productId,
      { stars: 4, comment: 'besser als gedacht' },
      second,
    );

    expect(updated.created).toBe(false);
    expect(updated.rating.createdAt).toBe(first.toISOString());
    expect(updated.rating.updatedAt).toBe(second.toISOString());
    expect(updated.summary).toEqual({ average: 4, count: 1 });
  });

  it('refuses to rate a product that does not exist', () => {
    expect(() =>
      upsertRating(database.db, annaId, 'does-not-exist', { stars: 3, comment: null }),
    ).toThrow(NotFoundError);
  });
});

describe('deleteRating', () => {
  it('reports the aggregate that is left and refuses a second attempt', () => {
    const [productId = ''] = seedProducts(1);
    upsertRating(database.db, annaId, productId, { stars: 5, comment: null });
    upsertRating(database.db, bertId, productId, { stars: 2, comment: null });

    expect(deleteRating(database.db, annaId, productId)).toEqual({ average: 2, count: 1 });
    expect(() => deleteRating(database.db, annaId, productId)).toThrow(NotFoundError);

    // Bert's rating is untouched by Anna's deletions.
    expect(ratingSummary(database.db, productId)).toEqual({ average: 2, count: 1 });
  });
});

describe('ratingSummary', () => {
  it('rounds the average to two decimals and reports an unrated product as null', () => {
    const [rated = '', unrated = ''] = seedProducts(2);
    const seeded = seedDatabase(database.db, { users: [{ username: 'carla' }] });
    const carlaId = seeded.users?.[0]?.id ?? '';

    // 1, 2 and 2 stars average to 1.6666…
    seedDatabase(database.db, {
      ratings: [
        { productId: rated, userId: annaId, stars: 1 },
        { productId: rated, userId: bertId, stars: 2 },
        { productId: rated, userId: carlaId, stars: 2 },
      ],
    });

    expect(ratingSummary(database.db, rated)).toEqual({ average: 1.67, count: 3 });
    expect(ratingSummary(database.db, unrated)).toEqual({ average: null, count: 0 });
  });
});

describe('listOwnRatings', () => {
  it('pages through ratings with the same star count', () => {
    const productIds = seedProducts(5);
    seedDatabase(database.db, {
      // Same stars and the same rating date: only the identifier breaks the tie.
      ratings: productIds.map((productId) => ({
        productId,
        userId: annaId,
        stars: 3,
        updatedAt: new Date('2026-08-01T10:00:00Z'),
      })),
    });

    for (const sort of ['stars', 'rated'] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;

      do {
        const page = listOwnRatings(database.db, annaId, {
          ...query({ sort, limit: 2 }),
          ...(cursor === null ? {} : { cursor }),
        });
        seen.push(...page.ratings.map((entry) => entry.id));
        cursor = page.nextCursor;
        guard += 1;
      } while (cursor !== null && guard < 20);

      expect(new Set(seen).size).toBe(5);
    }
  });

  it('counts only the callers own ratings in the total', () => {
    const [first = '', second = ''] = seedProducts(2);
    seedDatabase(database.db, {
      ratings: [
        { productId: first, userId: annaId, stars: 3 },
        { productId: first, userId: bertId, stars: 1 },
        { productId: second, userId: bertId, stars: 5 },
      ],
    });

    const page = listOwnRatings(database.db, annaId, query());
    expect(page.total).toBe(1);
    expect(page.ratings).toHaveLength(1);
    // The overall average covers everyone, the own rating only the caller.
    expect(page.ratings[0]?.ownRating.stars).toBe(3);
    expect(page.ratings[0]?.ratings).toEqual({ average: 2, count: 2 });
  });
});
