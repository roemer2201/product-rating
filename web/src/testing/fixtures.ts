import type {
  Photo,
  ProductDetail,
  ProductRating,
  ProductWithRatings,
  Rating,
} from '@product-rating/shared';
import { testUser } from '@/testing/fetchMock';

/**
 * Products, ratings and photos as the API returns them.
 *
 * Built from one base each with an override, so a test says what it is about —
 * "a product nobody has rated" — instead of restating fifteen fields that have
 * nothing to do with the case.
 */

/** A valid EAN-13; the check digit matters, these are not random digits. */
export const TEST_EAN = '4260000000011';

/** A rating of somebody else, as the product page lists it. */
export function makeProductRating(overrides: Partial<ProductRating> = {}): ProductRating {
  return { ...makeRating(), username: 'anna', ...overrides };
}

export function makeRating(overrides: Partial<Rating> = {}): Rating {
  return {
    productId: 'prod-1',
    userId: testUser.id,
    stars: 4,
    comment: null,
    createdAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-10T08:00:00.000Z',
    ...overrides,
  };
}

export function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'photo-1',
    productId: 'prod-1',
    userId: testUser.id,
    mime: 'image/webp',
    width: 1600,
    height: 1200,
    position: 0,
    isPrimary: true,
    createdAt: '2026-08-10T08:00:00.000Z',
    ...overrides,
  };
}

export function makeProduct(overrides: Partial<ProductWithRatings> = {}): ProductWithRatings {
  return {
    id: 'prod-1',
    ean: TEST_EAN,
    name: 'Apfelsaft',
    brand: 'Bio Hof',
    category: 'Getränke',
    notes: null,
    createdBy: testUser.id,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-10T08:00:00.000Z',
    ownRating: null,
    ratings: { average: null, count: 0 },
    primaryPhotoId: null,
    ...overrides,
  };
}

export function makeProductDetail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return { ...makeProduct(), photos: [], allRatings: [], ...overrides };
}

/** One page of a product list, as `GET /api/v1/products` answers it. */
export function makeProductPage(
  products: ProductWithRatings[],
  nextCursor: string | null = null,
): { products: ProductWithRatings[]; nextCursor: string | null; total: number } {
  return { products, nextCursor, total: products.length };
}
