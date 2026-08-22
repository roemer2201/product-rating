import { access, constants } from 'node:fs/promises';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { sql } from 'drizzle-orm';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { AppConfig } from './config/index.js';
import type { AppDatabase } from './db/index.js';
import { registerAuth, SESSION_CLEANUP_INTERVAL_MS } from './plugins/auth.js';
import { registerCsrfGuard } from './plugins/csrf.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerSecurityHeaders } from './plugins/securityHeaders.js';
import { registerStaticFrontend } from './plugins/staticFrontend.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerInviteRoutes } from './routes/invites.js';
import { registerPhotoRoutes } from './routes/photos.js';
import { registerPriceRoutes } from './routes/prices.js';
import { registerProductRoutes } from './routes/products.js';
import { registerRatingRoutes } from './routes/ratings.js';
import { registerUserRoutes } from './routes/users.js';
import { removePhotoFiles } from './services/photos.js';
import { purgeExpiredTrash } from './services/products.js';
import { RateLimiter } from './services/rateLimit.js';
import { APP_VERSION } from './version.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: AppDatabase;
  /** Session secret from `auth.secret_file`; signs the session cookie. */
  secret: string;
  logger?: FastifyServerOptions['logger'];
  /** A ready made pino instance; how `serve` applies `[log]`. */
  loggerInstance?: FastifyBaseLogger;
  /** Set to false in tests that do not want a timer running. */
  sessionCleanup?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: AppDatabase;
    /** Failed login counter, keyed by address and by username. */
    loginLimiter: RateLimiter;
  }
}

/**
 * Builds the Fastify instance without starting a listener, so tests can drive
 * it through `app.inject()`.
 *
 * Order matters: cookies have to be parsed before the origin check can look at
 * them, and the authentication hook needs the parsed cookie in turn.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db, secret } = options;

  const app = Fastify({
    ...(options.loggerInstance === undefined
      ? { logger: options.logger ?? false }
      : { loggerInstance: options.loggerInstance }),
    trustProxy: config.server.trust_proxy,
    // Applies to JSON bodies only. Photo uploads go through the multipart
    // plugin below, which enforces `uploads.max_file_size_mb` on its own.
    bodyLimit: 1024 * 1024,
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('loginLimiter', new RateLimiter(config.auth.login_rate_limit_per_minute));

  // First of the hooks, so every answer carries them - including the ones the
  // plugins below produce on their own, such as a rejected upload.
  registerSecurityHeaders(app);

  await app.register(cookie, { secret });

  // One file per request, and the size limit stops the stream instead of
  // letting a huge upload be read into memory first. The reverse proxy has to
  // allow at least as much (`client_max_body_size`, `LimitRequestBody`).
  await app.register(multipart, {
    limits: {
      fileSize: config.uploads.max_file_size_mb * 1024 * 1024,
      files: 1,
      fields: 4,
    },
    throwFileSizeLimit: true,
  });

  // Before the error handler: the frontend decides what an unknown address
  // means, and that decision belongs in the not-found handler.
  const appShell = await registerStaticFrontend(app);

  registerErrorHandler(app, appShell);
  registerCsrfGuard(app);
  registerAuth(app);

  /**
   * Liveness and readiness in one address, because a process that answers but
   * cannot reach its database is of no use to anybody watching it. Deliberately
   * without authentication and therefore deliberately thin: version, whether a
   * query works and whether photos can still be written - nothing that would
   * describe the inside of the installation to a stranger.
   */
  app.get('/healthz', async (_request, reply) => {
    let database = true;
    try {
      db.get(sql`select count(*) as count from users`);
    } catch {
      database = false;
    }

    let uploads = true;
    try {
      await access(config.paths.uploads, constants.W_OK | constants.X_OK);
    } catch {
      uploads = false;
    }

    const healthy = database && uploads;
    if (!healthy) {
      reply.code(503);
      app.log.error({ database, uploads }, 'health check failed');
    }

    return {
      status: healthy ? ('ok' as const) : ('degraded' as const),
      version: APP_VERSION,
      checks: { database, uploads },
    };
  });

  registerAuthRoutes(app);
  registerInviteRoutes(app);
  registerUserRoutes(app);
  registerProductRoutes(app);
  registerRatingRoutes(app);
  registerPhotoRoutes(app);
  registerPriceRoutes(app);

  /**
   * Empties the trash of everything older than `app.trash_retention_days`.
   *
   * The rows go first and the files afterwards, in that order: a leftover file
   * is litter `fsck` reports, a file deleted before a failed transaction would
   * be gone for good.
   */
  const purgeTrash = async (): Promise<void> => {
    const purged = purgeExpiredTrash(db, config.app.trash_retention_days);
    if (purged.length === 0) return;

    let files = 0;
    for (const entry of purged) {
      files += await removePhotoFiles(config, entry.removedPhotos);
    }

    app.log.info(
      {
        products: purged.length,
        ratings: purged.reduce((sum, entry) => sum + entry.removedRatings, 0),
        photos: purged.reduce((sum, entry) => sum + entry.removedPhotos.length, 0),
        files,
        retentionDays: config.app.trash_retention_days,
      },
      'trash emptied',
    );
  };

  if (options.sessionCleanup !== false) {
    // Expired sessions are swept at start-up and once a day afterwards. The
    // timer is unref'd so it never keeps the process alive on its own.
    const removed = app.cleanupSessions();
    if (removed > 0) app.log.info({ removed }, 'expired sessions removed');

    // The trash is swept on the same schedule; retention is counted in days,
    // so once a day is as precise as the setting can be anyway.
    await purgeTrash();

    const timer = setInterval(() => {
      const count = app.cleanupSessions();
      app.loginLimiter.sweep();
      if (count > 0) app.log.info({ removed: count }, 'expired sessions removed');
      void purgeTrash().catch((error: unknown) => {
        app.log.error({ err: error }, 'emptying the trash failed');
      });
    }, SESSION_CLEANUP_INTERVAL_MS);
    timer.unref();

    app.addHook('onClose', async () => {
      clearInterval(timer);
    });
  }

  return app;
}
