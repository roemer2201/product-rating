import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@product-rating/shared';
import { findUserById, toPublicUser } from '../services/users.js';
import {
  SESSION_COOKIE,
  createSession,
  deleteExpiredSessions,
  findSessionByToken,
  touchSession,
} from '../services/sessions.js';
import { ForbiddenError, UnauthorizedError } from '../services/errors.js';
import type { SessionRow, UserRow } from '../db/index.js';

/**
 * Session cookie handling and the authentication hook.
 *
 * The hook runs for every request, resolves the cookie to a user and drops
 * sessions that have expired or whose account has been disabled. Routes stay
 * free of session code and only declare `preHandler: app.requireUser`.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated account, or `null` for anonymous requests. */
    user: UserRow | null;
    /** The session the request was made with, or `null`. */
    session: SessionRow | null;
  }

  interface FastifyInstance {
    /** Rejects anonymous and disabled callers. */
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Rejects everyone who is not an administrator. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Issues a session and sets the cookie. */
    startSession: (request: FastifyRequest, reply: FastifyReply, userId: string) => SessionRow;
    /** Clears the cookie on the client. */
    clearSessionCookie: (reply: FastifyReply) => void;
    /** Cleans up expired sessions; called at start-up and once a day. */
    cleanupSessions: () => number;
  }
}

/** How often expired sessions are swept out. */
export const SESSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Cookies are only marked `Secure` when the public address is HTTPS.
 *
 * A `Secure` cookie is silently dropped by the browser over plain HTTP, which
 * would make a local `http://127.0.0.1:8080` development instance impossible to
 * log into with no visible reason. Every real deployment terminates TLS in
 * front of the app and therefore has an `https://` base URL, so the flag is set
 * exactly where it can work.
 */
export function cookieIsSecure(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerAuth(app: FastifyInstance): void {
  const secure = cookieIsSecure(app.config.server.base_url);
  const maxAgeSeconds = app.config.auth.session_ttl_days * 24 * 60 * 60;

  app.decorateRequest('user', null);
  app.decorateRequest('session', null);

  app.decorate('cleanupSessions', () => deleteExpiredSessions(app.db));

  app.decorate('clearSessionCookie', (reply: FastifyReply) => {
    void reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure, sameSite: 'lax' });
  });

  app.decorate(
    'startSession',
    (request: FastifyRequest, reply: FastifyReply, userId: string): SessionRow => {
      const { token, row } = createSession(
        app.db,
        app.config,
        userId,
        request.headers['user-agent'] ?? null,
      );

      void reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        secure,
        sameSite: 'lax',
        signed: true,
        maxAge: maxAgeSeconds,
      });

      request.user = findUserById(app.db, userId) ?? null;
      request.session = row;
      return row;
    },
  );

  /**
   * Resolves the session cookie. A bad signature, an unknown or expired
   * session and a disabled account all end up the same way: the request
   * continues as anonymous and the stale cookie is cleared.
   */
  app.addHook('onRequest', async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw === undefined) return;

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value === null) {
      app.clearSessionCookie(reply);
      return;
    }

    const session = findSessionByToken(app.db, unsigned.value);
    if (session === undefined) {
      app.clearSessionCookie(reply);
      return;
    }

    const user = findUserById(app.db, session.userId);
    if (user === undefined || user.disabledAt !== null) {
      app.clearSessionCookie(reply);
      return;
    }

    const touched = touchSession(app.db, app.config, session);

    // Rolling renewal is only useful if the cookie learns about it too.
    if (touched.expiresAt.getTime() !== session.expiresAt.getTime()) {
      void reply.setCookie(SESSION_COOKIE, unsigned.value, {
        path: '/',
        httpOnly: true,
        secure,
        sameSite: 'lax',
        signed: true,
        maxAge: maxAgeSeconds,
      });
    }

    request.user = user;
    request.session = touched;
  });

  app.decorate('requireUser', async (request: FastifyRequest) => {
    if (request.user === null) throw new UnauthorizedError();
    if (request.user.disabledAt !== null) throw new ForbiddenError('account is disabled');
  });

  app.decorate('requireAdmin', async (request: FastifyRequest) => {
    if (request.user === null) throw new UnauthorizedError();
    if (request.user.disabledAt !== null) throw new ForbiddenError('account is disabled');
    if (request.user.role !== ('admin' satisfies UserRole)) {
      throw new ForbiddenError('administrator role required');
    }
  });
}

/** The authenticated user of a request, for routes behind `requireUser`. */
export function currentUser(request: FastifyRequest): UserRow {
  if (request.user === null) throw new UnauthorizedError();
  return request.user;
}

/** Public representation of the authenticated user. */
export function currentPublicUser(request: FastifyRequest): ReturnType<typeof toPublicUser> {
  return toPublicUser(currentUser(request));
}
