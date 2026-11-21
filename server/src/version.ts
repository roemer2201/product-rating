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
interface PackageIdentity {
  version?: string;
  productRatingChannel?: string;
}

function readManifest(): PackageIdentity {
  try {
    return JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as PackageIdentity;
  } catch {
    return {};
  }
}

const manifest = readManifest();
export const APP_VERSION =
  typeof manifest?.version === 'string' && manifest.version ? manifest.version : '0.0.0';
/** Only the staged manifest in a development Debian package carries the marker. */
export const DEV_INSTANCE = manifest?.productRatingChannel === 'dev';
export const APP_NAME = DEV_INSTANCE ? 'product-rating-dev' : 'product-rating';
export const DEFAULT_PORT = DEV_INSTANCE ? 8081 : 8080;
