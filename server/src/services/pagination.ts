import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { SORT_ORDERS, type SortOrder } from '@product-rating/shared';
import { ValidationError } from './errors.js';

/**
 * Keyset pagination, shared by every list route.
 *
 * Paging works on the last row of a page rather than on an offset: a product
 * added or rated while someone scrolls cannot shift the following pages. The
 * cursor carries the sorting it was produced with, so a client that changes
 * sort or order mid-scroll gets a clear error instead of silently skipped or
 * repeated rows.
 */

/** The value a page is cut at; text for names, numbers for stars and dates. */
export type CursorKey = string | number;

export interface Cursor {
  key: CursorKey;
  /** Breaks ties between rows sharing a sort key. */
  id: string;
}

const cursorSchema = z.object({
  s: z.string().min(1),
  o: z.enum(SORT_ORDERS),
  k: z.union([z.string(), z.number()]),
  i: z.string().min(1),
});

export function encodeCursor(sort: string, order: SortOrder, cursor: Cursor): string {
  const payload = JSON.stringify({ s: sort, o: order, k: cursor.key, i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(value: string, sort: string, order: SortOrder): Cursor {
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

/**
 * Everything after the cursor.
 *
 * The identifier breaks ties in ascending direction regardless of the sort
 * order, which is how the `ORDER BY` of the callers is built — otherwise rows
 * sharing a name or a rating could appear twice or not at all.
 */
export function keysetCondition(
  expression: SQLiteColumn | SQL,
  order: SortOrder,
  id: SQLiteColumn,
  cursor: Cursor,
): SQL {
  const comparison =
    order === 'asc' ? sql`${expression} > ${cursor.key}` : sql`${expression} < ${cursor.key}`;

  return sql`(${comparison} or (${expression} = ${cursor.key} and ${id} > ${cursor.id}))`;
}

/** Ascending for names, newest and best first for everything else. */
export function defaultOrderFor(sort: string): SortOrder {
  return sort === 'name' ? 'asc' : 'desc';
}
