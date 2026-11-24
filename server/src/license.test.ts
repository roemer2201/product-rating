import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The licence of the repository, and that every place which names it agrees.
 *
 * The program is under the GNU AGPL 3.0 or later. `LICENSE` carries the text;
 * the four package manifests, the copyright file of the Debian package and the
 * label of the container image name it. Nothing derives one from the other,
 * so this test keeps them together, the way `version.test.ts` does for the
 * version.
 */

const SPDX = 'AGPL-3.0-or-later';

/** Paths relative to this file, which lives in `server/src/`. */
function repoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const MANIFESTS = [
  'package.json',
  'server/package.json',
  'web/package.json',
  'shared/package.json',
] as const;

describe('the licence of the repository', () => {
  it('is the GNU AGPL version 3 in LICENSE', () => {
    const text = repoFile('LICENSE');
    expect(text.trimStart()).toMatch(/^GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3,/);
    expect(text).toContain(
      '13. Remote Network Interaction; Use with the GNU General Public License.',
    );
    expect(text).toContain('END OF TERMS AND CONDITIONS');
  });

  it.each(MANIFESTS)('is named in %s', (path) => {
    expect((JSON.parse(repoFile(path)) as { license?: string }).license).toBe(SPDX);
  });

  it('is named, with its full text, in the copyright file of the Debian package', () => {
    const copyright = repoFile('packaging/debian/copyright');
    expect(copyright).toMatch(/^Files: \*\nCopyright: .+\nLicense: AGPL-3\+$/m);

    // The text follows as a continuation of the stand-alone licence paragraph:
    // one leading space per line, " ." for an empty one.
    const paragraph = copyright.slice(copyright.lastIndexOf('\nLicense: AGPL-3+\n'));
    const quoted = paragraph
      .split('\n')
      .filter((line) => line.startsWith(' '))
      .map((line) => (line === ' .' ? '' : line.slice(1)))
      .join('\n');
    expect(quoted).toContain(repoFile('LICENSE').trimEnd());
  });

  it('is the label of the container image', () => {
    expect(repoFile('docker/Dockerfile')).toContain(`org.opencontainers.image.licenses="${SPDX}"`);
  });
});
