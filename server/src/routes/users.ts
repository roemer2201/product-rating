import type { FastifyInstance } from 'fastify';
import {
  createResetLinkSchema,
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  type PasswordResetLink,
  type User,
} from '@product-rating/shared';
import { currentUser } from '../plugins/auth.js';
import { ValidationError } from '../services/errors.js';
import { revokeAllSessions } from '../services/sessions.js';
import { createPasswordReset } from '../services/passwordResets.js';
import { createUser, listUsers, lockPassword, setPassword, updateUser } from '../services/users.js';

/**
 * User administration.
 *
 * Accounts are disabled rather than deleted, so ratings and photos keep a
 * valid owner. An administrator cannot lock themselves out: the own account is
 * off limits for role and state changes, and the service layer additionally
 * refuses to leave the instance without an active administrator.
 *
 * There are two ways to give an account a password back. Setting one directly
 * means the administrator has to pass a password on, and knows it afterwards;
 * a reset link is the better one — it is handed over once and the account owner
 * chooses their own password with it.
 */

export function registerUserRoutes(app: FastifyInstance): void {
  app.get('/api/v1/users', { preHandler: app.requireAdmin }, async () => {
    return { users: listUsers(app.db) satisfies User[] };
  });

  app.post('/api/v1/users', { preHandler: app.requireAdmin }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);

    const user = await createUser(app.db, app.config, {
      username: input.username,
      password: input.password,
      email: input.email ?? null,
      role: input.role,
    });

    request.log.info({ userId: user.id, by: currentUser(request).id }, 'account created by admin');
    return reply.code(201).send({ user: user satisfies User });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/v1/users/:id',
    { preHandler: app.requireAdmin },
    async (request) => {
      const input = updateUserSchema.parse(request.body);
      const admin = currentUser(request);

      if (
        request.params.id === admin.id &&
        (input.role !== undefined || input.disabled !== undefined)
      ) {
        throw new ValidationError('you cannot change your own role or state');
      }

      const user = updateUser(app.db, request.params.id, input);

      // A disabled account keeps no way back in until it is enabled again.
      if (input.disabled === true) revokeAllSessions(app.db, user.id);

      request.log.info({ userId: user.id, by: admin.id }, 'account updated');
      return { user: user satisfies User };
    },
  );

  /**
   * Issues a password link for an account and answers with it once.
   *
   * The application sends no mail — it makes no outbound requests at all — so
   * "sending a link" means the administrator copies it and passes it on the way
   * they pass an invite. Only the hash of the token is stored, so a link that
   * is lost cannot be looked up again, only replaced.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/users/:id/reset-link',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const input = createResetLinkSchema.parse(request.body ?? {});
      const admin = currentUser(request);

      const link = createPasswordReset(app.db, app.config, {
        userId: request.params.id,
        createdBy: admin.id,
        ...(input.ttlHours === undefined ? {} : { ttlHours: input.ttlHours }),
      });

      request.log.info(
        { userId: request.params.id, by: admin.id, expiresAt: link.expiresAt },
        'password reset link issued',
      );

      return reply.code(201).send({ link: link satisfies PasswordResetLink });
    },
  );

  /**
   * Takes the password away from an account: nothing but a reset link gets in
   * afterwards. For a lost device or a password that may have leaked.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/users/:id/lock',
    { preHandler: app.requireAdmin },
    async (request) => {
      const admin = currentUser(request);

      if (request.params.id === admin.id) {
        throw new ValidationError('you cannot take your own password away');
      }

      lockPassword(app.db, request.params.id);
      const revoked = revokeAllSessions(app.db, request.params.id);

      request.log.info(
        { userId: request.params.id, by: admin.id, revoked },
        'account locked, password reset required',
      );

      return { ok: true, revokedSessions: revoked };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/users/:id/password',
    { preHandler: app.requireAdmin },
    async (request) => {
      const input = resetPasswordSchema.parse(request.body);
      const admin = currentUser(request);

      await setPassword(app.db, app.config, request.params.id, input.newPassword);

      // A reset password only helps if the old sessions are gone with it.
      const removed = revokeAllSessions(
        app.db,
        request.params.id,
        request.params.id === admin.id ? request.session?.id : undefined,
      );

      request.log.info(
        { userId: request.params.id, by: admin.id, revoked: removed },
        'password reset by admin',
      );
      return { ok: true, revokedSessions: removed };
    },
  );
}
