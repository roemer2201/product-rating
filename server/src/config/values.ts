import type { z } from 'zod';
import type { ConfigSection } from './schema.js';

/** One configuration section before validation. */
export type RawSection = Record<string, unknown>;

/** A partially filled configuration, as produced by one source. */
export type RawConfig = Partial<Record<ConfigSection, RawSection>>;

const TRUE_WORDS = new Set(['true', '1', 'yes', 'on']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off']);

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (TRUE_WORDS.has(normalized)) return true;
  if (FALSE_WORDS.has(normalized)) return false;
  return undefined;
}

/**
 * Converts a string from an environment variable or a CLI argument into the
 * type the key expects.
 *
 * The conversion is driven by the key schema itself rather than by a second
 * table of types: the candidates (string, number, boolean, comma separated
 * list) are offered to the schema in turn and the first accepted one wins. A
 * value that fits none of them is passed through unchanged so that zod reports
 * the real validation error.
 */
export function coerceStringValue(schema: z.ZodType, raw: string): unknown {
  if (schema.safeParse(raw).success) return raw;

  const trimmed = raw.trim();

  if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
    const asNumber = Number(trimmed);
    if (schema.safeParse(asNumber).success) return asNumber;
  }

  const asBoolean = parseBoolean(trimmed);
  if (asBoolean !== undefined && schema.safeParse(asBoolean).success) return asBoolean;

  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (schema.safeParse(list).success) return list;

  const numberList = list.map(Number);
  if (numberList.every((entry) => Number.isFinite(entry)) && schema.safeParse(numberList).success) {
    return numberList;
  }

  return raw;
}

/** Writes a single value into a raw configuration, creating the section. */
export function setRawValue(
  target: RawConfig,
  section: ConfigSection,
  key: string,
  value: unknown,
): void {
  const existing = target[section];
  if (existing === undefined) {
    target[section] = { [key]: value };
    return;
  }
  existing[key] = value;
}

/**
 * Merges raw configurations, later sources winning key by key. The nesting is
 * exactly two levels deep, so a plain per-section merge is enough.
 */
export function mergeRawConfigs(...sources: RawConfig[]): RawConfig {
  const result: RawConfig = {};

  for (const source of sources) {
    for (const [section, values] of Object.entries(source) as [ConfigSection, RawSection][]) {
      result[section] = { ...result[section], ...values };
    }
  }

  return result;
}
