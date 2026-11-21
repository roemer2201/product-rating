/**
 * Turns the `repository.url` of a package manifest (`git+https://….git`) into
 * the address a browser opens, for the source link on the settings screen.
 * Shared by `web/vite.config.ts` and `vitest.config.ts`, which write it into
 * the bundle and the tests.
 */
export function repositorySourceUrl(url: string): string {
  return url.replace(/^git\+/u, '').replace(/\.git$/u, '');
}
