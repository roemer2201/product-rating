import type { FastifyInstance } from 'fastify';
import {
  createProductSchema,
  eanSchema,
  productListQuerySchema,
  updateProductSchema,
  type Product,
  type ProductDetail,
  type ProductListPage,
  type ProductWithRatings,
  type TrashEntry,
} from '@product-rating/shared';
import { currentUser } from '../plugins/auth.js';
import { productPhotos, removePhotoFiles } from '../services/photos.js';
import {
  createProduct,
  getProduct,
  getProductByEan,
  listCategories,
  listProducts,
  listTrash,
  purgeProduct,
  restoreProduct,
  trashProduct,
  updateProduct,
} from '../services/products.js';

/**
 * The product catalogue.
 *
 * Everything here is behind a login; the catalogue is shared, so any account
 * may add and correct products. Deleting is reserved for administrators,
 * because it takes other people's ratings and photos with it — and it is
 * reversible: a deletion moves the product into the trash, only emptying the
 * trash takes the rows and the image files along.
 */

/**
 * Adds the photo rows to a single product. The list deliberately stays without
 * them and carries `primaryPhotoId` alone — a card shows one image, and reading
 * every photo of every product would be paid for on each page.
 */
function withPhotos(app: FastifyInstance, product: ProductWithRatings): ProductDetail {
  return { ...product, photos: productPhotos(app.db, product.id) };
}

export function registerProductRoutes(app: FastifyInstance): void {
  app.post('/api/v1/products', { preHandler: app.requireUser }, async (request, reply) => {
    const input = createProductSchema.parse(request.body);
    const user = currentUser(request);

    const { product, restored } = createProduct(app.db, user.id, input);

    request.log.info(
      { productId: product.id, ean: product.ean, by: user.id, restored },
      restored ? 'product restored from the trash' : 'product created',
    );
    return reply.code(201).send({ product: product satisfies Product, restored });
  });

  app.get('/api/v1/products', { preHandler: app.requireUser }, async (request) => {
    const query = productListQuerySchema.parse(request.query ?? {});
    return listProducts(app.db, currentUser(request).id, query) satisfies ProductListPage;
  });

  /**
   * Suggestions for the category field of the product form.
   *
   * Registered before `/products/:id` for readability — the router prefers a
   * static segment over a parameter either way, so `categories` is never read
   * as an identifier.
   */
  app.get('/api/v1/products/categories', { preHandler: app.requireUser }, async () => {
    return { categories: listCategories(app.db) };
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
      return { product: withPhotos(app, product) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const product = getProduct(app.db, currentUser(request).id, request.params.id);
      return { product: withPhotos(app, product) };
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

  /**
   * Moves a product into the trash. Nothing is lost here: the ratings, the
   * photos and the EAN stay with the row, the catalogue simply stops showing
   * it.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/v1/products/:id',
    { preHandler: app.requireAdmin },
    async (request) => {
      const admin = currentUser(request);
      const trashed = trashProduct(app.db, request.params.id, admin.id);

      request.log.info(
        {
          productId: trashed.product.id,
          ean: trashed.product.ean,
          by: admin.id,
          ratings: trashed.ratings,
          photos: trashed.photos,
        },
        'product moved to the trash',
      );

      return {
        ok: true,
        trashed: true,
        removedRatings: trashed.ratings,
        removedPhotos: trashed.photos,
      };
    },
  );

  /* ---------------------------------------------------------------- trash */

  app.get('/api/v1/trash', { preHandler: app.requireAdmin }, async () => {
    return { entries: listTrash(app.db) satisfies TrashEntry[] };
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/trash/:id/restore',
    { preHandler: app.requireAdmin },
    async (request) => {
      const admin = currentUser(request);
      const product = restoreProduct(app.db, request.params.id);

      request.log.info(
        { productId: product.id, ean: product.ean, by: admin.id },
        'product restored',
      );
      return { product: product satisfies Product };
    },
  );

  /** The only route that really removes a product, files included. */
  app.delete<{ Params: { id: string } }>(
    '/api/v1/trash/:id',
    { preHandler: app.requireAdmin },
    async (request) => {
      const admin = currentUser(request);
      const removed = purgeProduct(app.db, request.params.id);

      // The cascade takes the photo rows, not their files. Deleting them after
      // the transaction is the safe order: a leftover file is litter `fsck`
      // reports, a file deleted before a failed transaction would be gone.
      const files = await removePhotoFiles(app.config, removed.removedPhotos);

      request.log.info(
        {
          productId: removed.product.id,
          ean: removed.product.ean,
          by: admin.id,
          ratings: removed.removedRatings,
          photos: removed.removedPhotos.length,
          files,
        },
        'product purged',
      );

      return {
        ok: true,
        removedRatings: removed.removedRatings,
        removedPhotos: removed.removedPhotos.length,
      };
    },
  );
}
