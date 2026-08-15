import { describe, expect, it } from 'vitest';
import {
  describeUserAgent,
  formatAverage,
  formatDate,
  formatRelative,
  formatStars,
} from './format.js';
import { strings } from './strings.js';

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

describe('formatAverage', () => {
  it('keeps one decimal and marks the absence of one', () => {
    expect(formatAverage(4)).toMatch(/^4[.,]0$/);
    expect(formatAverage(3.25)).toMatch(/^3[.,]3$/);
    expect(formatAverage(null)).toBe('–');
  });
});

describe('formatDate', () => {
  it('survives a value that is not a date', () => {
    expect(formatDate('not a date')).toBe('–');
    expect(formatDate('2026-08-15T10:00:00.000Z')).not.toBe('–');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('counts in the largest unit that still fits', () => {
    // The wording comes from `Intl`, so the assertions are on the unit rather
    // than on a German sentence this module does not own.
    expect(formatRelative('2026-08-15T11:58:00.000Z', now)).toMatch(/2/);
    expect(formatRelative('2026-08-15T09:00:00.000Z', now)).toMatch(/3/);
    expect(formatRelative('2026-08-13T12:00:00.000Z', now)).toMatch(/2/);
  });

  it('reports a broken value instead of throwing', () => {
    expect(formatRelative('', now)).toBe('–');
  });
});

describe('describeUserAgent', () => {
  it('condenses the header to device and browser', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone · Safari');

    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('Windows · Chrome');

    expect(
      describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0'),
    ).toBe('Linux · Firefox');
  });

  it('tells the browsers apart that all claim to be Safari', () => {
    // Edge says Chrome and Safari, Chrome says Safari, and Chrome on iOS says
    // neither of the two under its own name.
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      ),
    ).toBe('Windows · Edge');

    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone · Chrome');

    // A Chrome that does not spell itself "Chrome" must not end up as Safari
    // just because every Chrome carries a `Safari/` token.
    expect(
      describeUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('Linux · Chrome');
  });

  it('keeps whichever half it recognises', () => {
    expect(describeUserAgent('Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X)')).toBe('iPad');
    expect(describeUserAgent('curl/8.5.0')).toBe(strings.settings.unknownDevice);
    expect(describeUserAgent(null)).toBe(strings.settings.unknownDevice);
    expect(describeUserAgent('   ')).toBe(strings.settings.unknownDevice);
  });
});
