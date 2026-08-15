import type { FastifyInstance } from 'fastify';
import {
  myRatingsQuerySchema,
  upsertRatingSchema,
  type Rating,
  type RatingListPage,
  type RatingSummary,
} from '@product-rating/shared';
import { currentUser } from '../plugins/auth.js';
import { deleteRating, listOwnRatings, upsertRating } from '../services/ratings.js';

/**
 * Ratings.
 *
 * Every route works on the caller's own rating; the product is addressed in the
 * path, the account comes from the session. Writing answers with the product's
 * new average and count as well, so the detail page can update the summary
 * without asking again.
 */

export function registerRatingRoutes(app: FastifyInstance): void {
  /** Creates or replaces the caller's rating — repeating it changes nothing. */
  app.put<{ Params: { id: string } }>(
    '/api/v1/products/:id/rating',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const input = upsertRatingSchema.parse(request.body);
      const user = currentUser(request);

      const result = upsertRating(app.db, user.id, request.params.id, input);

      request.log.info(
        { productId: request.params.id, by: user.id, stars: input.stars },
        result.created ? 'rating created' : 'rating updated',
      );

      return reply.code(result.created ? 201 : 200).send({
        rating: result.rating satisfies Rating,
        ratings: result.summary satisfies RatingSummary,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/products/:id/rating',
    { preHandler: app.requireUser },
    async (request) => {
      const user = currentUser(request);
      const summary = deleteRating(app.db, user.id, request.params.id);

      request.log.info({ productId: request.params.id, by: user.id }, 'rating removed');
      return { ok: true, ratings: summary satisfies RatingSummary };
    },
  );

  app.get('/api/v1/ratings/mine', { preHandler: app.requireUser }, async (request) => {
    const query = myRatingsQuerySchema.parse(request.query ?? {});
    return listOwnRatings(app.db, currentUser(request).id, query) satisfies RatingListPage;
  });
}
