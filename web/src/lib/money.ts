import { PRICE_MAX_CENTS } from '@product-rating/shared';

/**
 * Money on the way in and on the way out.
 *
 * Amounts cross the API as whole numbers in the smallest unit of the currency,
 * never as decimals: 1.10 + 2.20 is not 3.30 in binary, and a price history
 * that adds up wrongly is worse than none. Everything a person types or reads
 * is converted here, so no screen does arithmetic on a floating point number.
 */

/** Smallest units per unit of currency. Everything this app sees has two. */
const SUBUNITS = 100;

/**
 * Reads what someone typed into a whole number of cents.
 *
 * Both separators are accepted — a German phone keyboard offers the comma, a
 * numeric input field hands over the point — and so are the spaces and the
 * currency sign that come along when a value is pasted out of a receipt.
 * Returns `null` for anything that is not an amount, so the form can say so
 * instead of silently recording a zero.
 */
export function parseAmount(value: string): number | null {
  const cleaned = value.trim().replace(/[\s€]/g, '').replace(',', '.');
  if (cleaned === '') return null;

  // At most two decimals: a third one is a typo, not a tenth of a cent.
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const cents = Math.round(Number(cleaned) * SUBUNITS);
  if (!Number.isSafeInteger(cents) || cents > PRICE_MAX_CENTS) return null;

  return cents;
}

/**
 * The amount as the phone would write it, currency sign included.
 *
 * `Intl` decides how it looks, so the device's own settings win — a German
 * user expects "1,99 €" and gets it because their phone says so, not because
 * the bundle hard codes it.
 */
export function formatAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      cents / SUBUNITS,
    );
  } catch {
    // An unknown currency code: better a bare number than a broken screen.
    return `${(cents / SUBUNITS).toFixed(2)} ${currency}`;
  }
}

/** The value a `<input type="date">` shows for today, in the local time zone. */
export function todayAsInputValue(now: Date = new Date()): string {
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
