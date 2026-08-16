import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { isValidStars } from '@product-rating/shared';
import { seedDatabase } from './db/testing.js';
import { createSession } from './services/sessions.js';
import { createTestApp, type TestApp } from './testing/harness.js';

describe('app skeleton', () => {
  let harness: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    harness = await createTestApp();
    app = harness.app;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('answers the liveness probe with version and checks', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/) as unknown,
      checks: { database: true, uploads: true },
    });
  });

  it('reports 503 when the upload directory is gone', async () => {
    const own = await createTestApp();
    try {
      rmSync(own.config.paths.uploads, { recursive: true, force: true });

      const response = await own.app.inject({ method: 'GET', url: '/healthz' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        checks: { database: true, uploads: false },
      });
    } finally {
      await own.close();
    }
  });

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
  });

  it('exposes the validated configuration', () => {
    expect(app.config.server.port).toBe(8080);
    expect(app.config.app.title).toBe('product-rating');
  });

  it('can use the shared workspace', () => {
    expect(isValidStars(5)).toBe(true);
  });

  it('exposes the migrated database', () => {
    const tables = harness.database.sqlite
      .prepare(`select name from sqlite_master where type = 'table'`)
      .all() as { name: string }[];

    expect(tables.map((table) => table.name)).toContain('users');
  });

  it('sweeps expired sessions on demand', () => {
    const seeded = seedDatabase(app.db, { users: [{ username: 'anna' }] });
    const userId = seeded.users?.[0]?.id as string;

    createSession(app.db, app.config, userId, null, new Date(Date.now() - 400 * 24 * 3600 * 1000));
    createSession(app.db, app.config, userId, null);

    expect(app.cleanupSessions()).toBe(1);
    expect(app.cleanupSessions()).toBe(0);
  });
});
