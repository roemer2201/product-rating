import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/index.js';

/**
 * The response headers that harden the interface in the browser.
 *
 * They live in the application and not only in the reverse proxy examples,
 * because since M10 the application delivers the HTML itself: it is the one
 * place that knows what its own bundle needs, and a policy maintained in two
 * places drifts apart. The examples under `packaging/examples/` therefore only
 * add `Strict-Transport-Security`, which is the business of whoever terminates
 * TLS — the application behind the proxy speaks plain HTTP and cannot tell
 * whether there is really a certificate in front of it.
 *
 * Everything is sent on every answer, API and interface alike. A JSON error
 * that a browser is talked into rendering as a document is covered by the same
 * policy as the app shell that way.
 */

/**
 * Content-Security-Policy of the built client.
 *
 * The reasoning behind the directives that are not simply `'self'`:
 *
 * - `'wasm-unsafe-eval'`: the barcode decoder is WebAssembly. Without it
 *   Chromium refuses to compile `zxing_reader.wasm` and the scanner falls back
 *   to manual entry for no visible reason. It permits WebAssembly only — not
 *   `eval()` of JavaScript, which stays forbidden.
 * - `img-src blob:`: the photo preview before an upload is an object URL of the
 *   file the camera just produced. `data:` is the standing allowance for the
 *   assets Vite inlines below four kilobytes — the current bundle has none, but
 *   one added icon must not break the interface with an unexplained blank spot.
 * - `media-src blob:`: the live camera picture reaches the `<video>` element
 *   through `srcObject`, which is not a fetch and therefore not covered by the
 *   policy at all. `blob:` stays in the list anyway, because WebKit has
 *   repeatedly measured a stream against `media-src`, and the failure mode
 *   would be the scanner on the iPhone — the whole point of the app.
 * - `frame-ancestors 'none'`: the interface is not meant to be embedded, which
 *   `X-Frame-Options` below says a second time for browsers that only know it.
 *
 * Left out on purpose: `'unsafe-inline'` anywhere. The build writes neither an
 * inline script nor an inline style — the bundle and the stylesheet are files
 * with their own addresses, and the interface uses no `style` attributes.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  // The service worker is a file of the bundle; nothing here builds a worker
  // out of a generated script.
  "worker-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
] as const;

/**
 * `upgrade-insecure-requests` is only added for an instance that is reached
 * over HTTPS. On a plain HTTP test instance it would turn every request of the
 * page into an HTTPS request that nothing answers.
 */
export function contentSecurityPolicy(baseUrl: string): string {
  const directives: string[] = [...CSP_DIRECTIVES];
  if (isHttps(baseUrl)) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function isHttps(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The complete header set for a configuration.
 *
 * `Permissions-Policy` has to keep the camera: it is what the barcode scanner
 * runs on. Everything else the browser could offer is switched off, so a flaw
 * in a dependency cannot ask for a location or a microphone.
 *
 * `Strict-Transport-Security` is deliberately absent, see the module comment.
 */
export function securityHeaders(config: AppConfig): Record<string, string> {
  return {
    'content-security-policy': contentSecurityPolicy(config.server.base_url),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    // Keeps the path inside the instance out of foreign servers' logs while
    // leaving the same-origin `Referer` intact — the CSRF check falls back to
    // it when a request carries no `Origin`.
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(self), geolocation=(), microphone=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    // Photos and bundle are for this origin; nothing here is meant to be
    // embedded by another site.
    'cross-origin-resource-policy': 'same-origin',
  };
}

/**
 * Answers of the API are not written to disk by the browser.
 *
 * Everything below `/api/v1/` needs a session to get at, and a shared or
 * borrowed device should not keep the catalogue and the account in its HTTP
 * cache afterwards. The one address that wants to be cached says so itself:
 * `GET /api/v1/media/:id` replaces this with `private, max-age=…` when it
 * answers, because a route sets its headers after this hook has run.
 */
const API_PREFIX = '/api/';
const API_CACHE = 'no-store';

export function registerSecurityHeaders(app: FastifyInstance): void {
  const headers = Object.entries(securityHeaders(app.config));

  // `onRequest` rather than `onSend`: the headers are then already on the reply
  // when a route, the static plugin or the error handler answers, so error
  // responses carry them too.
  app.addHook('onRequest', async (request, reply) => {
    for (const [name, value] of headers) reply.header(name, value);

    if (request.url.startsWith(API_PREFIX)) reply.header('cache-control', API_CACHE);
  });
}
