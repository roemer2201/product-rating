import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config/index.js';

export interface BuildAppOptions {
  config: AppConfig;
  logger?: FastifyServerOptions['logger'];
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

/**
 * Builds the Fastify instance without starting a listener, so tests can drive
 * it through `app.inject()`.
 *
 * Routes and persistence are added in later milestones; this is the project
 * skeleton with a single liveness endpoint. The validated configuration is
 * decorated onto the instance, so nothing below reads `process.env`.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { config } = options;

  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.server.trust_proxy,
    // JSON bodies only; photo uploads get their own limit from
    // `uploads.max_file_size_mb` once multipart handling lands in M6.
    bodyLimit: 1024 * 1024,
  });

  app.decorate('config', config);

  app.get('/healthz', async () => {
    return { status: 'ok' as const };
  });

  return app;
}
