import type { FastifyInstance } from 'fastify';
import { createCategorySchema, updateCategorySchema, type Category } from '@product-rating/shared';
import { currentUser } from '../plugins/auth.js';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../services/categories.js';

/**
 * The category list.
 *
 * Reading is open to every account, because every product form shows the
 * list. Keeping it is the administrators' job: a category is a heading of the
 * whole catalogue, and renaming or deleting one changes other people's
 * products along with it.
 */

export function registerCategoryRoutes(app: FastifyInstance): void {
  app.get('/api/v1/categories', { preHandler: app.requireUser }, async () => {
    return { categories: listCategories(app.db) satisfies Category[] };
  });

  app.post('/api/v1/categories', { preHandler: app.requireAdmin }, async (request, reply) => {
    const input = createCategorySchema.parse(request.body);
    const admin = currentUser(request);

    const category = createCategory(app.db, input);

    request.log.info(
      { categoryId: category.id, name: category.name, by: admin.id },
      'category created',
    );
    return reply.code(201).send({ category: category satisfies Category });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/v1/categories/:id',
    { preHandler: app.requireAdmin },
    async (request) => {
      const input = updateCategorySchema.parse(request.body);
      const admin = currentUser(request);

      const category = updateCategory(app.db, request.params.id, input);

      request.log.info(
        { categoryId: category.id, name: category.name, by: admin.id },
        'category updated',
      );
      return { category: category satisfies Category };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/categories/:id',
    { preHandler: app.requireAdmin },
    async (request) => {
      const admin = currentUser(request);
      const removed = deleteCategory(app.db, request.params.id);

      request.log.info(
        {
          categoryId: removed.category.id,
          name: removed.category.name,
          by: admin.id,
          products: removed.removedFrom,
        },
        'category deleted',
      );
      return { ok: true, removedFrom: removed.removedFrom };
    },
  );
}
