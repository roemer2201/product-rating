import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ServiceError } from '../services/errors.js';

/**
 * Turns service errors, Zod failures and anything unexpected into a single
 * JSON shape: `{ error: { code, message, details? } }`.
 *
 * Unexpected errors are logged with their stack but answered with a generic
 * message — an internal path or SQL fragment has no place in a response.
 */

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      error: { code: 'not_found', message: `route ${request.method} ${request.url} not found` },
    } satisfies ErrorBody);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'request body is not valid',
          details: {
            issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
          },
        },
      } satisfies ErrorBody);
      return;
    }

    if (error instanceof ServiceError) {
      const body: ErrorBody = {
        error: { code: error.code, message: error.message },
      };
      if (error.details !== undefined) body.error.details = error.details;

      if (error.statusCode === 429 && typeof error.details?.retryAfterSeconds === 'number') {
        void reply.header('retry-after', String(error.details.retryAfterSeconds));
      }

      void reply.code(error.statusCode).send(body);
      return;
    }

    // Fastify's own errors (bad JSON, body too large) already carry a status.
    const fastifyError = error as FastifyError;
    const statusCode = fastifyError.statusCode ?? 500;
    if (statusCode < 500) {
      void reply.code(statusCode).send({
        error: {
          code: fastifyError.code ?? 'invalid_request',
          message: fastifyError.message,
        },
      } satisfies ErrorBody);
      return;
    }

    request.log.error({ err: error }, 'unhandled error');
    void reply.code(500).send({
      error: { code: 'internal_error', message: 'internal server error' },
    } satisfies ErrorBody);
  });
}
