import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_LAYOUTS, APPEARANCE_PALETTES } from '@product-rating/shared';

/**
 * The stylesheet against the vocabulary of `shared/appearance.ts`.
 *
 * No test can see a colour or a layout, but some mistakes are cheap to catch by
 * reading the files: a palette or a layout that the settings screen offers and
 * the stylesheets do not define, the two copies of the dark scheme drifting
 * apart, and a layout rule that leaks into the classic layout.
 */

// Read from disk rather than imported: the test run does not process CSS, so
// an import would hand over an empty string. The run starts in the repository
// root, which is where the path begins.
function readStylesheet(name: string): string {
  return readFileSync(join(process.cwd(), 'web/src/styles', name), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
}

interface Rule {
  selector: string;
  declarations: string[];
  /** The condition of the `@media` block the rule stands in, if any. */
  media: string | null;
}

/** Enough of a parser for a file of flat rules and one level of `@media`. */
function parseRules(source: string, media: string | null = null): Rule[] {
  const rules: Rule[] = [];
  let position = 0;

  while (position < source.length) {
    const open = source.indexOf('{', position);
    if (open === -1) break;

    let depth = 1;
    let close = open + 1;
    while (depth > 0 && close < source.length) {
      if (source[close] === '{') depth += 1;
      if (source[close] === '}') depth -= 1;
      close += 1;
    }

    const selector = source.slice(position, open).trim().replace(/\s+/g, ' ');
    const body = source.slice(open + 1, close - 1);

    if (selector.startsWith('@media')) {
      rules.push(...parseRules(body, selector.slice('@media'.length).trim()));
    } else {
      rules.push({
        selector,
        media,
        declarations: body
          .split(';')
          .map((declaration) => declaration.trim().replace(/\s+/g, ' '))
          .filter((declaration) => declaration !== ''),
      });
    }

    position = close;
  }

  return rules;
}

const rules = parseRules(readStylesheet('theme.css'));
const layoutRules = parseRules(readStylesheet('layouts.css'));

describe('theme.css', () => {
  it('defines every palette the settings screen offers, in both schemes', () => {
    const tokens = ['', '-hover', '-text', '-soft'].flatMap((suffix) => [
      `--accent-light${suffix}`,
      `--accent-dark${suffix}`,
    ]);

    for (const palette of APPEARANCE_PALETTES) {
      const rule = rules.find((entry) => entry.selector.includes(`[data-palette='${palette}']`));
      const defined = rule?.declarations.map((declaration) => declaration.split(':')[0]) ?? [];

      expect(defined.sort(), `palette "${palette}"`).toEqual([...tokens].sort());
    }
  });

  it('keeps the dark scheme of the device and the chosen dark scheme identical', () => {
    const fromDevice = rules
      .filter((rule) => rule.media === '(prefers-color-scheme: dark)')
      .map((rule) => ({
        selector: rule.selector.replaceAll(":root:not([data-scheme='light'])", ':root[dark]'),
        declarations: rule.declarations,
      }));

    const chosen = rules
      .filter((rule) => rule.media === null && rule.selector.includes("[data-scheme='dark']"))
      .map((rule) => ({
        selector: rule.selector.replaceAll(":root[data-scheme='dark']", ':root[dark]'),
        // Only the chosen scheme has to tell the browser which one it is; the
        // device already knows its own.
        declarations: rule.declarations.filter(
          (declaration) => !declaration.startsWith('color-scheme'),
        ),
      }));

    expect(fromDevice.length).toBeGreaterThan(0);
    expect(chosen).toEqual(fromDevice);
  });
});

describe('layouts.css', () => {
  const layouts = APPEARANCE_LAYOUTS.filter((layout) => layout !== 'classic');

  it('draws every layout the settings screen offers besides the classic one', () => {
    for (const layout of layouts) {
      // The rule on the document itself: where a layout sets its tokens.
      const root = layoutRules.find((rule) => rule.selector === `[data-layout='${layout}']`);

      expect(root, `layout "${layout}"`).toBeDefined();
      // Screens and notices are padded by it; a layout that moves the
      // navigation without saying how tall it is hides content behind it.
      expect(
        root?.declarations.some((declaration) => declaration.startsWith('--nav-height:')),
        `--nav-height of "${layout}"`,
      ).toBe(true);
    }
  });

  it('touches nothing unless a layout was chosen', () => {
    const known = layouts.map((layout) => `[data-layout='${layout}']`);

    for (const rule of layoutRules) {
      for (const selector of rule.selector.split(',').map((part) => part.trim())) {
        expect(
          known.some((prefix) => selector.startsWith(prefix)),
          `selector "${selector}"`,
        ).toBe(true);
      }
    }
  });
});
