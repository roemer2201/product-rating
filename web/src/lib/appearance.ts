import { DEFAULT_APPEARANCE, resolveAppearance, type Appearance } from '@product-rating/shared';

/**
 * Puts the appearance an account chose onto the document.
 *
 * The choice itself belongs to the account and lives on the server. This file
 * is the last step: three attributes on `<html>`, which `styles/theme.css` and
 * `styles/layouts.css` answer to. Nothing here knows a colour or a size.
 *
 * A copy of the last appearance is kept in this browser. The server cannot be
 * asked before the first paint, and not at all without a connection or on the
 * login screen - without the copy the app would start in the defaults every
 * time and jump to the chosen look a moment later. The copy is a memory, not a
 * second truth: whatever `GET /auth/me` answers replaces it.
 */

/** Exported for the test setup, which has to empty it between tests. */
export const APPEARANCE_STORAGE_KEY = 'product-rating-appearance';

/** The appearance this browser showed last; the defaults where it never did. */
export function rememberedAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return stored === null ? DEFAULT_APPEARANCE : resolveAppearance(JSON.parse(stored));
  } catch {
    // Storage may be disabled, or hold something that is not JSON.
    return DEFAULT_APPEARANCE;
  }
}

/**
 * Sets the colour of the status bar to the colour at the top of the screen.
 *
 * `index.html` states it twice, once per scheme of the device, because that is
 * all a document can say before a script has run. From here on the stylesheet
 * is asked instead: `--color-chrome` already is the right colour for the
 * scheme, palette and layout in force, so both tags get that one value.
 */
export function syncThemeColour(): void {
  const colour = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-chrome')
    .trim();
  // No stylesheet, as in a test: leave the tags as the document wrote them.
  if (colour === '') return;

  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = colour;
  }
}

/** Shows an appearance, and remembers it for the next start. */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.layout = appearance.layout;
  root.dataset.scheme = appearance.scheme;
  root.dataset.palette = appearance.palette;

  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* Storage may be disabled; the attributes above still hold for this visit. */
  }

  syncThemeColour();
}

/**
 * Called once, before the first render: brings back the look of the last
 * visit and keeps the status bar in step with a device that changes between
 * light and dark while the account follows it.
 */
export function startAppearance(): void {
  applyAppearance(rememberedAppearance());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeColour);
}
