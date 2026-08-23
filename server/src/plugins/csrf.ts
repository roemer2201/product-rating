import type { FastifyInstance, FastifyRequest } from 'fastify';
import { OriginRejectedError } from '../services/errors.js';
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
 *
 * The check is also the single most common way a fresh installation goes
 * wrong: a reverse proxy is put in front of it and `server.base_url` keeps
 * pointing at `http://127.0.0.1:8080`, so the interface loads and every save
 * fails. That is why a rejection is not silent here. It is logged with both
 * addresses and the command that fixes it, and the first request arriving
 * under an unexpected address is reported before anyone has tried to save.
 */

const WRITING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * How many distinct unexpected addresses are reported before the hint stops.
 * The point is a note in the log, not a line per request — and a scanner
 * hitting the instance under a dozen names must not fill the journal.
 */
const MISMATCH_HINT_LIMIT = 8;

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

/** First entry of a header that a chain of proxies may have appended to. */
function firstValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(',')[0]?.trim();
  return first === undefined || first === '' ? undefined : first;
}

/**
 * The address the request claims to have been sent to, for the log only.
 *
 * This is what the browser typed in, as far as `Host` and the forwarding
 * headers reveal it — precisely the value `server.base_url` is supposed to
 * carry. It is never used to decide anything: the headers come from the
 * client and are only trustworthy behind a proxy that overwrites them. As a
 * hint in a message meant for an administrator that is enough, and it is what
 * turns "origin not allowed" into "you configured the wrong address".
 */
export function requestOrigin(request: FastifyRequest): string | null {
  const host = firstValue(request.headers['x-forwarded-host']) ?? firstValue(request.headers.host);
  if (host === undefined) return null;

  const protocol = firstValue(request.headers['x-forwarded-proto']) ?? request.protocol;
  return originOf(`${protocol}://${host}`);
}

export function registerCsrfGuard(app: FastifyInstance): void {
  const origins = allowedOrigins(app.config.server.base_url, app.config.server.trusted_origins);
  const expected = [...origins];
  const reported = new Set<string>();

  /**
   * Reports an address the instance is reached under but does not know, once
   * per address. Whoever put the proxy in front of the application reads this
   * long before a user reports that saving does not work.
   */
  function reportMismatch(request: FastifyRequest): void {
    const arrived = requestOrigin(request);
    if (arrived === null || origins.has(arrived) || reported.has(arrived)) return;
    if (reported.size >= MISMATCH_HINT_LIMIT) return;
    reported.add(arrived);

    request.log.warn(
      { event: 'csrf.address_mismatch', arrived, expected },
      `requests arrive as ${arrived}, but server.base_url is ${app.config.server.base_url} — ` +
        'writing requests from that address will be rejected; set ' +
        `server.base_url = "${arrived}" and restart`,
    );
  }

  app.addHook('onRequest', async (request) => {
    reportMismatch(request);
    if (!WRITING_METHODS.has(request.method)) return;

    const header = request.headers.origin ?? request.headers.referer;
    if (header === undefined) {
      // Browsers send `Origin` on every writing fetch; its absence points at a
      // non-browser client, which has no ambient cookie to abuse.
      if (request.cookies[SESSION_COOKIE] === undefined) return;

      request.log.warn(
        { event: 'csrf.reject', reason: 'no_origin', expected },
        'writing request with a session cookie but neither Origin nor Referer — ' +
          'a browser sends both; check whether the reverse proxy strips them',
      );
      throw new OriginRejectedError(
        'writing request carries a session cookie but no Origin or Referer header',
        { reason: 'no_origin' },
      );
    }

    const origin = originOf(header);
    if (origin === null || !origins.has(origin)) {
      request.log.warn(
        { event: 'csrf.reject', reason: 'unknown_origin', received: origin ?? header, expected },
        `writing request from ${origin ?? header}, allowed is ${expected.join(', ')} — ` +
          'when that is the address this instance is reached under, ' +
          'server.base_url is the setting to correct',
      );
      throw new OriginRejectedError('request origin is not allowed', { reason: 'unknown_origin' });
    }
  });
}
