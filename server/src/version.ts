import { readFileSync } from 'node:fs';

/**
 * Version of the running application, read from the package manifest.
 *
 * The manifest sits one level above this module in both layouts that have to
 * work: `server/src/version.ts` during development and `server/dist/index.js`
 * in a bundle, which the Debian package and the container image install next
 * to the `package.json` it was built from. A missing or unreadable manifest is
 * not worth aborting a start-up for, so it degrades to `0.0.0`.
 */
function readVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };

    return typeof manifest.version === 'string' && manifest.version.length > 0
      ? manifest.version
      : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const APP_VERSION = readVersion();

/** Name the CLI and the syslog tag use. */
export const APP_NAME = 'product-rating';
