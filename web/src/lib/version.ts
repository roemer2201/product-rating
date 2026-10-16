/**
 * Which version is running, on this device and on the server.
 *
 * The bundle carries its own version, written in at build time: an installed
 * PWA keeps its bundle in the service worker cache until the update prompt is
 * accepted, so the version of the server says nothing about the code on the
 * phone. The settings screen shows this one and points out when the server
 * reports a different one.
 */
export const APP_VERSION: string = __APP_VERSION__;

/** The numeric `major.minor.patch` of a version; a pre-release suffix is ignored. */
function parts(version: string): number[] {
  const core = version.split(/[-+]/u)[0] ?? '';
  return core.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/** Negative when `a` is older than `b`, positive when newer, zero when equal. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
