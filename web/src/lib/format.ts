import { RATING_MAX_STARS, isValidStars } from '@product-rating/shared';
import { strings } from '@/lib/strings';

/**
 * Turning values from the API into something readable on a phone.
 *
 * Dates arrive as ISO strings and are formatted with `Intl`, so the phone's own
 * settings decide how a date looks — a German user of this app still expects
 * their device's format, not one baked into the bundle.
 */

/**
 * Renders a star rating as text, e.g. 3 -> "★★★☆☆". Used for compact list rows
 * and as the accessible label of the interactive star widget.
 */
export function formatStars(stars: number): string {
  if (!isValidStars(stars)) {
    throw new RangeError(`invalid star rating: ${stars}`);
  }

  return '★'.repeat(stars) + '☆'.repeat(RATING_MAX_STARS - stars);
}

/** An average with one decimal, or a dash where there is nothing to average. */
export function formatAverage(average: number | null): string {
  if (average === null) return '–';
  return average.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Guards against a value the server never sends but a cache might. */
function parseDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(iso: string): string {
  const date = parseDate(iso);
  return date === null ? '–' : dateFormat.format(date);
}

export function formatDateTime(iso: string): string {
  const date = parseDate(iso);
  return date === null ? '–' : dateTimeFormat.format(date);
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** Steps from the smallest unit up; the first one that fits is used. */
const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/**
 * "vor 3 Minuten" for a session that was last seen a moment ago.
 *
 * A list of devices is read to answer "is that still me on the old phone", and
 * for that a distance is easier to judge than a timestamp.
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = parseDate(iso);
  if (date === null) return '–';

  let value = (date.getTime() - now.getTime()) / 1000;

  for (const [unit, limit] of RELATIVE_STEPS) {
    if (Math.abs(value) < limit) return relativeFormat.format(Math.round(value), unit);
    value /= limit;
  }

  return dateFormat.format(date);
}

/* ------------------------------------------------------------ user agents */

/** Device families worth naming, longest match first where they overlap. */
const DEVICES: readonly [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\biPod\b/, 'iPod'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMacintosh\b|\bMac OS X\b/, 'Mac'],
  [/\bWindows\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * Browsers in the order they have to be tested: every one of them claims to be
 * several of the others further down the list.
 */
const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdgi?A?\/|\bEdg\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  // No word boundary before `Chrome`: `HeadlessChrome/` and `Chromium/` are
  // Chrome for the purpose of this list, and without it they would fall through
  // to the `Safari/` every Chrome carries and be labelled Safari.
  [/\bCriOS\/|Chrom(?:e|ium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

function match(patterns: readonly [RegExp, string][], value: string): string | null {
  for (const [pattern, name] of patterns) {
    if (pattern.test(value)) return name;
  }
  return null;
}

/**
 * Condenses a user agent to something like "iPhone · Safari".
 *
 * The raw header is a hundred characters of version numbers and historical
 * lies, and the question a session list has to answer is only ever "which of my
 * devices is this". Two words answer it; anything a pattern does not recognise
 * keeps whatever half could be identified, and a header that says nothing at
 * all is reported as an unknown device rather than shown raw.
 */
export function describeUserAgent(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === '') return strings.settings.unknownDevice;

  const device = match(DEVICES, userAgent);
  const browser = match(BROWSERS, userAgent);

  if (device !== null && browser !== null) return `${device} · ${browser}`;
  return device ?? browser ?? strings.settings.unknownDevice;
}
