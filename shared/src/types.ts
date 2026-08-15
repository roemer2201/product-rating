/**
 * Domain types shared between the API server and the web client.
 *
 * These describe the shapes that cross the HTTP boundary, not the database
 * rows. Runtime validation schemas (zod) are added in milestone M1/M4 and will
 * live next to these types.
 */

/** Roles a user account can hold. */
export type UserRole = 'admin' | 'user';

/** Lowest and highest number of stars a rating may carry. */
export const RATING_MIN_STARS = 0;
export const RATING_MAX_STARS = 5;

/** A user account as exposed by the API. Never carries the password hash. */
export interface User {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  createdAt: string;
  disabledAt: string | null;
}

/** One of the caller's own sessions, as listed in the settings page. */
export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** True for the session the request itself was made with. */
  current: boolean;
}

/** An invite code as shown to an administrator. */
export interface Invite {
  code: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
  usedAt: string | null;
  status: 'open' | 'used' | 'expired';
}

/**
 * A product in the shared catalogue. An EAN exists exactly once across all
 * users; ratings and photos are per user.
 */
export interface Product {
  id: string;
  ean: string;
  name: string;
  brand: string | null;
  category: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** One user's rating of one product. */
export interface Rating {
  productId: string;
  userId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A photo belonging to a product, owned by the user who uploaded it. The path
 * on disk is deliberately absent: images are only reachable through
 * `GET /api/v1/media/:id`, never as a direct link into the web root.
 */
export interface Photo {
  id: string;
  productId: string;
  userId: string;
  mime: string;
  width: number;
  height: number;
  isPrimary: boolean;
  createdAt: string;
}

/** Aggregated rating information returned alongside a product. */
export interface RatingSummary {
  average: number | null;
  count: number;
}

/** A product enriched with the caller's own rating and the overall summary. */
export interface ProductWithRatings extends Product {
  ownRating: Rating | null;
  ratings: RatingSummary;
  primaryPhotoId: string | null;
}

/**
 * A single product as the detail page needs it: everything the list carries,
 * plus its photos. The list deliberately stays with `primaryPhotoId` alone —
 * one card shows one image, and reading every photo row of every product would
 * be paid for on each page.
 */
export interface ProductDetail extends ProductWithRatings {
  /** Primary photo first, oldest first after that. */
  photos: Photo[];
}

/**
 * One page of the product list. Paging works on a cursor rather than an offset
 * so that a product added while scrolling cannot shift the following pages.
 */
export interface ProductListPage {
  products: ProductWithRatings[];
  /** Pass back as `cursor` to get the next page; `null` on the last one. */
  nextCursor: string | null;
  /** Number of products matching the filters, across all pages. */
  total: number;
}

/**
 * A product the caller has rated. Same shape as everywhere else in the product
 * list, only with the guarantee that `ownRating` is present — the list of own
 * ratings cannot contain anything else.
 */
export interface RatedProduct extends ProductWithRatings {
  ownRating: Rating;
}

/** One page of the caller's own ratings, paged like the product list. */
export interface RatingListPage {
  ratings: RatedProduct[];
  /** Pass back as `cursor` to get the next page; `null` on the last one. */
  nextCursor: string | null;
  /** Number of own ratings across all pages. */
  total: number;
}
