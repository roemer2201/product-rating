import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config/index.js';
import type { AppDatabase } from './db/index.js';
import { registerAuth, SESSION_CLEANUP_INTERVAL_MS } from './plugins/auth.js';
import { registerCsrfGuard } from './plugins/csrf.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerInviteRoutes } from './routes/invites.js';
import { registerProductRoutes } from './routes/products.js';
import { registerRatingRoutes } from './routes/ratings.js';
import { registerUserRoutes } from './routes/users.js';
import { RateLimiter } from './services/rateLimit.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: AppDatabase;
  /** Session secret from `auth.secret_file`; signs the session cookie. */
  secret: string;
  logger?: FastifyServerOptions['logger'];
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
    logger: options.logger ?? false,
    trustProxy: config.server.trust_proxy,
    // JSON bodies only; photo uploads get their own limit from
    // `uploads.max_file_size_mb` once multipart handling lands in M6.
    bodyLimit: 1024 * 1024,
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('loginLimiter', new RateLimiter(config.auth.login_rate_limit_per_minute));

  await app.register(cookie, { secret });

  registerErrorHandler(app);
  registerCsrfGuard(app);
  registerAuth(app);

  app.get('/healthz', async () => {
    return { status: 'ok' as const };
  });

  registerAuthRoutes(app);
  registerInviteRoutes(app);
  registerUserRoutes(app);
  registerProductRoutes(app);
  registerRatingRoutes(app);

  if (options.sessionCleanup !== false) {
    // Expired sessions are swept at start-up and once a day afterwards. The
    // timer is unref'd so it never keeps the process alive on its own.
    const removed = app.cleanupSessions();
    if (removed > 0) app.log.info({ removed }, 'expired sessions removed');

    const timer = setInterval(() => {
      const count = app.cleanupSessions();
      app.loginLimiter.sweep();
      if (count > 0) app.log.info({ removed: count }, 'expired sessions removed');
    }, SESSION_CLEANUP_INTERVAL_MS);
    timer.unref();

    app.addHook('onClose', async () => {
      clearInterval(timer);
    });
  }

  return app;
}
