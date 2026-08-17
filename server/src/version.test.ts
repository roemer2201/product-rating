import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_VERSION } from './version.js';

/**
 * The version of the repository, and that everything which states it agrees.
 *
 * One number describes the whole repository (README section 9.1). It is kept
 * in the package manifests, and three other places quote it: `product-rating
 * version` and `/healthz` read it out of `server/package.json`, `build-deb.sh`
 * out of the manifest in the root, and `packaging/debian/changelog` carries it
 * as the version of the package. Nothing derives one from the other at build
 * time, so this test is what keeps them from drifting apart — a release with a
 * package that calls itself something else than the application inside it is a
 * mistake nobody notices until it is installed.
 */

/** Paths relative to this file, which lives in `server/src/`. */
function repoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

function manifestVersion(path: string): string {
  return (JSON.parse(repoFile(path)) as { version: string }).version;
}

const MANIFESTS = [
  'package.json',
  'server/package.json',
  'web/package.json',
  'shared/package.json',
] as const;

describe('the version of the repository', () => {
  it('is a semantic version', () => {
    // Release versions only; a pre-release suffix would have to be taught to
    // dpkg (which reads `~` differently) before it could be used here.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the same in every package manifest', () => {
    for (const manifest of MANIFESTS) {
      expect(manifestVersion(manifest), manifest).toBe(APP_VERSION);
    }
  });

  it('is what the Debian changelog announces at the top', () => {
    const changelog = repoFile('packaging/debian/changelog');
    const [first = ''] = changelog.split('\n');

    expect(first).toBe(`${APP_NAME} (${APP_VERSION}) unstable; urgency=medium`);
  });

  it('is a version dpkg accepts', () => {
    // build-deb.sh checks the same thing before it labels a package.
    expect(APP_VERSION).toMatch(/^[0-9][A-Za-z0-9.+~-]*$/);
  });
});
