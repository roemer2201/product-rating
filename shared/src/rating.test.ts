import { describe, expect, it } from 'vitest';
import { isValidStars, RATING_MAX_STARS, RATING_MIN_STARS } from './index.js';

describe('rating bounds', () => {
  it('spans zero to five stars', () => {
    expect(RATING_MIN_STARS).toBe(0);
    expect(RATING_MAX_STARS).toBe(5);
  });

  it('accepts every whole star count in range, including zero', () => {
    for (let stars = RATING_MIN_STARS; stars <= RATING_MAX_STARS; stars += 1) {
      expect(isValidStars(stars)).toBe(true);
    }
  });

  it('rejects out-of-range, fractional and non-numeric values', () => {
    expect(isValidStars(-1)).toBe(false);
    expect(isValidStars(6)).toBe(false);
    expect(isValidStars(3.5)).toBe(false);
    expect(isValidStars(Number.NaN)).toBe(false);
    expect(isValidStars('4')).toBe(false);
    expect(isValidStars(null)).toBe(false);
    expect(isValidStars(undefined)).toBe(false);
  });
});
