import { RATING_MAX_STARS, RATING_MIN_STARS, type RatingSummary } from './types.js';

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

/**
 * Two decimals are as much as five stars can meaningfully carry. Rounding
 * happens on the way out only; anything comparing or sorting averages works
 * with the full value.
 */
export function roundAverageStars(average: number | null): number | null {
  return average === null ? null : Math.round(average * 100) / 100;
}

/** The aggregate as the API reports it: rounded average and number of votes. */
export function toRatingSummary(average: number | null, count: number): RatingSummary {
  return { average: roundAverageStars(average), count };
}
