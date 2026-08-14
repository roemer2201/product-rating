import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '../services/errors.js';
import { SESSION_COOKIE } from '../services/sessions.js';

/**
 * Origin check for every writing request.
 *
 * `SameSite=Lax` already keeps the session cookie away from cross-site POSTs
 * in current browsers, but it is one setting away from being the only defence.
 * The second lock is cheap: a writing request has to carry an `Origin` (or at
 * least a `Referer`) that belongs to this instance. No token round trip is
 * needed, which suits an API the PWA talks to with `fetch`.
 *
 * Allowed are `server.base_url` and everything in `server.trusted_origins` —
 * the latter exists for the Vite dev server, which sends its own origin
 * through the proxy.
 */

const WRITING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Normalises to scheme://host[:port], or `null` if unparsable. */
export function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Every origin considered part of this instance. */
export function allowedOrigins(baseUrl: string, trusted: readonly string[]): Set<string> {
  const origins = new Set<string>();

  const base = originOf(baseUrl);
  if (base !== null) origins.add(base);

  for (const entry of trusted) {
    const origin = originOf(entry);
    if (origin !== null) origins.add(origin);
  }

  return origins;
}

export function registerCsrfGuard(app: FastifyInstance): void {
  const origins = allowedOrigins(app.config.server.base_url, app.config.server.trusted_origins);

  app.addHook('onRequest', async (request) => {
    if (!WRITING_METHODS.has(request.method)) return;

    const header = request.headers.origin ?? request.headers.referer;
    if (header === undefined) {
      // Browsers send `Origin` on every writing fetch; its absence points at a
      // non-browser client, which has no ambient cookie to abuse.
      if (request.cookies[SESSION_COOKIE] === undefined) return;
      throw new ForbiddenError('missing Origin header on a writing request');
    }

    const origin = originOf(header);
    if (origin === null || !origins.has(origin)) {
      throw new ForbiddenError('request origin is not allowed');
    }
  });
}
