import { z } from 'zod';
import { normaliseEan } from '../ean.js';
import { PRODUCT_KINDS, RATING_MAX_STARS, RATING_MIN_STARS } from '../types.js';
import { categoryIdsSchema } from './category.js';
import { SORT_ORDERS, type SortOrder } from './sort.js';

/**
 * Validation schemas for the shared product catalogue.
 *
 * The server validates every request with these; the web client reuses them for
 * form validation and for building query strings. Query parameters arrive as
 * strings, so the list schema coerces numbers and flags itself instead of
 * leaving that to the route.
 */

export const PRODUCT_NAME_MAX_LENGTH = 200;
export const PRODUCT_VARIANT_MAX_LENGTH = 200;
export const PRODUCT_BRAND_MAX_LENGTH = 120;
export const PRODUCT_NOTES_MAX_LENGTH = 2000;
export const PRODUCT_SEARCH_MAX_LENGTH = 100;

/** Page sizes for the product list; the client may ask for less, not for more. */
export const PRODUCT_LIST_DEFAULT_LIMIT = 25;
export const PRODUCT_LIST_MAX_LIMIT = 100;

/**
 * Upper bound on the entries `GET /api/v1/trash` returns. The trash is emptied
 * on a schedule and holds the mistakes of a household; the limit only keeps a
 * script that deleted a thousand products from turning the answer into a wait.
 */
export const TRASH_LIST_LIMIT = 200;

/** Fields the product list can be sorted by. */
export const PRODUCT_SORT_FIELDS = ['name', 'created', 'updated', 'rating'] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

export const PRODUCT_SORT_ORDERS = SORT_ORDERS;
export type ProductSortOrder = SortOrder;

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
const variantSchema = z.string().trim().max(PRODUCT_VARIANT_MAX_LENGTH);
const brandSchema = z.string().trim().max(PRODUCT_BRAND_MAX_LENGTH);
const notesSchema = z.string().trim().max(PRODUCT_NOTES_MAX_LENGTH);

/** Empty text fields arrive as `""` from a form; they mean "not set". */
const optionalText = <T extends z.ZodType<string, string>>(schema: T) =>
  schema.nullish().transform((value) => (value === undefined || value === '' ? null : value));

/**
 * An EAN that may be left out: absent, `null` and `""` all mean "this entry has
 * no barcode", anything else has to be a valid one.
 */
const optionalEanSchema = z
  .union([z.string().trim().length(0), eanSchema])
  .nullish()
  .transform((value) => (value === undefined || value === '' ? null : value));

const DISH_WITHOUT_EAN = { message: 'a dish has no EAN', path: ['ean'] };

export const createProductSchema = z
  .object({
    /** Absent means `product`, which is what every scan creates. */
    kind: z.enum(PRODUCT_KINDS).default('product'),
    /** Required for nothing: goods from the baker and every dish go without. */
    ean: optionalEanSchema,
    name: nameSchema,
    variant: optionalText(variantSchema),
    /** For a dish, where it comes from: "nach Oma", a cookbook, a machine. */
    brand: optionalText(brandSchema),
    /** Identifiers from `GET /api/v1/categories`; none at all is fine. */
    categoryIds: categoryIdsSchema.default([]),
    notes: optionalText(notesSchema),
  })
  .refine((value) => value.kind === 'product' || value.ean === null, DISH_WITHOUT_EAN);

/**
 * A change to the shared catalogue. Every field is optional, but at least one
 * has to be present — an empty body would only bump `updated_at`.
 */
export const updateProductSchema = z
  .object({
    /**
     * Gives an entry bought without a barcode the one it turned out to have.
     * Only once: the server refuses to change or remove an EAN that is there,
     * because the scanner finds the product by it.
     */
    ean: eanSchema.optional(),
    name: nameSchema.optional(),
    variant: optionalText(variantSchema).optional(),
    brand: optionalText(brandSchema).optional(),
    /** Replaces the whole set; `[]` takes every category off the product. */
    categoryIds: categoryIdsSchema.optional(),
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
  /** Free text over name, variant, brand and — for digits — the EAN. */
  q: z.string().trim().max(PRODUCT_SEARCH_MAX_LENGTH).optional(),
  /** Keeps products that carry this category, whatever else they carry. */
  categoryId: z.string().trim().max(64).optional(),
  /** Keeps one kind of entry: bought products or dishes. */
  kind: z.enum(PRODUCT_KINDS).optional(),
  /** Keeps products whose average rating reaches this many stars. */
  minStars: z.coerce.number().int().min(RATING_MIN_STARS).max(RATING_MAX_STARS).optional(),
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
