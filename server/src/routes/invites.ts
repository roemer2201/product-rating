import type { FastifyInstance } from 'fastify';
import { createInviteSchema, inviteCodeSchema, type Invite } from '@product-rating/shared';
import { currentUser } from '../plugins/auth.js';
import { createInvite, listInvites, revokeInvite } from '../services/invites.js';

/**
 * Invite management, administrators only.
 *
 * Listing returns the codes in clear text — that is the point of the feature:
 * an admin has to be able to read a code again in order to pass it on.
 */

export function registerInviteRoutes(app: FastifyInstance): void {
  app.post('/api/v1/invites', { preHandler: app.requireAdmin }, async (request, reply) => {
    const input = createInviteSchema.parse(request.body ?? {});
    const admin = currentUser(request);

    const invite = createInvite(app.db, app.config, {
      createdBy: admin.id,
      note: input.note ?? null,
      ...(input.ttlDays === undefined ? {} : { ttlDays: input.ttlDays }),
    });

    request.log.info({ code: invite.code, by: admin.id }, 'invite created');
    return reply.code(201).send({ invite: invite satisfies Invite });
  });

  app.get('/api/v1/invites', { preHandler: app.requireAdmin }, async () => {
    return { invites: listInvites(app.db) satisfies Invite[] };
  });

  app.delete<{ Params: { code: string } }>(
    '/api/v1/invites/:code',
    { preHandler: app.requireAdmin },
    async (request) => {
      const code = inviteCodeSchema.parse(request.params.code);
      revokeInvite(app.db, code);

      request.log.info({ code, by: currentUser(request).id }, 'invite revoked');
      return { ok: true };
    },
  );
}
