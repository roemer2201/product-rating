import type { FastifyInstance } from 'fastify';
import {
  createProductSchema,
  eanSchema,
  productListQuerySchema,
  updateProductSchema,
  type Product,
  type ProductListPage,
  type ProductWithRatings,
} from '@product-rating/shared';
import { currentUser } from '../plugins/auth.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  getProductByEan,
  listProducts,
  updateProduct,
} from '../services/products.js';

/**
 * The product catalogue.
 *
 * Everything here is behind a login; the catalogue is shared, so any account
 * may add and correct products. Deleting is reserved for administrators,
 * because it takes other people's ratings and photos with it.
 */

export function registerProductRoutes(app: FastifyInstance): void {
  app.post('/api/v1/products', { preHandler: app.requireUser }, async (request, reply) => {
    const input = createProductSchema.parse(request.body);
    const user = currentUser(request);

    const product = createProduct(app.db, user.id, input);

    request.log.info({ productId: product.id, ean: product.ean, by: user.id }, 'product created');
    return reply.code(201).send({ product: product satisfies Product });
  });

  app.get('/api/v1/products', { preHandler: app.requireUser }, async (request) => {
    const query = productListQuerySchema.parse(request.query ?? {});
    return listProducts(app.db, currentUser(request).id, query) satisfies ProductListPage;
  });

  /**
   * Lookup right after a scan. The EAN is normalised on the way in, so an
   * EAN-8 or UPC-A finds the product that was stored from its EAN-13 form.
   */
  app.get<{ Params: { ean: string } }>(
    '/api/v1/products/by-ean/:ean',
    { preHandler: app.requireUser },
    async (request) => {
      const ean = eanSchema.parse(request.params.ean);
      const product = getProductByEan(app.db, currentUser(request).id, ean);
      return { product: product satisfies ProductWithRatings };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const product = getProduct(app.db, currentUser(request).id, request.params.id);
      return { product: product satisfies ProductWithRatings };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const input = updateProductSchema.parse(request.body);
      const user = currentUser(request);

      const product = updateProduct(app.db, request.params.id, input);

      request.log.info({ productId: product.id, by: user.id }, 'product updated');
      return { product: product satisfies Product };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    { preHandler: app.requireAdmin },
    async (request) => {
      const admin = currentUser(request);
      const removed = deleteProduct(app.db, request.params.id);

      request.log.info(
        {
          productId: removed.product.id,
          ean: removed.product.ean,
          by: admin.id,
          ratings: removed.removedRatings,
          photos: removed.removedPhotos.length,
        },
        'product deleted',
      );

      return {
        ok: true,
        removedRatings: removed.removedRatings,
        removedPhotos: removed.removedPhotos.length,
      };
    },
  );
}
