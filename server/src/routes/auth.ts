import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema,
  loginSchema,
  redeemResetSchema,
  registerSchema,
  resetTokenSchema,
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
  isLockedHash,
  needsRehash,
  verifyAgainstNobody,
  verifyPassword,
} from '../services/passwords.js';
import { consumePasswordReset, resolvePasswordReset } from '../services/passwordResets.js';
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
 *
 * One case breaks that rule on purpose: an account without a password — after
 * an import, or after an administrator locked it — is told so, because the
 * alternative is somebody typing their correct old password into "wrong
 * username or password" forever. See README 5 for the trade-off.
 */

const LOGIN_FAILED = 'username or password is wrong';

/** Said to an account that is waiting for a reset link instead of a password. */
const LOGIN_LOCKED = 'this account needs a new password; ask an administrator for a link';

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
    // the answer time does not say who has an account here. A locked account
    // has no hash to verify against, so it is made to cost the same.
    const user = findUserByUsername(app.db, username);
    const locked = user !== undefined && isLockedHash(user.passwordHash);
    const matches =
      user === undefined || locked
        ? await verifyAgainstNobody(password, argon2Parameters(app.config))
        : await verifyPassword(user.passwordHash, password);

    if (locked && user.disabledAt === null) {
      // Counted like a failure: the message is more helpful than the usual one,
      // so the rate limit is what keeps it from becoming a way to enumerate.
      for (const key of keys) app.loginLimiter.consume(key);
      request.log.warn(
        {
          event: LOGIN_EVENT,
          outcome: 'failure',
          reason: 'password_reset_required',
          username,
          ip: request.ip,
        },
        'login attempt on a locked account',
      );
      throw new UnauthorizedError(LOGIN_LOCKED, { reason: 'password_reset_required' });
    }

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

  /**
   * Says which account a reset link belongs to, so the form can address the
   * person by name. Everything wrong with a token — unknown, expired, spent,
   * or on a disabled account — is the same answer.
   */
  app.get<{ Params: { token: string } }>('/api/v1/auth/reset/:token', async (request) => {
    const decision = app.loginLimiter.check(`reset:${request.ip}`);
    if (!decision.allowed) throw new RateLimitError(decision.retryAfterSeconds);

    const token = resetTokenSchema.parse(request.params.token);
    const { username } = resolvePasswordReset(app.db, token);

    return { username };
  });

  /**
   * Sets a new password against a link.
   *
   * No current password is asked for: holding the link is the proof, which is
   * why it is short lived, single use and stored only as a hash. Everything
   * that was signed in with the old password is signed out — after a lost
   * device, that is the whole point of the exercise.
   */
  app.post('/api/v1/auth/reset', async (request, reply) => {
    const key = `reset:${request.ip}`;
    const decision = app.loginLimiter.check(key);
    if (!decision.allowed) throw new RateLimitError(decision.retryAfterSeconds);

    const input = redeemResetSchema.parse(request.body);

    let resolved;
    try {
      resolved = resolvePasswordReset(app.db, input.token);
    } catch (error) {
      app.loginLimiter.consume(key);
      throw error;
    }

    assertPasswordPolicy(input.newPassword, app.config);
    await setPassword(app.db, app.config, resolved.row.userId, input.newPassword);
    consumePasswordReset(app.db, resolved.row.id);

    const revoked = revokeAllSessions(app.db, resolved.row.userId);
    app.loginLimiter.reset(key);

    request.log.info(
      { event: LOGIN_EVENT, outcome: 'reset', userId: resolved.row.userId, revoked },
      'password set through a reset link',
    );

    // Straight into the app: whoever just proved they hold the link and set a
    // password should not have to type it again on the next screen.
    app.startSession(request, reply, resolved.row.userId);
    return { user: currentPublicUser(request) satisfies User };
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
