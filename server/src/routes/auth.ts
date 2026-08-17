import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  type SessionInfo,
  type User,
} from '@product-rating/shared';
import { currentPublicUser, currentUser } from '../plugins/auth.js';
import {
  ConflictError,
  ForbiddenError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '../services/errors.js';
import {
  argon2Parameters,
  hashPassword,
  needsRehash,
  verifyAgainstNobody,
  verifyPassword,
} from '../services/passwords.js';
import { listSessions, revokeAllSessions, revokeSession } from '../services/sessions.js';
import {
  assertPasswordPolicy,
  findUserByUsername,
  insertUser,
  setPassword,
  updatePasswordHash,
} from '../services/users.js';
import { consumeInvite, findInvite } from '../services/invites.js';

/**
 * Routes around logging in, registering and one's own sessions.
 *
 * Login answers with the same message whether the username is unknown, the
 * password wrong or the account disabled: anything else would turn the route
 * into a way of finding out who has an account here.
 */

const LOGIN_FAILED = 'username or password is wrong';

/**
 * Event name every login attempt is logged under, successful or not.
 *
 * One name for all of them is what makes the attempts searchable — "every
 * `auth.login` with `outcome != success` from this address" is a query a log
 * aggregator can answer, "grep for three different sentences" is not. The
 * reason is only in the log; the answer to the client stays the same for all
 * of them, otherwise the route would tell a stranger who has an account here.
 */
const LOGIN_EVENT = 'auth.login';

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/v1/auth/login', async (request, reply) => {
    const { username, password } = loginSchema.parse(request.body);

    // Two independent buckets: one stops a single address from trying many
    // accounts, the other stops many addresses from hammering one account.
    const keys = [`ip:${request.ip}`, `user:${username}`];
    for (const key of keys) {
      const decision = app.loginLimiter.check(key);
      if (!decision.allowed) {
        request.log.warn(
          { event: LOGIN_EVENT, outcome: 'rate_limited', username, ip: request.ip },
          'login attempt rejected',
        );
        throw new RateLimitError(decision.retryAfterSeconds);
      }
    }

    // An unknown name costs the same argon2id verification as a known one, so
    // the answer time does not say who has an account here.
    const user = findUserByUsername(app.db, username);
    const matches =
      user === undefined
        ? await verifyAgainstNobody(password, argon2Parameters(app.config))
        : await verifyPassword(user.passwordHash, password);

    if (user === undefined || !matches || user.disabledAt !== null) {
      for (const key of keys) app.loginLimiter.consume(key);
      request.log.warn(
        {
          event: LOGIN_EVENT,
          outcome: 'failure',
          reason:
            user === undefined ? 'unknown_user' : matches ? 'account_disabled' : 'wrong_password',
          username,
          ip: request.ip,
        },
        'login attempt failed',
      );
      throw new UnauthorizedError(LOGIN_FAILED);
    }

    for (const key of keys) app.loginLimiter.reset(key);

    // Costs were raised since this account was created: upgrade quietly, the
    // plain password is available exactly here.
    const parameters = argon2Parameters(app.config);
    if (needsRehash(user.passwordHash, parameters)) {
      updatePasswordHash(app.db, user.id, await hashPassword(password, parameters));
    }

    app.startSession(request, reply, user.id);
    request.log.info(
      { event: LOGIN_EVENT, outcome: 'success', userId: user.id, username, ip: request.ip },
      'login',
    );

    return { user: currentPublicUser(request) satisfies User };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (request.session !== null && request.user !== null) {
      revokeSession(app.db, request.user.id, request.session.id);
    }
    app.clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: app.requireUser }, async (request) => {
    return { user: currentPublicUser(request) satisfies User };
  });

  app.post('/api/v1/auth/register', async (request, reply) => {
    const input = registerSchema.parse(request.body);

    // Cheap checks before the expensive hash, so a wrong code costs nothing.
    if (findInvite(app.db, input.invite) === undefined) {
      throw new ValidationError('invite code is not valid', { field: 'invite' });
    }
    assertPasswordPolicy(input.password, app.config);
    if (findUserByUsername(app.db, input.username) !== undefined) {
      throw new ConflictError('username is already taken', { field: 'username' });
    }

    const passwordHash = await hashPassword(input.password, argon2Parameters(app.config));

    // Consuming the code and creating the account belong together: neither a
    // burnt code without an account nor an account on a used code is allowed.
    const user = app.db.transaction((tx) => {
      const created = insertUser(tx, {
        username: input.username,
        passwordHash,
        email: input.email ?? null,
        role: 'user',
      });
      consumeInvite(tx, input.invite, created.id);
      return created;
    });

    app.startSession(request, reply, user.id);
    request.log.info({ userId: user.id, username: user.username }, 'account registered');

    return reply.code(201).send({ user });
  });

  app.get('/api/v1/auth/sessions', { preHandler: app.requireUser }, async (request) => {
    const user = currentUser(request);
    return {
      sessions: listSessions(app.db, user.id, request.session?.id ?? null) satisfies SessionInfo[],
    };
  });

  app.delete<{ Params: { id: string } }>(
    '/api/v1/auth/sessions/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = currentUser(request);
      const revoked = revokeSession(app.db, user.id, request.params.id);

      if (!revoked) throw new ForbiddenError('session does not belong to this account');
      if (request.session?.id === request.params.id) app.clearSessionCookie(reply);

      return { ok: true };
    },
  );

  /** Revokes every session except the one making the request. */
  app.delete('/api/v1/auth/sessions', { preHandler: app.requireUser }, async (request) => {
    const user = currentUser(request);
    const removed = revokeAllSessions(app.db, user.id, request.session?.id);
    return { revoked: removed };
  });

  app.post('/api/v1/auth/password', { preHandler: app.requireUser }, async (request) => {
    const user = currentUser(request);
    const input = changePasswordSchema.parse(request.body);

    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      request.log.warn({ userId: user.id }, 'password change with wrong current password');
      throw new UnauthorizedError('current password is wrong');
    }

    if (input.newPassword === input.currentPassword) {
      throw new ValidationError('the new password must differ from the current one', {
        field: 'newPassword',
      });
    }

    await setPassword(app.db, app.config, user.id, input.newPassword);

    // Whoever changes their password expects every other device to be logged
    // out; the current session stays so the user is not thrown out mid-action.
    const removed = revokeAllSessions(app.db, user.id, request.session?.id);
    request.log.info({ userId: user.id, revoked: removed }, 'password changed');

    return { ok: true, revokedSessions: removed };
  });
}
