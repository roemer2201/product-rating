/**
 * Constants Vite writes into the bundle at build time (`define` in
 * `vite.config.ts`, and the same for the tests in `vitest.config.ts`).
 */

/** Version from `web/package.json`, which is the version of the whole repository. */
declare const __APP_VERSION__: string;

/** Address of the source code, from `repository` in `web/package.json`. */
declare const __APP_SOURCE_URL__: string;
