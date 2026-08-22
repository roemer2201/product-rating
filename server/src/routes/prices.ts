import type { FastifyInstance } from 'fastify';
import { createPriceSchema, type Price } from '@product-rating/shared';
import { currentUser } from '../plugins/auth.js';
import { createPrice, deletePrice, listShops } from '../services/prices.js';

/**
 * The price history of a product.
 *
 * Recording is open to every account, like everything else about the shared
 * catalogue: what a product costs is a fact about the household, not about one
 * person. An entry belongs to whoever wrote it down, so removing one is theirs
 * and the administrators' — the same rule photos follow.
 *
 * Reading happens through `GET /api/v1/products/:id`, which carries the list
 * along; there is no route of its own for it. A price is only ever interesting
 * next to the product it belongs to.
 */

export function registerPriceRoutes(app: FastifyInstance): void {
  /**
   * Suggestions for the shop field. Registered before `/prices/:id` for
   * readability — the router prefers a static segment over a parameter either
   * way, so `shops` is never read as an identifier.
   */
  app.get('/api/v1/prices/shops', { preHandler: app.requireUser }, async () => {
    return { shops: listShops(app.db) };
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/products/:id/prices',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const input = createPriceSchema.parse(request.body);
      const user = currentUser(request);

      const price = createPrice(app.db, app.config, user.id, request.params.id, input);

      request.log.info(
        {
          priceId: price.id,
          productId: price.productId,
          by: user.id,
          cents: price.cents,
          currency: price.currency,
        },
        'price recorded',
      );

      return reply.code(201).send({ price: price satisfies Price });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/prices/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const user = currentUser(request);
      const removed = deletePrice(app.db, user, request.params.id);

      request.log.info(
        { priceId: removed.id, productId: removed.productId, by: user.id },
        'price removed',
      );

      return { ok: true };
    },
  );
}
