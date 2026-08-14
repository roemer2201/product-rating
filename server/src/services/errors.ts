/**
 * Errors the service layer raises and the HTTP layer turns into responses.
 *
 * Services never touch Fastify; they describe what went wrong and let the
 * error handler pick status code and wording. That keeps the CLI (M13) able to
 * call the same services without an HTTP request in sight.
 */

export class ServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** 400 – the request was understood but the values do not work. */
export class ValidationError extends ServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'invalid_request', message, details);
    this.name = 'ValidationError';
  }
}

/** 401 – no or no longer valid credentials. */
export class UnauthorizedError extends ServiceError {
  constructor(message = 'authentication required') {
    super(401, 'unauthorized', message);
    this.name = 'UnauthorizedError';
  }
}

/** 403 – authenticated, but not allowed to do this. */
export class ForbiddenError extends ServiceError {
  constructor(message = 'not allowed') {
    super(403, 'forbidden', message);
    this.name = 'ForbiddenError';
  }
}

/** 404 – the addressed object does not exist (or must not be revealed). */
export class NotFoundError extends ServiceError {
  constructor(message = 'not found', details?: Record<string, unknown>) {
    super(404, 'not_found', message, details);
    this.name = 'NotFoundError';
  }
}

/** 409 – the request collides with existing data, e.g. a taken username. */
export class ConflictError extends ServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, 'conflict', message, details);
    this.name = 'ConflictError';
  }
}

/** 429 – too many attempts; carries the seconds until the next one. */
export class RateLimitError extends ServiceError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(429, 'rate_limited', 'too many attempts, please wait', { retryAfterSeconds });
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
