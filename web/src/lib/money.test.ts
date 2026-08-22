import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmount, todayAsInputValue } from '@/lib/money';

/**
 * Reading and writing money.
 *
 * The whole point of the module is that nothing calculates with a floating
 * point number, so the cases that matter are the ones where a decimal would
 * drift: a comma from a German keyboard, a value pasted out of a receipt, and
 * an amount that is not an amount at all.
 */

describe('parseAmount', () => {
  it('reads both separators and the sign that comes with a paste', () => {
    expect(parseAmount('1,99')).toBe(199);
    expect(parseAmount('1.99')).toBe(199);
    expect(parseAmount(' 2,50 € ')).toBe(250);
    expect(parseAmount('3')).toBe(300);
    expect(parseAmount('0,05')).toBe(5);
  });

  it('refuses what is not an amount', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('teuer')).toBeNull();
    expect(parseAmount('-1,00')).toBeNull();
    // A third decimal is a typo, not a tenth of a cent.
    expect(parseAmount('1,999')).toBeNull();
    expect(parseAmount('1,,99')).toBeNull();
  });

  it('stops at the upper bound instead of recording a slipped comma', () => {
    expect(parseAmount('100000')).toBe(10_000_000);
    expect(parseAmount('100001')).toBeNull();
  });
});

describe('formatAmount', () => {
  it('writes the amount the way the device would', () => {
    const formatted = formatAmount(199, 'EUR');
    // The separator and the position of the sign belong to the locale; what
    // has to hold everywhere is the value.
    expect(formatted).toMatch(/1[.,]99/);
  });

  it('falls back to a bare number for a currency nobody knows', () => {
    expect(formatAmount(199, 'XYZ')).toContain('1.99');
  });
});

describe('todayAsInputValue', () => {
  it('writes the local day, not the UTC one', () => {
    expect(todayAsInputValue(new Date(2026, 7, 22, 1, 30))).toBe('2026-08-22');
  });
});
