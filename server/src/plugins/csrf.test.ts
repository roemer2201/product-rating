import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../services/users.js';
import { createTestApp, sessionCookie, TEST_ORIGIN, type TestApp } from '../testing/harness.js';
import { allowedOrigins, originOf } from './csrf.js';

/**
 * The origin check is the second lock next to `SameSite=Lax`: a writing
 * request carrying the session cookie has to come from this instance.
 */

const PASSWORD = 'a-long-enough-password';

let harness: TestApp;
let cookie: string;

async function signIn(): Promise<string> {
  await createUser(harness.app.db, harness.config, { username: 'anna', password: PASSWORD });
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: TEST_ORIGIN },
    payload: { username: 'anna', password: PASSWORD },
  });
  return sessionCookie(response);
}

beforeEach(async () => {
  harness = await createTestApp();
  cookie = await signIn();
});

afterEach(async () => {
  await harness.close();
});

describe('originOf', () => {
  it('reduces a URL to its origin and reports garbage', () => {
    expect(originOf('https://rating.example.org/app?x=1')).toBe('https://rating.example.org');
    expect(originOf('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(originOf('not a url')).toBeNull();
  });
});

describe('allowedOrigins', () => {
  it('always contains base_url and adds the trusted ones', () => {
    const origins = allowedOrigins('https://rating.example.org', ['http://localhost:5173']);

    expect([...origins]).toEqual(['https://rating.example.org', 'http://localhost:5173']);
  });
});

describe('origin check', () => {
  it('rejects a writing request from a foreign origin', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: 'https://evil.example.com', cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('origin');
  });

  it('rejects a cookie carrying request without any origin information', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it('accepts the configured base_url', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: TEST_ORIGIN, cookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it('falls back to the Referer when no Origin is sent', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { referer: `${TEST_ORIGIN}/settings`, cookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it('leaves reading requests alone', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { origin: 'https://evil.example.com', cookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it('lets a client without any cookie through, e.g. curl or the CLI', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'anna', password: 'wrong' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts an additionally configured origin', async () => {
    const other = await createTestApp({
      config: { server: { trusted_origins: ['http://localhost:5173'] } },
    });

    try {
      await createUser(other.app.db, other.config, { username: 'anna', password: PASSWORD });
      const response = await other.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://localhost:5173' },
        payload: { username: 'anna', password: PASSWORD },
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await other.close();
    }
  });
});
