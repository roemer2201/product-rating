import { relative, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { APP_SHELL } from '../config/schema.js';

/**
 * Delivery of the built web client out of the same process as the API.
 *
 * The application is meant to run as one unit behind a reverse proxy (see
 * README section 2): the proxy terminates TLS and forwards everything, the
 * application answers both `/api/v1/…` and the interface. That keeps the
 * browser on a single origin, which is what the session cookie and the origin
 * check are built around.
 *
 * The frontend is served only when `server.static_dir` names a directory. In
 * development it stays empty, because there the Vite dev server delivers the
 * interface and proxies the API.
 */

/** Directory Vite writes its content hashed bundles into. */
const HASHED_DIRECTORY = 'assets';

/** A file whose name changes with its content may be kept forever. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * Everything else — `index.html`, `sw.js`, the manifest, the icons — keeps its
 * name across releases. `no-cache` allows a cached copy but forces the
 * revalidation that lets a new version through; without it an installed PWA
 * can sit on an old bundle for days.
 */
const REVALIDATE_CACHE = 'no-cache';

/** Sends the app shell so a deep link into the client works on reload. */
export type AppShellSender = (request: FastifyRequest, reply: FastifyReply) => void;

/**
 * Registers the static delivery and returns the fallback for unknown
 * addresses, or `null` when no frontend is configured. The caller hands it to
 * the error handler, which owns the single not-found handler of the instance.
 */
export async function registerStaticFrontend(app: FastifyInstance): Promise<AppShellSender | null> {
  const root = app.config.server.static_dir;
  if (root === '') return null;

  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    index: [APP_SHELL],
    // Directory listings would expose the build output as a browsable tree.
    list: false,
    serveDotFiles: false,
    // The plugin's own `max-age` cannot tell the two cases below apart.
    cacheControl: false,
    setHeaders: (response, path) => {
      const [first] = relative(root, path).split(sep);
      response.setHeader(
        'cache-control',
        first === HASHED_DIRECTORY ? IMMUTABLE_CACHE : REVALIDATE_CACHE,
      );
    },
  });

  app.log.info({ staticDir: root }, 'serving the web client');

  return (_request, reply) => {
    void reply.header('cache-control', REVALIDATE_CACHE).sendFile(APP_SHELL);
  };
}

/**
 * Decides whether an unknown address is a navigation into the client or a
 * missing route.
 *
 * Only a `GET`/`HEAD` for a document gets the app shell. An API address stays
 * a JSON error even then — a client that receives HTML where it expects JSON
 * reports something misleading — and a request for an image or a script that
 * is genuinely missing has to fail as such instead of receiving the shell with
 * status 200.
 */
export function wantsAppShell(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const path = request.url.split('?')[0] ?? '';
  if (path === '/healthz' || path === '/api' || path.startsWith('/api/')) return false;

  return (request.headers.accept ?? '').includes('text/html');
}
