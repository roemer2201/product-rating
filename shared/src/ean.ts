/**
 * EAN handling: check digit validation and normalisation to the 13 digit form
 * the catalogue stores.
 *
 * Three symbologies show up on European household products: EAN-13, the short
 * EAN-8 used on small packages, and UPC-A with its twelve digits on imports.
 * All three are GTINs and only differ in how many leading zeros are printed, so
 * a shorter code padded to thirteen digits is the very same article number —
 * and because the check digit is computed from the right, padding does not
 * change it. Storing one length keeps `products.ean UNIQUE` meaningful: the
 * same product cannot enter the catalogue twice just because one scan read the
 * UPC-A form.
 */

/** Length every EAN is normalised to before it is stored or looked up. */
export const EAN_LENGTH = 13;

/** The symbologies accepted on input, keyed by their digit count. */
export const EAN_INPUT_LENGTHS = [8, 12, 13] as const;

export type EanFormat = 'ean-8' | 'upc-a' | 'ean-13';

const FORMAT_BY_LENGTH: Record<number, EanFormat> = {
  8: 'ean-8',
  12: 'upc-a',
  13: 'ean-13',
};

/** Removes the spaces and dashes people type when reading a code off a label. */
export function stripEanSeparators(value: string): string {
  return value.replace(/[\s-]+/g, '');
}

/**
 * Computes the GTIN check digit for everything left of it.
 *
 * Weights alternate 3 and 1 starting at the digit directly left of the check
 * digit, which is why the loop counts from the right and why leading zeros
 * never influence the result.
 */
export function eanCheckDigit(body: string): number {
  let sum = 0;
  let weight = 3;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    // `charCodeAt` avoids the possibly-undefined element access of `body[i]`.
    sum += (body.charCodeAt(index) - 0x30) * weight;
    weight = weight === 3 ? 1 : 3;
  }

  return (10 - (sum % 10)) % 10;
}

/** The symbology of a code, or `null` if it is neither valid nor recognised. */
export function eanFormat(value: string): EanFormat | null {
  const digits = stripEanSeparators(value);

  if (!/^\d+$/.test(digits)) return null;

  const format = FORMAT_BY_LENGTH[digits.length];
  if (format === undefined) return null;

  const body = digits.slice(0, -1);
  const check = digits.charCodeAt(digits.length - 1) - 0x30;

  return eanCheckDigit(body) === check ? format : null;
}

/** Whether a code is a valid EAN-13, EAN-8 or UPC-A, check digit included. */
export function isValidEan(value: string): boolean {
  return eanFormat(value) !== null;
}

/**
 * Normalises a scanned or typed code to thirteen digits, or returns `null` if
 * it is not a valid EAN. Every write and every lookup goes through here, so a
 * product is found no matter which of the three forms was scanned.
 */
export function normaliseEan(value: string): string | null {
  if (eanFormat(value) === null) return null;
  return stripEanSeparators(value).padStart(EAN_LENGTH, '0');
}
