import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestApp } from '../testing/harness.js';
import { contentSecurityPolicy, securityHeaders } from './securityHeaders.js';
import { parseConfig } from '../config/index.js';

/**
 * The hardening headers. What matters is that they reach every answer — the
 * interface, the API and the error responses alike — and that the policy still
 * allows what the client genuinely needs: its own bundle, the WebAssembly
 * decoder and the object URL of a photo preview.
 */

/** Turns a policy string into a lookup by directive name. */
function directives(policy: string): Record<string, string[]> {
  const entries = policy.split(';').map((part) => part.trim().split(/\s+/));
  return Object.fromEntries(entries.map(([name, ...values]) => [name as string, values])) as Record<
    string,
    string[]
  >;
}

describe('content security policy', () => {
  const policy = directives(contentSecurityPolicy('http://127.0.0.1:8080'));

  it('keeps everything to the own origin by default', () => {
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['connect-src']).toEqual(["'self'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
  });

  it('allows the WebAssembly decoder without allowing eval', () => {
    expect(policy['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(policy['script-src']).not.toContain("'unsafe-eval'");
  });

  it('allows the object URL of a photo preview and the camera stream', () => {
    expect(policy['img-src']).toContain('blob:');
    expect(policy['media-src']).toContain('blob:');
  });

  it('allows no inline script and no inline style', () => {
    expect(contentSecurityPolicy('http://127.0.0.1:8080')).not.toContain("'unsafe-inline'");
    expect(policy['style-src']).toEqual(["'self'"]);
  });

  it('upgrades requests only where TLS can answer them', () => {
    expect(contentSecurityPolicy('https://produkte.example.org')).toContain(
      'upgrade-insecure-requests',
    );
    expect(contentSecurityPolicy('http://127.0.0.1:8080')).not.toContain(
      'upgrade-insecure-requests',
    );
  });
});

describe('the remaining headers', () => {
  const headers = securityHeaders(parseConfig({}));

  it('keeps the camera and drops the rest', () => {
    expect(headers['permissions-policy']).toContain('camera=(self)');
    expect(headers['permissions-policy']).toContain('geolocation=()');
    expect(headers['permissions-policy']).toContain('microphone=()');
  });

  it('leaves HSTS to whoever terminates TLS', () => {
    expect(headers['strict-transport-security']).toBeUndefined();
  });

  it('states the ban on embedding twice, for old browsers too', () => {
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('keeps the same-origin referrer the CSRF check can fall back to', () => {
    expect(headers['referrer-policy']).toBe('same-origin');
  });
});

/** The smallest directory that looks like the output of `npm run build`. */
function createBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'product-rating-headers-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app shell</title>');
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log("bundle");');
  return root;
}

describe('every answer carries them', () => {
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

  it('on the app shell', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('on a file of the bundle', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('on an API answer', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('on the liveness probe', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('keeps API answers out of the browser cache', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('leaves the app shell and the bundle cacheable', async () => {
    const shell = await app.inject({ method: 'GET', url: '/' });
    const bundle = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(shell.headers['cache-control']).toBe('no-cache');
    expect(bundle.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('on a rejected writing request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'anna', password: 'irrelevant' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
