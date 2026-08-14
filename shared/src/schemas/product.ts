import { z } from 'zod';
import { normaliseEan } from '../ean.js';

/**
 * Validation schemas for the shared product catalogue.
 *
 * The server validates every request with these; the web client reuses them for
 * form validation and for building query strings. Query parameters arrive as
 * strings, so the list schema coerces numbers and flags itself instead of
 * leaving that to the route.
 */

export const PRODUCT_NAME_MAX_LENGTH = 200;
export const PRODUCT_BRAND_MAX_LENGTH = 120;
export const PRODUCT_CATEGORY_MAX_LENGTH = 60;
export const PRODUCT_NOTES_MAX_LENGTH = 2000;
export const PRODUCT_SEARCH_MAX_LENGTH = 100;

/** Page sizes for the product list; the client may ask for less, not for more. */
export const PRODUCT_LIST_DEFAULT_LIMIT = 25;
export const PRODUCT_LIST_MAX_LIMIT = 100;

/** Fields the product list can be sorted by. */
export const PRODUCT_SORT_FIELDS = ['name', 'created', 'updated', 'rating'] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

export const PRODUCT_SORT_ORDERS = ['asc', 'desc'] as const;
export type ProductSortOrder = (typeof PRODUCT_SORT_ORDERS)[number];

/**
 * Any of the three accepted symbologies, normalised to thirteen digits. The
 * check digit is verified here, so a mistyped EAN never reaches the database.
 */
export const eanSchema = z
  .string()
  .trim()
  .min(8)
  .max(20)
  .refine((value) => normaliseEan(value) !== null, {
    message: 'not a valid EAN-13, EAN-8 or UPC-A (check digit does not match)',
  })
  // The refinement above guarantees a result; `?? value` only pleases the types.
  .transform((value) => normaliseEan(value) ?? value);

const nameSchema = z.string().trim().min(1).max(PRODUCT_NAME_MAX_LENGTH);
const brandSchema = z.string().trim().max(PRODUCT_BRAND_MAX_LENGTH);
const categorySchema = z.string().trim().max(PRODUCT_CATEGORY_MAX_LENGTH);
const notesSchema = z.string().trim().max(PRODUCT_NOTES_MAX_LENGTH);

/** Empty text fields arrive as `""` from a form; they mean "not set". */
const optionalText = <T extends z.ZodType<string, string>>(schema: T) =>
  schema.nullish().transform((value) => (value === undefined || value === '' ? null : value));

export const createProductSchema = z.object({
  ean: eanSchema,
  name: nameSchema,
  brand: optionalText(brandSchema),
  category: optionalText(categorySchema),
  notes: optionalText(notesSchema),
});

/**
 * A change to the shared catalogue. Every field is optional, but at least one
 * has to be present — an empty body would only bump `updated_at`.
 */
export const updateProductSchema = z
  .object({
    name: nameSchema.optional(),
    brand: optionalText(brandSchema).optional(),
    category: optionalText(categorySchema).optional(),
    notes: optionalText(notesSchema).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'no changes given',
  });

/** `true`/`1` in a query string, or a real boolean from a JSON caller. */
const flagSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const productListQuerySchema = z.object({
  /** Free text over name, brand and — for digits — the EAN prefix. */
  q: z.string().trim().max(PRODUCT_SEARCH_MAX_LENGTH).optional(),
  category: z.string().trim().max(PRODUCT_CATEGORY_MAX_LENGTH).optional(),
  /** Keeps products whose average rating reaches this many stars. */
  minStars: z.coerce.number().int().min(0).max(5).optional(),
  /** Restricts the list to products the caller has rated themselves. */
  ratedByMe: flagSchema.optional(),
  sort: z.enum(PRODUCT_SORT_FIELDS).default('updated'),
  /** Defaults to ascending for `name` and descending for everything else. */
  order: z.enum(PRODUCT_SORT_ORDERS).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PRODUCT_LIST_MAX_LIMIT)
    .default(PRODUCT_LIST_DEFAULT_LIMIT),
  /** Opaque `nextCursor` of the previous page. */
  cursor: z.string().max(300).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
