import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
  PRODUCT_SORT_FIELDS,
  PRODUCT_SORT_ORDERS,
  type CreateProductInput,
  type Product,
  type ProductListPage,
  type ProductListQuery,
  type ProductSortField,
  type ProductSortOrder,
  type ProductWithRatings,
  type Rating,
  type UpdateProductInput,
} from '@product-rating/shared';
import type { DbHandle } from '../db/index.js';
import {
  LOWER_FUNCTION,
  photos,
  products,
  ratings,
  type PhotoRow,
  type ProductRow,
  type RatingRow,
} from '../db/index.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';

/**
 * The shared product catalogue.
 *
 * An EAN exists exactly once across all users, so creating a product is really
 * "claim this EAN or tell me who has it": a duplicate is answered with the
 * existing identifier instead of a bare error, which is what the scanner needs
 * in order to jump to the product it just found.
 *
 * Reading always happens from one caller's point of view — their own rating,
 * the overall average and the number of ratings come along with every product,
 * so the list view needs no second round trip.
 */

/**
 * The caller's own rating, joined under its own name. Without the alias the
 * correlated subqueries below would resolve `ratings` to the joined row and
 * report the caller's rating as the average.
 */
const ownRatings = alias(ratings, 'own_rating');

const averageExpression = sql<number | null>`(
  select avg(${ratings.stars}) from ${ratings} where ${ratings.productId} = ${products.id}
)`;

const ratingCountExpression = sql<number>`(
  select count(*) from ${ratings} where ${ratings.productId} = ${products.id}
)`;

/** The photo marked as primary, falling back to the oldest one. */
const primaryPhotoExpression = sql<string | null>`(
  select ${photos.id} from ${photos}
  where ${photos.productId} = ${products.id}
  order by ${photos.isPrimary} desc, ${photos.createdAt} asc
  limit 1
)`;

/** Average of an unrated product, used where SQL cannot sort or compare NULL. */
const UNRATED_SORT_VALUE = -1;

interface ProductQueryRow {
  product: ProductRow;
  own: RatingRow | null;
  average: number | null;
  ratingCount: number;
  primaryPhotoId: string | null;
}

export function toPublicProduct(row: ProductRow): Product {
  return {
    id: row.id,
    ean: row.ean,
    name: row.name,
    brand: row.brand,
    category: row.category,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPublicRating(row: RatingRow): Rating {
  return {
    productId: row.productId,
    userId: row.userId,
    stars: row.stars,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProductWithRatings(row: ProductQueryRow): ProductWithRatings {
  return {
    ...toPublicProduct(row.product),
    ownRating: row.own === null ? null : toPublicRating(row.own),
    ratings: {
      // Two decimals are as much as five stars can meaningfully carry.
      average: row.average === null ? null : Math.round(row.average * 100) / 100,
      count: row.ratingCount,
    },
    primaryPhotoId: row.primaryPhotoId,
  };
}

/** Selects products together with the caller's rating and the aggregates. */
function selectProducts(db: DbHandle, userId: string) {
  return db
    .select({
      product: products,
      own: ownRatings,
      average: averageExpression,
      ratingCount: ratingCountExpression,
      primaryPhotoId: primaryPhotoExpression,
    })
    .from(products)
    .leftJoin(
      ownRatings,
      and(eq(ownRatings.productId, products.id), eq(ownRatings.userId, userId)),
    );
}

export function findProductById(db: DbHandle, id: string): ProductRow | undefined {
  return db.select().from(products).where(eq(products.id, id)).get();
}

export function findProductByEan(db: DbHandle, ean: string): ProductRow | undefined {
  return db.select().from(products).where(eq(products.ean, ean)).get();
}

/** One product from the caller's point of view. */
export function getProduct(db: DbHandle, userId: string, id: string): ProductWithRatings {
  const row = selectProducts(db, userId).where(eq(products.id, id)).get();
  if (row === undefined) throw new NotFoundError('product not found');
  return toProductWithRatings(row);
}

/** Lookup after a scan. The EAN is expected in its normalised form. */
export function getProductByEan(db: DbHandle, userId: string, ean: string): ProductWithRatings {
  const row = selectProducts(db, userId).where(eq(products.ean, ean)).get();
  if (row === undefined) throw new NotFoundError('no product with this EAN', { ean });
  return toProductWithRatings(row);
}

/**
 * Adds a product to the shared catalogue.
 *
 * A taken EAN is a conflict, not a failure: the response carries the existing
 * product so the client can go there directly.
 */
export function createProduct(
  db: DbHandle,
  userId: string,
  input: CreateProductInput,
  now: Date = new Date(),
): Product {
  const existing = findProductByEan(db, input.ean);
  if (existing !== undefined) throw eanConflict(existing);

  const row: ProductRow = {
    id: randomUUID(),
    ean: input.ean,
    name: input.name,
    brand: input.brand,
    category: input.category,
    notes: input.notes,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    db.insert(products).values(row).run();
  } catch (error) {
    // Two clients scanning the same new product at the same time.
    if (String(error).includes('UNIQUE')) {
      const claimed = findProductByEan(db, input.ean);
      if (claimed !== undefined) throw eanConflict(claimed);
    }
    throw error;
  }

  return toPublicProduct(row);
}

function eanConflict(existing: ProductRow): ConflictError {
  return new ConflictError('a product with this EAN already exists', {
    field: 'ean',
    ean: existing.ean,
    productId: existing.id,
  });
}

/**
 * Changes a product. The catalogue is shared, so every account may correct a
 * name or add a category — ownership only matters for ratings and photos.
 */
export function updateProduct(
  db: DbHandle,
  id: string,
  input: UpdateProductInput,
  now: Date = new Date(),
): Product {
  const existing = findProductById(db, id);
  if (existing === undefined) throw new NotFoundError('product not found');

  const changes: Partial<ProductRow> = { updatedAt: now };
  if (input.name !== undefined) changes.name = input.name;
  if (input.brand !== undefined) changes.brand = input.brand;
  if (input.category !== undefined) changes.category = input.category;
  if (input.notes !== undefined) changes.notes = input.notes;

  db.update(products).set(changes).where(eq(products.id, id)).run();

  const updated = findProductById(db, id);
  if (updated === undefined) throw new NotFoundError('product not found');
  return toPublicProduct(updated);
}

export interface DeletedProduct {
  product: Product;
  /** Ratings removed along with the product, for the log. */
  removedRatings: number;
  /**
   * Photo rows removed by the cascade. Their files still have to go; the
   * upload layout only exists from M6 on, which is where the caller deletes
   * them.
   */
  removedPhotos: PhotoRow[];
}

/** Removes a product with everything hanging off it. Administrators only. */
export function deleteProduct(db: DbHandle, id: string): DeletedProduct {
  const existing = findProductById(db, id);
  if (existing === undefined) throw new NotFoundError('product not found');

  const attachedPhotos = db.select().from(photos).where(eq(photos.productId, id)).all();
  const attachedRatings = db
    .select({ value: sql<number>`count(*)` })
    .from(ratings)
    .where(eq(ratings.productId, id))
    .get();

  // `ratings` and `photos` reference the product with `on delete cascade`, and
  // `foreign_keys = ON` is set on every connection, so one statement is enough.
  db.delete(products).where(eq(products.id, id)).run();

  return {
    product: toPublicProduct(existing),
    removedRatings: attachedRatings?.value ?? 0,
    removedPhotos: attachedPhotos,
  };
}

/* ------------------------------------------------------------------ search */

/** `%` and `_` are wildcards in LIKE and have to survive a search term. */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Case insensitive `LIKE` over a column, using the Unicode aware folding. */
function containsInsensitive(column: SQLiteColumn, term: string): SQL {
  const pattern = `%${escapeLikePattern(term)}%`;
  return sql`${sql.raw(LOWER_FUNCTION)}(coalesce(${column}, '')) like ${sql.raw(LOWER_FUNCTION)}(${pattern}) escape '\\'`;
}

/** Shortest digit run that is looked up as an EAN prefix rather than as text. */
const EAN_SEARCH_MIN_DIGITS = 4;

/**
 * Free text search over name and brand, plus an EAN prefix when the term looks
 * like part of a barcode. Digits are matched against the stored, normalised
 * EAN, so typing the tail of a code finds nothing — that is deliberate, a
 * prefix hits the index while a substring would scan the table.
 */
function searchCondition(term: string): SQL | undefined {
  const conditions: SQL[] = [
    containsInsensitive(products.name, term),
    containsInsensitive(products.brand, term),
  ];

  const digits = term.replace(/\D/g, '');
  if (digits.length >= EAN_SEARCH_MIN_DIGITS) {
    conditions.push(sql`${products.ean} like ${`${digits}%`}`);
  }

  return or(...conditions);
}

function filterConditions(query: ProductListQuery): SQL[] {
  const conditions: SQL[] = [];

  const term = query.q?.trim();
  if (term !== undefined && term.length > 0) {
    const condition = searchCondition(term);
    if (condition !== undefined) conditions.push(condition);
  }

  const category = query.category?.trim();
  if (category !== undefined && category.length > 0) {
    conditions.push(
      sql`${sql.raw(LOWER_FUNCTION)}(${products.category}) = ${sql.raw(LOWER_FUNCTION)}(${category})`,
    );
  }

  if (query.minStars !== undefined) {
    // An unrated product has no average and therefore reaches no minimum.
    conditions.push(sql`${averageExpression} >= ${query.minStars}`);
  }

  if (query.ratedByMe === true) {
    conditions.push(sql`${ownRatings.id} is not null`);
  }

  return conditions;
}

/* --------------------------------------------------------------- ordering */

/** The value a page is cut at, per sort field. */
type CursorKey = string | number;

function sortExpression(sort: ProductSortField): SQLiteColumn | SQL {
  switch (sort) {
    case 'name':
      return products.name;
    case 'created':
      return products.createdAt;
    case 'updated':
      return products.updatedAt;
    case 'rating':
      return sql`coalesce(${averageExpression}, ${UNRATED_SORT_VALUE})`;
  }
}

function cursorKeyOf(row: ProductQueryRow, sort: ProductSortField): CursorKey {
  switch (sort) {
    case 'name':
      return row.product.name;
    case 'created':
      return row.product.createdAt.getTime();
    case 'updated':
      return row.product.updatedAt.getTime();
    case 'rating':
      return row.average ?? UNRATED_SORT_VALUE;
  }
}

/**
 * Keyset condition for everything after the cursor.
 *
 * The identifier breaks ties in ascending direction regardless of the sort
 * order, which is exactly how the `ORDER BY` below is built — otherwise rows
 * sharing a name or a rating could appear twice or not at all.
 */
function keysetCondition(sort: ProductSortField, order: ProductSortOrder, cursor: Cursor): SQL {
  const expression = sortExpression(sort);
  const comparison =
    order === 'asc' ? sql`${expression} > ${cursor.key}` : sql`${expression} < ${cursor.key}`;

  return sql`(${comparison} or (${expression} = ${cursor.key} and ${products.id} > ${cursor.id}))`;
}

interface Cursor {
  key: CursorKey;
  id: string;
}

const cursorSchema = z.object({
  s: z.enum(PRODUCT_SORT_FIELDS),
  o: z.enum(PRODUCT_SORT_ORDERS),
  k: z.union([z.string(), z.number()]),
  i: z.string().min(1),
});

/**
 * Cursors carry the sorting they were produced with. Changing sort or order
 * mid-scroll would otherwise silently skip or repeat products.
 */
export function encodeCursor(
  sort: ProductSortField,
  order: ProductSortOrder,
  cursor: Cursor,
): string {
  const payload = JSON.stringify({ s: sort, o: order, k: cursor.key, i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(
  value: string,
  sort: ProductSortField,
  order: ProductSortOrder,
): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('cursor is not readable', { field: 'cursor' });
  }

  const result = cursorSchema.safeParse(parsed);
  if (!result.success) throw new ValidationError('cursor is not readable', { field: 'cursor' });
  if (result.data.s !== sort || result.data.o !== order) {
    throw new ValidationError('cursor belongs to a different sorting', { field: 'cursor' });
  }

  return { key: result.data.k, id: result.data.i };
}

/** Ascending for names, newest and best first for everything else. */
export function defaultOrderFor(sort: ProductSortField): ProductSortOrder {
  return sort === 'name' ? 'asc' : 'desc';
}

/* ------------------------------------------------------------------- list */

export function listProducts(
  db: DbHandle,
  userId: string,
  query: ProductListQuery,
): ProductListPage {
  const { sort, limit } = query;
  const order = query.order ?? defaultOrderFor(sort);
  const filters = filterConditions(query);

  const total =
    db
      .select({ value: sql<number>`count(*)` })
      .from(products)
      .leftJoin(
        ownRatings,
        and(eq(ownRatings.productId, products.id), eq(ownRatings.userId, userId)),
      )
      .where(and(...filters))
      .get()?.value ?? 0;

  const pageFilters = [...filters];
  if (query.cursor !== undefined) {
    pageFilters.push(keysetCondition(sort, order, decodeCursor(query.cursor, sort, order)));
  }

  const expression = sortExpression(sort);
  const rows = selectProducts(db, userId)
    .where(and(...pageFilters))
    .orderBy(order === 'asc' ? asc(expression) : desc(expression), asc(products.id))
    // One row beyond the page tells us whether another page exists.
    .limit(limit + 1)
    .all();

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    products: page.map(toProductWithRatings),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(sort, order, { key: cursorKeyOf(last, sort), id: last.product.id })
        : null,
    total,
  };
}
