import { RATING_MAX_STARS, isValidStars } from '@product-rating/shared';

/**
 * Renders a star rating as text, e.g. 3 -> "★★★☆☆". Used for compact list rows
 * and as the accessible label of the interactive star widget (M8).
 */
export function formatStars(stars: number): string {
  if (!isValidStars(stars)) {
    throw new RangeError(`invalid star rating: ${stars}`);
  }

  return '★'.repeat(stars) + '☆'.repeat(RATING_MAX_STARS - stars);
}
