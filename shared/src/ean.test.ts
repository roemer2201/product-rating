import { describe, expect, it } from 'vitest';
import { eanCheckDigit, eanFormat, isValidEan, normaliseEan } from './ean.js';
import { createProductSchema, eanSchema } from './schemas/product.js';

/** EAN validation and the normalisation to thirteen digits. */

describe('eanCheckDigit', () => {
  it('computes the digit printed on the label', () => {
    expect(eanCheckDigit('400638133393')).toBe(1);
    expect(eanCheckDigit('590123412345')).toBe(7);
    // EAN-8 and UPC-A use the same alternating weights.
    expect(eanCheckDigit('9638507')).toBe(4);
    expect(eanCheckDigit('03600029145')).toBe(2);
  });
});

describe('eanFormat', () => {
  it('recognises the three accepted symbologies', () => {
    expect(eanFormat('4006381333931')).toBe('ean-13');
    expect(eanFormat('96385074')).toBe('ean-8');
    expect(eanFormat('036000291452')).toBe('upc-a');
  });

  it('rejects a wrong check digit', () => {
    expect(eanFormat('4006381333932')).toBeNull();
    expect(eanFormat('96385075')).toBeNull();
  });

  it('rejects anything that is not a code of an accepted length', () => {
    expect(eanFormat('')).toBeNull();
    expect(eanFormat('123')).toBeNull();
    // Eleven digits: no symbology, regardless of the check digit.
    expect(eanFormat('40063813339')).toBeNull();
    expect(eanFormat('400638133393X')).toBeNull();
    expect(eanFormat('4006381333931 1')).toBeNull();
  });
});

describe('normaliseEan', () => {
  it('keeps a valid EAN-13 as it is', () => {
    expect(normaliseEan('4006381333931')).toBe('4006381333931');
  });

  it('widens UPC-A and EAN-8 to thirteen digits', () => {
    expect(normaliseEan('036000291452')).toBe('0036000291452');
    expect(normaliseEan('96385074')).toBe('0000096385074');
  });

  it('accepts codes typed with spaces or dashes', () => {
    expect(normaliseEan(' 4006381-333931 ')).toBe('4006381333931');
    expect(normaliseEan('9638 5074')).toBe('0000096385074');
  });

  it('leaves the check digit intact while padding, so the result validates', () => {
    const widened = normaliseEan('96385074');
    expect(widened).not.toBeNull();
    expect(isValidEan(widened as string)).toBe(true);
  });

  it('returns null for an invalid code', () => {
    expect(normaliseEan('4006381333932')).toBeNull();
    expect(normaliseEan('abcdefgh')).toBeNull();
  });
});

describe('eanSchema', () => {
  it('normalises on parse', () => {
    expect(eanSchema.parse(' 036000291452 ')).toBe('0036000291452');
  });

  it('refuses a code with a broken check digit', () => {
    const result = eanSchema.safeParse('4006381333932');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('check digit');
  });
});

describe('createProductSchema', () => {
  it('trims text and turns empty fields into null', () => {
    const parsed = createProductSchema.parse({
      ean: '96385074',
      name: '  Haferflocken  ',
      brand: '',
      category: 'Frühstück',
    });

    expect(parsed).toEqual({
      ean: '0000096385074',
      name: 'Haferflocken',
      brand: null,
      category: 'Frühstück',
      notes: null,
    });
  });

  it('requires a name', () => {
    expect(createProductSchema.safeParse({ ean: '96385074', name: '   ' }).success).toBe(false);
  });
});
