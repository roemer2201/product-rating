import { z } from 'zod';

/**
 * Validation around the price history of a product.
 *
 * An amount travels as a whole number in the smallest unit of the currency —
 * cents, not euros. Money is never a floating point number: 1.10 + 2.20 is not
 * 3.30 in binary, and a price history that adds up wrongly is worse than none.
 * Turning what somebody types into that number is the client's job, and the
 * server checks the result all the same.
 */

export const PRICE_SHOP_MAX_LENGTH = 120;
export const PRICE_NOTE_MAX_LENGTH = 200;

/**
 * Upper bound for a single entry: a hundred thousand in the smallest unit,
 * so a thousand euros for a jar of jam. It is not a business rule, it is the
 * guard against a comma slipping two places on a phone keyboard.
 */
export const PRICE_MAX_CENTS = 10_000_000;

/**
 * How many entries the product detail carries. A household that has recorded
 * more than fifty prices for one article is looking at a chart, not at a list —
 * and the newest are the ones that answer "was it cheaper last time".
 */
export const PRICE_LIST_LIMIT = 50;

/** Upper bound on the shop suggestions of `GET /api/v1/prices/shops`. */
export const PRICE_SHOP_SUGGESTION_LIMIT = 200;

const shopSchema = z.string().trim().max(PRICE_SHOP_MAX_LENGTH);
const noteSchema = z.string().trim().max(PRICE_NOTE_MAX_LENGTH);

/** Empty text fields arrive as `""` from a form; they mean "not set". */
const optionalText = <T extends z.ZodType<string, string>>(schema: T) =>
  schema.nullish().transform((value) => (value === undefined || value === '' ? null : value));

/**
 * Body of `POST /api/v1/products/:id/prices`.
 *
 * The day of the purchase is optional and defaults to today: most entries are
 * made at the till or shortly after. It may lie in the past — a receipt found
 * in a pocket is exactly the case this is for — but not in the future.
 */
export const createPriceSchema = z.object({
  cents: z.int().min(0).max(PRICE_MAX_CENTS),
  shop: optionalText(shopSchema),
  note: optionalText(noteSchema),
  /** ISO date (`YYYY-MM-DD`) or a full timestamp; the server reads both. */
  purchasedAt: z.string().trim().min(1).max(40).optional(),
});

export type CreatePriceInput = z.infer<typeof createPriceSchema>;
