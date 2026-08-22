import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  PRODUCT_CATEGORY_SUGGESTION_LIMIT,
  TRASH_LIST_LIMIT,
  toRatingSummary,
  type CreateProductInput,
  type Product,
  type ProductListPage,
  type ProductListQuery,
  type ProductSortField,
  type ProductWithRatings,
  type Rating,
  type TrashEntry,
  type UpdateProductInput,
} from '@product-rating/shared';
import type { DbHandle } from '../db/index.js';
import {
  LOWER_FUNCTION,
  photos,
  products,
  ratings,
  users,
  type PhotoRow,
  type ProductRow,
  type RatingRow,
} from '../db/index.js';
import { ConflictError, NotFoundError } from './errors.js';
import {
  decodeCursor,
  defaultOrderFor,
  encodeCursor,
  keysetCondition,
  type CursorKey,
} from './pagination.js';

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
 *
 * Deleting is two steps. `DELETE` puts a product into the trash: the row keeps
 * its ratings, its photos and above all its EAN, and every reading query simply
 * stops seeing it. Only emptying the trash — by hand or after
 * `app.trash_retention_days` — takes the rows and the image files with it.
 */

/**
 * The caller's own rating, joined under its own name. Without the alias the
 * correlated subqueries below would resolve `ratings` to the joined row and
 * report the caller's rating as the average.
 *
 * Exported because the list of own ratings (`services/ratings.ts`) sorts by the
 * caller's stars and rating date and needs the very same join to do so.
 */
export const ownRatings = alias(ratings, 'own_rating');

/**
 * Average and count per product as correlated subqueries.
 *
 * Both run against `ratings_product_user_unique`, whose leading column is
 * `product_id`, so each one is an index lookup over the few rows of that
 * product rather than a table scan. A grouped join would compute the aggregate
 * for the whole table even when a single product is asked for — which is
 * exactly the request the scanner makes most often.
 */
const averageExpression = sql<number | null>`(
  select avg(${ratings.stars}) from ${ratings} where ${ratings.productId} = ${products.id}
)`;

const ratingCountExpression = sql<number>`(
  select count(*) from ${ratings} where ${ratings.productId} = ${products.id}
)`;

/** The first photo of the gallery; that is what "primary" means. */
const primaryPhotoExpression = sql<string | null>`(
  select ${photos.id} from ${photos}
  where ${photos.productId} = ${products.id}
  order by ${photos.position} asc, ${photos.createdAt} asc
  limit 1
)`;

/**
 * The condition every reading query carries: a product in the trash is not part
 * of the catalogue. It is a filter rather than a second table, because that is
 * what makes restoring a single `UPDATE` and keeps the EAN claimed while the
 * product is gone.
 */
export const notTrashed = isNull(products.deletedAt);

/** Average of an unrated product, used where SQL cannot sort or compare NULL. */
const UNRATED_SORT_VALUE = -1;

export interface ProductQueryRow {
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

export function toProductWithRatings(row: ProductQueryRow): ProductWithRatings {
  return {
    ...toPublicProduct(row.product),
    ownRating: row.own === null ? null : toPublicRating(row.own),
    ratings: toRatingSummary(row.average, row.ratingCount),
    primaryPhotoId: row.primaryPhotoId,
  };
}

/** Selects products together with the caller's rating and the aggregates. */
export function selectProducts(db: DbHandle, userId: string) {
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

/**
 * A product of the catalogue. Rows in the trash stay out of reach here: nothing
 * that edits, rates or photographs a product may find one that was deleted.
 */
export function findProductById(db: DbHandle, id: string): ProductRow | undefined {
  return db
    .select()
    .from(products)
    .where(and(eq(products.id, id), notTrashed))
    .get();
}

/** The same by identifier, but including the trash — used by the trash routes. */
export function findAnyProductById(db: DbHandle, id: string): ProductRow | undefined {
  return db.select().from(products).where(eq(products.id, id)).get();
}

/**
 * Looks an EAN up across the whole table, trash included: the unique index does
 * not care whether a product is deleted, so a caller claiming an EAN has to see
 * the row that holds it.
 */
export function findProductByEan(db: DbHandle, ean: string): ProductRow | undefined {
  return db.select().from(products).where(eq(products.ean, ean)).get();
}

/** One product from the caller's point of view. */
export function getProduct(db: DbHandle, userId: string, id: string): ProductWithRatings {
  const row = selectProducts(db, userId)
    .where(and(eq(products.id, id), notTrashed))
    .get();
  if (row === undefined) throw new NotFoundError('product not found');
  return toProductWithRatings(row);
}

/** Lookup after a scan. The EAN is expected in its normalised form. */
export function getProductByEan(db: DbHandle, userId: string, ean: string): ProductWithRatings {
  const row = selectProducts(db, userId)
    .where(and(eq(products.ean, ean), notTrashed))
    .get();
  if (row === undefined) throw new NotFoundError('no product with this EAN', { ean });
  return toProductWithRatings(row);
}

/**
 * The categories the catalogue already uses, alphabetically.
 *
 * A category is free text on the product rather than a table of its own: a
 * household decides for itself whether it sorts by aisle or by shelf, and a
 * fixed list would only be in the way. What keeps that from ending in five
 * spellings of the same word is this list — the product form offers what is
 * already there, so the second yoghurt gets the category the first one got.
 *
 * Sorting happens here rather than in SQL because `SELECT DISTINCT` in SQLite
 * only orders by columns of its own result set, and a case sensitive order
 * would put "Tiefkühl" behind "obst". `localeCompare` also gets the umlauts
 * right, which a byte comparison does not.
 */
export function listCategories(db: DbHandle): string[] {
  return db
    .selectDistinct({ category: products.category })
    .from(products)
    .where(and(isNotNull(products.category), notTrashed))
    .all()
    .map((row) => row.category)
    .filter((category): category is string => category !== null && category !== '')
    .sort((left, right) => left.localeCompare(right, 'de'))
    .slice(0, PRODUCT_CATEGORY_SUGGESTION_LIMIT);
}

export interface CreatedProduct {
  product: Product;
  /** True when the EAN was in the trash and the product came back with it. */
  restored: boolean;
}

/**
 * Adds a product to the shared catalogue.
 *
 * A taken EAN is a conflict, not a failure: the response carries the existing
 * product so the client can go there directly.
 *
 * An EAN that is in the trash is a third case. Refusing it would be a dead end
 * — the scanner cannot create the product, and the account in front of it may
 * not even see the trash — so the deleted product comes back and takes the
 * submitted data as a correction. Ratings and photos return with it, which is
 * the outcome somebody scanning the article again is after.
 */
export function createProduct(
  db: DbHandle,
  userId: string,
  input: CreateProductInput,
  now: Date = new Date(),
): CreatedProduct {
  const existing = findProductByEan(db, input.ean);
  if (existing !== undefined && existing.deletedAt !== null) {
    return { product: restoreWithData(db, existing, input, now), restored: true };
  }
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
    deletedAt: null,
    deletedBy: null,
  };

  try {
    db.insert(products).values(row).run();
  } catch (error) {
    // Two clients scanning the same new product at the same time.
    if (String(error).includes('UNIQUE')) {
      const claimed = findProductByEan(db, input.ean);
      if (claimed !== undefined && claimed.deletedAt !== null) {
        return { product: restoreWithData(db, claimed, input, now), restored: true };
      }
      if (claimed !== undefined) throw eanConflict(claimed);
    }
    throw error;
  }

  return { product: toPublicProduct(row), restored: false };
}

/** Brings a trashed product back and writes the freshly entered data over it. */
function restoreWithData(
  db: DbHandle,
  existing: ProductRow,
  input: CreateProductInput,
  now: Date,
): Product {
  const row: ProductRow = {
    ...existing,
    name: input.name,
    brand: input.brand,
    category: input.category,
    notes: input.notes,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  };

  db.update(products)
    .set({
      name: row.name,
      brand: row.brand,
      category: row.category,
      notes: row.notes,
      updatedAt: row.updatedAt,
      deletedAt: null,
      deletedBy: null,
    })
    .where(eq(products.id, existing.id))
    .run();

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
   * Photo rows removed by the cascade. Their files are not the database's
   * business, so the caller hands them to `removePhotoFiles()` once the
   * deletion has gone through.
   */
  removedPhotos: PhotoRow[];
}

/* ------------------------------------------------------------------ trash */

/** Number of ratings and photos hanging off a product. */
function attachedCounts(db: DbHandle, id: string): { ratings: number; photos: number } {
  const ratingCount = db
    .select({ value: sql<number>`count(*)` })
    .from(ratings)
    .where(eq(ratings.productId, id))
    .get();
  const photoCount = db
    .select({ value: sql<number>`count(*)` })
    .from(photos)
    .where(eq(photos.productId, id))
    .get();

  return { ratings: ratingCount?.value ?? 0, photos: photoCount?.value ?? 0 };
}

export interface TrashedProduct {
  product: Product;
  /** Ratings and photos that went into the trash with it, for the log. */
  ratings: number;
  photos: number;
}

/**
 * Moves a product into the trash. Administrators only, because it takes other
 * accounts' ratings and photos out of the catalogue with it — reversibly, which
 * is the whole point of the exercise.
 */
export function trashProduct(
  db: DbHandle,
  id: string,
  userId: string,
  now: Date = new Date(),
): TrashedProduct {
  const existing = findProductById(db, id);
  if (existing === undefined) throw new NotFoundError('product not found');

  db.update(products).set({ deletedAt: now, deletedBy: userId }).where(eq(products.id, id)).run();

  return {
    product: toPublicProduct({ ...existing, deletedAt: now, deletedBy: userId }),
    ...attachedCounts(db, id),
  };
}

/** Takes a product out of the trash, exactly as it went in. */
export function restoreProduct(db: DbHandle, id: string): Product {
  const existing = findAnyProductById(db, id);
  if (existing === undefined || existing.deletedAt === null) {
    throw new NotFoundError('no product with this identifier is in the trash');
  }

  db.update(products).set({ deletedAt: null, deletedBy: null }).where(eq(products.id, id)).run();

  return toPublicProduct({ ...existing, deletedAt: null, deletedBy: null });
}

/**
 * What is in the trash, most recently deleted first.
 *
 * Without paging: the trash is emptied on a schedule and holds the mistakes of
 * a household, not a catalogue. The limit is there so a script that deletes a
 * thousand products cannot turn this into a slow answer.
 */
export function listTrash(db: DbHandle): TrashEntry[] {
  const rows = db
    .select({
      product: products,
      username: users.username,
      ratingCount: sql<number>`(
        select count(*) from ${ratings} where ${ratings.productId} = ${products.id}
      )`,
      photoCount: sql<number>`(
        select count(*) from ${photos} where ${photos.productId} = ${products.id}
      )`,
    })
    .from(products)
    .leftJoin(users, eq(users.id, products.deletedBy))
    .where(isNotNull(products.deletedAt))
    .orderBy(desc(products.deletedAt), asc(products.id))
    .limit(TRASH_LIST_LIMIT)
    .all();

  return rows.map((row) => ({
    product: toPublicProduct(row.product),
    // Only rows with a `deleted_at` are selected; the fallback pleases the types.
    deletedAt: (row.product.deletedAt ?? new Date(0)).toISOString(),
    deletedBy: row.product.deletedBy,
    deletedByUsername: row.username,
    ratings: row.ratingCount,
    photos: row.photoCount,
  }));
}

/**
 * Removes a product from the trash for good, with everything hanging off it.
 *
 * Only a product that is already in the trash can be purged: deleting is two
 * deliberate steps, and a route that could skip the first one would make the
 * trash a suggestion rather than a safety net.
 */
export function purgeProduct(db: DbHandle, id: string): DeletedProduct {
  const existing = findAnyProductById(db, id);
  if (existing === undefined || existing.deletedAt === null) {
    throw new NotFoundError('no product with this identifier is in the trash');
  }

  const attachedPhotos = db.select().from(photos).where(eq(photos.productId, id)).all();
  const counts = attachedCounts(db, id);

  // `ratings` and `photos` reference the product with `on delete cascade`, and
  // `foreign_keys = ON` is set on every connection, so one statement is enough.
  db.delete(products).where(eq(products.id, id)).run();

  return {
    product: toPublicProduct(existing),
    removedRatings: counts.ratings,
    removedPhotos: attachedPhotos,
  };
}

/**
 * Purges everything that has been in the trash longer than the retention.
 *
 * `app.trash_retention_days = 0` switches this off: a household that would
 * rather decide for itself when a photo is gone keeps its trash until somebody
 * empties it.
 */
export function purgeExpiredTrash(
  db: DbHandle,
  retentionDays: number,
  now: Date = new Date(),
): DeletedProduct[] {
  if (retentionDays <= 0) return [];

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const due = db
    .select({ id: products.id })
    .from(products)
    .where(and(isNotNull(products.deletedAt), lt(products.deletedAt, cutoff)))
    .all();

  return due.map((row) => purgeProduct(db, row.id));
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

/**
 * Shortest word the full text index can answer for.
 *
 * The index is built from trigrams, so it knows nothing about a fragment of one
 * or two characters. Those go back through `LIKE`, which is exact — a search
 * for "ei" has to find "Ei" whether an index can help or not.
 */
const FTS_MIN_TERM_LENGTH = 3;

/**
 * Turns a search term into an FTS5 query.
 *
 * Every word is quoted, which is what makes a hyphen, an umlaut or a stray
 * quote a piece of text instead of query syntax — unquoted, `bio-hof` is read
 * as a column name and the query fails. Several words are combined with the
 * implicit AND of FTS5: someone typing "kölln hafer" is narrowing down, not
 * asking for either.
 *
 * Returns `null` when at least one word is too short for the index; the caller
 * falls back to `LIKE` then rather than quietly searching for something else.
 */
export function ftsQuery(term: string): string | null {
  const words = term.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return null;
  if (words.some((word) => word.length < FTS_MIN_TERM_LENGTH)) return null;

  return words.map((word) => `"${word.replace(/"/g, '""')}"`).join(' ');
}

/** Free text search over name, brand and EAN through `LIKE`, as a fallback. */
function likeSearchCondition(term: string): SQL | undefined {
  return or(
    containsInsensitive(products.name, term),
    containsInsensitive(products.brand, term),
    containsInsensitive(products.ean, term),
  );
}

/**
 * Free text search over name, brand and EAN.
 *
 * The words go against `products_fts`, a trigram index kept up to date by
 * triggers on `products`. Trigrams are what makes this useful for German: a
 * search for "saft" finds "Apfelsaft", which a word based index never would,
 * and the tokenizer folds case and diacritics, so "koelln" aside, "kölln" and
 * "KÖLLN" are the same word. Digits work the same way — the tail of a barcode
 * finds its product, where the previous `LIKE` search could only match a
 * prefix.
 *
 * Short words are the exception, see `ftsQuery()`.
 */
function searchCondition(term: string): SQL | undefined {
  const query = ftsQuery(term);
  if (query === null) return likeSearchCondition(term);

  return sql`${products.id} in (
    select product_id from products_fts where products_fts match ${query}
  )`;
}

function filterConditions(query: ProductListQuery): SQL[] {
  const conditions: SQL[] = [notTrashed];

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

  const expression = sortExpression(sort);
  const pageFilters = [...filters];
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor, sort, order);
    pageFilters.push(keysetCondition(expression, order, products.id, cursor));
  }

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
