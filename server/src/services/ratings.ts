import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  toRatingSummary,
  type MyRatingsQuery,
  type ProductRating,
  type RatedProduct,
  type Rating,
  type RatingListPage,
  type RatingSortField,
  type RatingSummary,
  type UpsertRatingInput,
} from '@product-rating/shared';
import type { DbHandle } from '../db/index.js';
import { products, ratings, users, type RatingRow } from '../db/index.js';
import { NotFoundError } from './errors.js';
import {
  decodeCursor,
  defaultOrderFor,
  encodeCursor,
  keysetCondition,
  type CursorKey,
} from './pagination.js';
import {
  findProductById,
  notTrashed,
  ownRatings,
  selectProducts,
  toProductWithRatings,
  toPublicRating,
  type ProductQueryRow,
} from './products.js';

/**
 * Ratings: zero to five stars plus an optional comment, one per product and
 * account.
 *
 * A rating always belongs to the caller. The routes address it as "my rating of
 * this product", so there is no way to reach anyone else's — ownership is not
 * checked after the fact, it simply cannot be expressed. Saving is idempotent:
 * the same request twice leaves the same single row behind, which is what the
 * star widget needs when a tap is repeated on a flaky connection.
 */

/** The caller's own rating of a product, or nothing. */
export function findOwnRating(
  db: DbHandle,
  userId: string,
  productId: string,
): RatingRow | undefined {
  return db
    .select()
    .from(ratings)
    .where(and(eq(ratings.productId, productId), eq(ratings.userId, userId)))
    .get();
}

/**
 * Average and number of ratings of one product.
 *
 * Runs against `ratings_product_user_unique`, whose leading column is
 * `product_id`, so it reads only the rows of that product.
 */
export function ratingSummary(db: DbHandle, productId: string): RatingSummary {
  const row = db
    .select({
      average: sql<number | null>`avg(${ratings.stars})`,
      count: sql<number>`count(*)`,
    })
    .from(ratings)
    .where(eq(ratings.productId, productId))
    .get();

  return toRatingSummary(row?.average ?? null, row?.count ?? 0);
}

/**
 * Every rating of one product, newest verdict first, with the name of the
 * account behind it.
 *
 * Reading a shared catalogue means reading what the others thought of it. The
 * name is all that is exposed — a household knows its members anyway, and
 * anything more about an account is nobody else's business.
 */
export function listProductRatings(db: DbHandle, productId: string): ProductRating[] {
  return db
    .select({ rating: ratings, username: users.username })
    .from(ratings)
    .leftJoin(users, eq(users.id, ratings.userId))
    .where(eq(ratings.productId, productId))
    .orderBy(desc(ratings.updatedAt), asc(ratings.id))
    .all()
    .map((row) => ({ ...toPublicRating(row.rating), username: row.username }));
}

export interface RatingChange {
  rating: Rating;
  /** The product's aggregate after the change, so no second request is needed. */
  summary: RatingSummary;
  /** True when there was no rating before; the route answers `201` then. */
  created: boolean;
}

/**
 * Stores the caller's rating of a product, replacing an earlier one.
 *
 * Insert and update are one statement: two devices saving at the same moment
 * would otherwise let the second one fail on the unique index instead of simply
 * winning. `created_at` stays at the first verdict, `updated_at` moves.
 */
export function upsertRating(
  db: DbHandle,
  userId: string,
  productId: string,
  input: UpsertRatingInput,
  now: Date = new Date(),
): RatingChange {
  if (findProductById(db, productId) === undefined) throw new NotFoundError('product not found');

  const existing = findOwnRating(db, userId, productId);
  const row: RatingRow = {
    id: existing?.id ?? randomUUID(),
    productId,
    userId,
    stars: input.stars,
    comment: input.comment,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  db.insert(ratings)
    .values(row)
    .onConflictDoUpdate({
      target: [ratings.productId, ratings.userId],
      set: { stars: row.stars, comment: row.comment, updatedAt: row.updatedAt },
    })
    .run();

  // Read back rather than trust `row`: on the conflict path the stored
  // identifier and creation date are the ones of the row that was already there.
  const stored = findOwnRating(db, userId, productId);
  if (stored === undefined) throw new NotFoundError('rating not found after saving');

  return {
    rating: toPublicRating(stored),
    summary: ratingSummary(db, productId),
    created: existing === undefined,
  };
}

/** Removes the caller's own rating. Foreign ratings are out of reach here. */
export function deleteRating(db: DbHandle, userId: string, productId: string): RatingSummary {
  const existing = findOwnRating(db, userId, productId);
  if (existing === undefined) throw new NotFoundError('you have not rated this product');

  db.delete(ratings).where(eq(ratings.id, existing.id)).run();

  return ratingSummary(db, productId);
}

/* ------------------------------------------------------------------- list */

function sortExpression(sort: RatingSortField): SQLiteColumn | SQL {
  switch (sort) {
    case 'rated':
      return ownRatings.updatedAt;
    case 'stars':
      return ownRatings.stars;
    case 'name':
      return products.name;
  }
}

function cursorKeyOf(row: ProductQueryRow, sort: RatingSortField): CursorKey {
  switch (sort) {
    case 'rated':
      return row.own?.updatedAt.getTime() ?? 0;
    case 'stars':
      return row.own?.stars ?? 0;
    case 'name':
      return row.product.name;
  }
}

/** The caller's own rating is guaranteed by the filter, not by the types. */
function toRatedProduct(row: ProductQueryRow): RatedProduct {
  const product = toProductWithRatings(row);
  if (product.ownRating === null) {
    throw new Error('own ratings query returned a product without a rating');
  }
  return { ...product, ownRating: product.ownRating };
}

/**
 * The caller's own ratings, newest verdict first by default.
 *
 * Entries carry the whole product plus the overall average, so the list can be
 * rendered with the same card as the catalogue. Sorting by stars or by rating
 * date is what this route adds over `GET /products?ratedByMe=true`, which can
 * only sort by properties of the product.
 */
export function listOwnRatings(
  db: DbHandle,
  userId: string,
  query: MyRatingsQuery,
): RatingListPage {
  const { sort, limit } = query;
  const order = query.order ?? defaultOrderFor(sort);
  const expression = sortExpression(sort);

  // Joined against `products`, because a rating of a product in the trash is
  // not part of this list either — the count has to say the same as the rows.
  const total =
    db
      .select({ value: sql<number>`count(*)` })
      .from(ratings)
      .innerJoin(products, eq(products.id, ratings.productId))
      .where(and(eq(ratings.userId, userId), notTrashed))
      .get()?.value ?? 0;

  const filters: SQL[] = [sql`${ownRatings.id} is not null`, notTrashed];
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor, sort, order);
    filters.push(keysetCondition(expression, order, products.id, cursor));
  }

  const rows = selectProducts(db, userId)
    .where(and(...filters))
    .orderBy(order === 'asc' ? asc(expression) : desc(expression), asc(products.id))
    // One row beyond the page tells us whether another page exists.
    .limit(limit + 1)
    .all();

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    ratings: page.map(toRatedProduct),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(sort, order, { key: cursorKeyOf(last, sort), id: last.product.id })
        : null,
    total,
  };
}
