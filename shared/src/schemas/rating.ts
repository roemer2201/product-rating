import { z } from 'zod';
import { RATING_MAX_STARS, RATING_MIN_STARS } from '../types.js';
import { SORT_ORDERS, type SortOrder } from './sort.js';

/**
 * Validation schemas for ratings.
 *
 * A rating always belongs to the caller: the routes address it as "my rating
 * of this product", so neither the product nor the user is part of the body.
 * Zero stars is a deliberate verdict and therefore a valid value — "not rated"
 * is expressed by the absence of the rating, not by a zero.
 */

export const RATING_COMMENT_MAX_LENGTH = 1000;

/** Page sizes for the list of own ratings; the client may ask for less. */
export const RATING_LIST_DEFAULT_LIMIT = 25;
export const RATING_LIST_MAX_LIMIT = 100;

/**
 * Fields the own ratings can be sorted by: when they were last rated, how many
 * stars they got, and the product name.
 */
export const RATING_SORT_FIELDS = ['rated', 'stars', 'name'] as const;
export type RatingSortField = (typeof RATING_SORT_FIELDS)[number];

export const RATING_SORT_ORDERS = SORT_ORDERS;
export type RatingSortOrder = SortOrder;

/** Whole stars only; halves would not survive the star widget anyway. */
export const starsSchema = z.number().int().min(RATING_MIN_STARS).max(RATING_MAX_STARS);

const commentSchema = z.string().trim().max(RATING_COMMENT_MAX_LENGTH);

/**
 * Body of `PUT /api/v1/products/:id/rating`. The route replaces the rating as
 * a whole, so a missing comment clears a previously stored one — that is what
 * makes the request repeatable with the same result.
 */
export const upsertRatingSchema = z.object({
  stars: starsSchema,
  comment: commentSchema
    .nullish()
    .transform((value) => (value === undefined || value === '' ? null : value)),
});

export const myRatingsQuerySchema = z.object({
  sort: z.enum(RATING_SORT_FIELDS).default('rated'),
  /** Defaults to ascending for `name` and descending for everything else. */
  order: z.enum(RATING_SORT_ORDERS).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RATING_LIST_MAX_LIMIT)
    .default(RATING_LIST_DEFAULT_LIMIT),
  /** Opaque `nextCursor` of the previous page. */
  cursor: z.string().max(300).optional(),
});

export type UpsertRatingInput = z.infer<typeof upsertRatingSchema>;
export type MyRatingsQuery = z.infer<typeof myRatingsQuerySchema>;
