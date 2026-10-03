import { randomUUID } from 'node:crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  CATEGORY_NAME_MAX_LENGTH,
  type Category,
  type CategoryRef,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@product-rating/shared';
import type { DbHandle } from '../db/index.js';
import {
  LOWER_FUNCTION,
  categories,
  productCategories,
  products,
  type CategoryRow,
} from '../db/index.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';

/**
 * The category list of the catalogue.
 *
 * Administrators keep it, every account picks from it. A product carries any
 * number of entries through `product_categories`, so renaming one is a single
 * row and shows on every product at once, and deleting one takes it off every
 * product by the cascade.
 *
 * Changing the list does not touch `updated_at` of the products concerned: it
 * is housekeeping on the list, not a correction of the product, and the
 * catalogue sorted by "last changed" should not be reshuffled by it.
 */

/** German collation, so "Öl" sorts next to "Obst" and not behind "Zucker". */
function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, 'de');
}

/**
 * Products of the catalogue carrying a category; the trash is not counted.
 *
 * Spelt out with qualified names on purpose: Drizzle leaves column names
 * unqualified in a query without a join, and an unqualified `id` inside this
 * subquery would be the product's, not the category's.
 */
const productCountExpression = sql<number>`(
  select count(*) from "product_categories"
  inner join "products" on "products"."id" = "product_categories"."product_id"
  where "product_categories"."category_id" = "categories"."id"
    and "products"."deleted_at" is null
)`;

function toCategory(row: CategoryRow, productCount: number): Category {
  return {
    id: row.id,
    name: row.name,
    frequent: row.frequent,
    productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The whole list, alphabetically.
 *
 * Without a limit: it is a list somebody keeps by hand and every product form
 * shows all of it. Sorted here rather than in SQL because SQLite compares
 * bytes, which would put "Tiefkühl" before "obst" and "Äpfel" after "Zucker".
 */
export function listCategories(db: DbHandle): Category[] {
  return db
    .select({ category: categories, productCount: productCountExpression })
    .from(categories)
    .all()
    .map((row) => toCategory(row.category, row.productCount))
    .sort(byName);
}

function findCategory(db: DbHandle, id: string): Category {
  const row = db
    .select({ category: categories, productCount: productCountExpression })
    .from(categories)
    .where(eq(categories.id, id))
    .get();
  if (row === undefined) throw new NotFoundError('category not found');
  return toCategory(row.category, row.productCount);
}

/**
 * A category of that name regardless of case, if there is one.
 *
 * The unique index only knows the exact spelling; "getränke" next to
 * "Getränke" is what it cannot catch, and what this is for.
 */
export function findCategoryByName(db: DbHandle, name: string): CategoryRow | undefined {
  return db
    .select()
    .from(categories)
    .where(
      sql`${sql.raw(LOWER_FUNCTION)}(${categories.name}) = ${sql.raw(LOWER_FUNCTION)}(${name.trim()})`,
    )
    .get();
}

function nameConflict(existing: CategoryRow): ConflictError {
  return new ConflictError('a category with this name already exists', {
    field: 'name',
    categoryId: existing.id,
  });
}

export function createCategory(
  db: DbHandle,
  input: CreateCategoryInput,
  now: Date = new Date(),
): Category {
  const existing = findCategoryByName(db, input.name);
  if (existing !== undefined) throw nameConflict(existing);

  const row: CategoryRow = {
    id: randomUUID(),
    name: input.name,
    frequent: input.frequent,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(categories).values(row).run();

  return toCategory(row, 0);
}

/** Renames a category, marks it as frequent or takes the mark off again. */
export function updateCategory(
  db: DbHandle,
  id: string,
  input: UpdateCategoryInput,
  now: Date = new Date(),
): Category {
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (existing === undefined) throw new NotFoundError('category not found');

  const changes: Partial<CategoryRow> = { updatedAt: now };

  if (input.name !== undefined) {
    // A change of case alone is a rename of the category itself, not a clash.
    const clash = db
      .select()
      .from(categories)
      .where(
        and(
          ne(categories.id, id),
          sql`${sql.raw(LOWER_FUNCTION)}(${categories.name}) = ${sql.raw(LOWER_FUNCTION)}(${input.name})`,
        ),
      )
      .get();
    if (clash !== undefined) throw nameConflict(clash);
    changes.name = input.name;
  }
  if (input.frequent !== undefined) changes.frequent = input.frequent;

  db.update(categories).set(changes).where(eq(categories.id, id)).run();
  return findCategory(db, id);
}

export interface DeletedCategory {
  category: Category;
  /** Products of the catalogue that carried it, for the log. */
  removedFrom: number;
}

/** Deletes a category; the cascade takes it off every product carrying it. */
export function deleteCategory(db: DbHandle, id: string): DeletedCategory {
  const category = findCategory(db, id);
  db.delete(categories).where(eq(categories.id, id)).run();
  return { category, removedFrom: category.productCount };
}

/* -------------------------------------------------------- assignments */

/**
 * Checks that every identifier names an entry of the list.
 *
 * A product form only offers what the list holds, so an unknown identifier is
 * a category deleted while the form was open - or a request nobody's form
 * produced. Either way the answer says which ones, rather than quietly
 * dropping them.
 */
export function assertCategoriesExist(db: DbHandle, ids: readonly string[]): void {
  if (ids.length === 0) return;

  const known = new Set(
    db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, [...ids]))
      .all()
      .map((row) => row.id),
  );
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new ValidationError('unknown category', { field: 'categoryIds', unknown });
  }
}

/** Replaces the categories of a product with exactly these. */
export function setProductCategories(
  db: DbHandle,
  productId: string,
  ids: readonly string[],
): void {
  db.delete(productCategories).where(eq(productCategories.productId, productId)).run();
  if (ids.length === 0) return;

  db.insert(productCategories)
    .values(ids.map((categoryId) => ({ productId, categoryId })))
    .run();
}

/**
 * The categories of several products at once, alphabetically per product.
 *
 * One query for a whole page of the list instead of one per card. Products
 * without any are simply absent from the map.
 */
export function categoriesOfProducts(
  db: DbHandle,
  productIds: readonly string[],
): Map<string, CategoryRef[]> {
  const result = new Map<string, CategoryRef[]>();
  if (productIds.length === 0) return result;

  const rows = db
    .select({
      productId: productCategories.productId,
      id: categories.id,
      name: categories.name,
    })
    .from(productCategories)
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(inArray(productCategories.productId, [...new Set(productIds)]))
    .all();

  for (const row of rows) {
    const entries = result.get(row.productId) ?? [];
    entries.push({ id: row.id, name: row.name });
    result.set(row.productId, entries);
  }
  for (const entries of result.values()) entries.sort(byName);

  return result;
}

/** The categories of one product, alphabetically. */
export function categoriesOfProduct(db: DbHandle, productId: string): CategoryRef[] {
  return categoriesOfProducts(db, [productId]).get(productId) ?? [];
}

/**
 * The condition of the catalogue filter: products carrying this category.
 *
 * A subquery rather than a join, so a product carrying three categories is
 * still one row of the list and one in the count.
 */
export function carriesCategory(categoryId: string) {
  return sql`${products.id} in (
    select ${productCategories.productId} from ${productCategories}
    where ${productCategories.categoryId} = ${categoryId}
  )`;
}

/** The key names are compared by; the same folding `pr_lower()` applies. */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}

export interface ResolvedCategoryNames {
  /** Identifier per `categoryKey()` of every name that exists now. */
  byKey: Map<string, string>;
  /** Names that were missing and have been added, or would be in a dry run. */
  created: string[];
}

/**
 * Looks names up in the list and adds the ones that are missing - the import
 * of an export file, where categories travel by name.
 *
 * A name that is already here keeps its spelling and its mark; this instance
 * knows its own list better than a file does. `frequent` holds the keys the
 * file marks as frequent and only applies to what is created. `dryRun`
 * creates nothing and reports what it would have created.
 */
export function resolveCategoryNames(
  db: DbHandle,
  names: readonly string[],
  options: { now?: Date; frequent?: ReadonlySet<string>; dryRun?: boolean } = {},
): ResolvedCategoryNames {
  const byKey = new Map<string, string>();
  const created: string[] = [];
  const planned = new Set<string>();

  for (const raw of names) {
    const key = categoryKey(raw);
    // Longer than the list allows: shortened rather than lost, the way a
    // person typing it into the form would have had to shorten it.
    const name = raw.trim().slice(0, CATEGORY_NAME_MAX_LENGTH).trim();
    if (name === '' || byKey.has(key) || planned.has(key)) continue;

    const existing = findCategoryByName(db, name);
    if (existing !== undefined) {
      byKey.set(key, existing.id);
      continue;
    }

    created.push(name);
    planned.add(key);
    if (options.dryRun === true) continue;

    const category = createCategory(
      db,
      { name, frequent: options.frequent?.has(key) ?? false },
      options.now,
    );
    byKey.set(key, category.id);
  }

  return { byKey, created };
}
