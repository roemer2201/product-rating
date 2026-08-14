import { RATING_MAX_STARS, RATING_MIN_STARS } from './types.js';

/**
 * Whether a value is a usable star rating: a whole number between 0 and 5.
 * Zero is a deliberate rating ("bad"), not a missing value.
 */
export function isValidStars(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= RATING_MIN_STARS &&
    value <= RATING_MAX_STARS
  );
}
