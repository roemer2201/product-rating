import { randomUUID } from 'node:crypto';
import { desc, eq, isNotNull } from 'drizzle-orm';
import {
  PRICE_LIST_LIMIT,
  PRICE_SHOP_SUGGESTION_LIMIT,
  type CreatePriceInput,
  type Price,
} from '@product-rating/shared';
import type { AppConfig } from '../config/index.js';
import type { DbHandle } from '../db/index.js';
import { prices, users, type PriceRow } from '../db/index.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { findProductById } from './products.js';

/**
 * What a product cost, where it was bought and when.
 *
 * The point of the history is the comparison, not the bookkeeping: "was it
 * cheaper at the other shop", "is this the usual price or an offer". That is
 * why an entry carries a shop and the day of the purchase rather than a
 * receipt, and why nothing here is aggregated into a single "the price" — a
 * price is a fact about one purchase.
 *
 * Amounts are whole numbers in the smallest unit of the currency. Money is
 * never a floating point number; the client formats, the database counts.
 */

/** An entry belongs to whoever recorded it — and to the administrators. */
function requireOwnership(row: PriceRow, user: { id: string; role: string }): void {
  if (row.userId !== user.id && user.role !== 'admin') {
    throw new ForbiddenError('this price was recorded by another account');
  }
}

export function toPublicPrice(row: PriceRow, username: string | null): Price {
  return {
    id: row.id,
    productId: row.productId,
    userId: row.userId,
    username,
    cents: row.cents,
    currency: row.currency,
    shop: row.shop,
    note: row.note,
    purchasedAt: row.purchasedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The recorded prices of a product, most recent purchase first.
 *
 * Capped, because the detail page shows a list and not a chart: a household
 * that has recorded fifty prices for one article is answering a different
 * question than "was it cheaper last time".
 */
export function listProductPrices(db: DbHandle, productId: string): Price[] {
  return db
    .select({ price: prices, username: users.username })
    .from(prices)
    .leftJoin(users, eq(users.id, prices.userId))
    .where(eq(prices.productId, productId))
    .orderBy(desc(prices.purchasedAt), desc(prices.createdAt))
    .limit(PRICE_LIST_LIMIT)
    .all()
    .map((row) => toPublicPrice(row.price, row.username));
}

/**
 * The shops that have been entered before, alphabetically.
 *
 * The same reasoning as the category suggestions of the product form: free text
 * keeps a household from fighting a fixed list, and a list of what is already
 * there keeps it from ending in five spellings of the same supermarket.
 * Sorting happens here because SQLite would order case sensitively and put
 * "Aldi" behind "denn's".
 */
export function listShops(db: DbHandle): string[] {
  return db
    .selectDistinct({ shop: prices.shop })
    .from(prices)
    .where(isNotNull(prices.shop))
    .all()
    .map((row) => row.shop)
    .filter((shop): shop is string => shop !== null && shop !== '')
    .sort((left, right) => left.localeCompare(right, 'de'))
    .slice(0, PRICE_SHOP_SUGGESTION_LIMIT);
}

/** Reads the day of a purchase out of what the client sent. */
function purchaseMoment(value: string | undefined, now: Date): Date {
  if (value === undefined) return now;

  // A bare date is read as noon UTC rather than midnight: whichever side of
  // the date line the household is on, the day stays the day it typed.
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value;
  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('the date of the purchase is not readable', {
      field: 'purchasedAt',
    });
  }

  // Tomorrow's price is not a fact yet; a day of slack absorbs a clock that is
  // set a little fast and time zones ahead of the server.
  if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    throw new ValidationError('the date of the purchase lies in the future', {
      field: 'purchasedAt',
    });
  }

  return date;
}

/**
 * Records what a product cost.
 *
 * Every account may add an entry to every product — the catalogue is shared and
 * so is the question of what things cost. Removing one stays with whoever
 * recorded it, the same rule as for photos.
 */
export function createPrice(
  db: DbHandle,
  config: AppConfig,
  userId: string,
  productId: string,
  input: CreatePriceInput,
  now: Date = new Date(),
): Price {
  if (findProductById(db, productId) === undefined) throw new NotFoundError('product not found');

  const row: PriceRow = {
    id: randomUUID(),
    productId,
    userId,
    cents: input.cents,
    currency: config.app.currency,
    shop: input.shop,
    note: input.note,
    purchasedAt: purchaseMoment(input.purchasedAt, now),
    createdAt: now,
  };

  db.insert(prices).values(row).run();

  const username =
    db.select({ username: users.username }).from(users).where(eq(users.id, userId)).get()
      ?.username ?? null;

  return toPublicPrice(row, username);
}

export function findPriceById(db: DbHandle, id: string): PriceRow | undefined {
  return db.select().from(prices).where(eq(prices.id, id)).get();
}

/** Removes one entry. Owner or administrator. */
export function deletePrice(
  db: DbHandle,
  user: { id: string; role: string },
  priceId: string,
): PriceRow {
  const row = findPriceById(db, priceId);
  if (row === undefined) throw new NotFoundError('price not found');
  requireOwnership(row, user);

  db.delete(prices).where(eq(prices.id, priceId)).run();
  return row;
}
