import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestApp } from '../testing/harness.js';

/**
 * The frontend in the same process: a built bundle is faked in a temporary
 * directory, because what matters here is the delivery — cache headers, the
 * fallback for client addresses, and that the API keeps its own answers.
 */

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/** Builds the smallest directory that looks like `npm run build` output. */
function createBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'product-rating-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app shell</title>');
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log("bundle");');
  writeFileSync(join(root, 'sw.js'), '/* service worker */');
  return root;
}

describe('static frontend', () => {
  let root: string;
  let harness: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    root = createBundle();
    harness = await createTestApp({ config: { server: { static_dir: root } } });
    app = harness.app;
  });

  afterAll(async () => {
    await harness.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('serves the app shell at the root', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('app shell');
  });

  it('lets a hashed bundle be cached forever', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('makes the service worker revalidate', async () => {
    const response = await app.inject({ method: 'GET', url: '/sw.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('answers a client address with the app shell', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/products/42',
      headers: { accept: HTML_ACCEPT },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('app shell');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('keeps an unknown API address a JSON error', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nothing-here',
      headers: { accept: HTML_ACCEPT },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it('does not answer a missing asset with the app shell', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/gone-999.js' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it('does not answer a writing request with the app shell', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/products/42',
      headers: { accept: HTML_ACCEPT, origin: 'http://127.0.0.1:8080' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it('still answers the liveness probe itself', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { accept: HTML_ACCEPT },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});

describe('without a configured frontend', () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = await createTestApp();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('answers every unknown address with a JSON error', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/products/42',
      headers: { accept: HTML_ACCEPT },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });
});
