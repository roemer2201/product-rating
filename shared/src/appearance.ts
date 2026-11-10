/**
 * How the interface looks for one account.
 *
 * Three independent choices: the layout arranges the screens, the scheme says
 * whether they are light or dark, and the palette picks the accent colour.
 * None of them changes what the app can do - every layout shows the same
 * screens with the same controls.
 *
 * The choice belongs to the account and travels with it to every device, which
 * is why the vocabulary lives here: the server stores and validates it, the
 * client turns it into attributes on the document.
 */

/** `classic` is the interface as it was before layouts existed. */
export const APPEARANCE_LAYOUTS = ['classic', 'compact', 'gallery'] as const;

/** `system` follows the device; the other two overrule it. */
export const APPEARANCE_SCHEMES = ['system', 'light', 'dark'] as const;

/** `blue` is the accent the app started with. */
export const APPEARANCE_PALETTES = ['blue', 'forest', 'berry', 'graphite'] as const;

export type AppearanceLayout = (typeof APPEARANCE_LAYOUTS)[number];
export type AppearanceScheme = (typeof APPEARANCE_SCHEMES)[number];
export type AppearancePalette = (typeof APPEARANCE_PALETTES)[number];

export interface Appearance {
  layout: AppearanceLayout;
  scheme: AppearanceScheme;
  palette: AppearancePalette;
}

/** What an account sees that never chose anything. */
export const DEFAULT_APPEARANCE: Appearance = {
  layout: 'classic',
  scheme: 'system',
  palette: 'blue',
};

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Completes whatever is stored into an appearance that can be applied.
 *
 * Deliberately forgiving: a missing value, `null` and a value this version
 * does not know all become the default. The last case is real - a database
 * that was written by a newer version and is opened by an older one, or a copy
 * kept in the browser from before an update - and a look that silently falls
 * back is a better answer to it than an account that cannot load.
 */
export function resolveAppearance(stored: unknown): Appearance {
  const source: Record<string, unknown> =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};

  return {
    layout: pick(APPEARANCE_LAYOUTS, source.layout, DEFAULT_APPEARANCE.layout),
    scheme: pick(APPEARANCE_SCHEMES, source.scheme, DEFAULT_APPEARANCE.scheme),
    palette: pick(APPEARANCE_PALETTES, source.palette, DEFAULT_APPEARANCE.palette),
  };
}
