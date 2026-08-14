import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

/**
 * Builds the Fastify instance without starting a listener, so tests can drive
 * it through `app.inject()`.
 *
 * Routes, configuration and persistence are added in later milestones; this is
 * the project skeleton with a single liveness endpoint.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // Raised for photo uploads once multipart handling lands in M6.
    bodyLimit: 1024 * 1024,
  });

  app.get('/healthz', async () => {
    return { status: 'ok' as const };
  });

  return app;
}
