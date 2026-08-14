import { describe, expect, it } from 'vitest';
import { formatStars } from './format.js';

describe('formatStars', () => {
  it('fills the rated stars and pads the rest', () => {
    expect(formatStars(0)).toBe('☆☆☆☆☆');
    expect(formatStars(3)).toBe('★★★☆☆');
    expect(formatStars(5)).toBe('★★★★★');
  });

  it('rejects values outside the rating range', () => {
    expect(() => formatStars(6)).toThrow(RangeError);
    expect(() => formatStars(-1)).toThrow(RangeError);
  });
});
