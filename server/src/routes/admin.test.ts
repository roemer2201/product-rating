import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../services/users.js';
import { createSession } from '../services/sessions.js';
import { sessions } from '../db/index.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/** Invite and user administration, including the role checks around them. */

const PASSWORD = 'a-long-enough-password';

let harness: TestApp;
let adminCookie: string;
let userCookie: string;
let userId: string;

async function makeUser(username: string, role: 'admin' | 'user'): Promise<string> {
  const user = await createUser(harness.app.db, harness.config, {
    username,
    password: PASSWORD,
    role,
  });
  return user.id;
}

async function loginAs(username: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: writeHeaders(),
    payload: { username, password: PASSWORD },
  });
  return sessionCookie(response);
}

beforeEach(async () => {
  harness = await createTestApp();
  await makeUser('chef', 'admin');
  userId = await makeUser('anna', 'user');
  adminCookie = await loginAs('chef');
  userCookie = await loginAs('anna');
});

afterEach(async () => {
  await harness.close();
});

describe('invite routes', () => {
  it('lets an administrator create, list and revoke a code', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/invites',
      headers: writeHeaders(adminCookie),
      payload: { note: 'for Berta' },
    });

    expect(created.statusCode).toBe(201);
    const invite = created.json().invite;
    expect(invite.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(invite.status).toBe('open');
    expect(invite.note).toBe('for Berta');

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/invites',
      headers: { cookie: adminCookie },
    });
    expect(listed.json().invites).toHaveLength(1);

    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/invites/${invite.code}`,
      headers: writeHeaders(adminCookie),
    });
    expect(revoked.statusCode).toBe(200);

    const empty = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/invites',
      headers: { cookie: adminCookie },
    });
    expect(empty.json().invites).toHaveLength(0);
  });

  it('keeps ordinary users out', async () => {
    for (const [method, url] of [
      ['POST', '/api/v1/invites'],
      ['GET', '/api/v1/invites'],
      ['DELETE', '/api/v1/invites/AAAA-BBBB-CCCC'],
    ] as const) {
      const response = await harness.app.inject({
        method,
        url,
        headers: method === 'GET' ? { cookie: userCookie } : writeHeaders(userCookie),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('forbidden');
    }
  });

  it('answers 401 without a session at all', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/invites' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses to revoke a code that has been used', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/invites',
      headers: writeHeaders(adminCookie),
    });
    const code = created.json().invite.code;

    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { username: 'berta', password: PASSWORD, invite: code },
    });

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/invites/${code}`,
      headers: writeHeaders(adminCookie),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('user administration', () => {
  it('lists accounts without ever exposing a password hash', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().users).toHaveLength(2);
    expect(JSON.stringify(response.json())).not.toContain('$argon2');
  });

  it('creates an account directly', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(adminCookie),
      payload: { username: 'berta', password: PASSWORD, role: 'admin' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.role).toBe('admin');
  });

  it('disables an account and throws its sessions out', async () => {
    createSession(harness.app.db, harness.config, userId, 'phone');

    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${userId}`,
      headers: writeHeaders(adminCookie),
      payload: { disabled: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.disabledAt).not.toBeNull();

    const remaining = harness.app.db.select().from(sessions).all();
    expect(remaining.some((row) => row.userId === userId)).toBe(false);

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: writeHeaders(),
      payload: { username: 'anna', password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);
  });

  it('changes a role', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${userId}`,
      headers: writeHeaders(adminCookie),
      payload: { role: 'admin' },
    });

    expect(response.json().user.role).toBe('admin');
  });

  it('refuses to change the own role or state', async () => {
    const me = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: adminCookie },
    });

    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${me.json().user.id}`,
      headers: writeHeaders(adminCookie),
      payload: { disabled: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('your own');
  });

  it('lets one of two administrators be demoted', async () => {
    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: writeHeaders(adminCookie),
      payload: { username: 'zweit', password: PASSWORD, role: 'admin' },
    });

    const demote = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${second.json().user.id}`,
      headers: writeHeaders(adminCookie),
      payload: { role: 'user' },
    });

    expect(demote.statusCode).toBe(200);
    expect(demote.json().user.role).toBe('user');
  });

  it('resets a password and revokes the sessions of that account', async () => {
    createSession(harness.app.db, harness.config, userId, 'phone');

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/users/${userId}/password`,
      headers: writeHeaders(adminCookie),
      payload: { newPassword: 'a-brand-new-password' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().revokedSessions).toBeGreaterThan(0);

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: writeHeaders(),
      payload: { username: 'anna', password: 'a-brand-new-password' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('keeps ordinary users out of every administration route', async () => {
    const cases = [
      { method: 'GET' as const, url: '/api/v1/users', payload: undefined },
      {
        method: 'POST' as const,
        url: '/api/v1/users',
        payload: { username: 'x', password: PASSWORD },
      },
      { method: 'PATCH' as const, url: `/api/v1/users/${userId}`, payload: { role: 'admin' } },
      {
        method: 'POST' as const,
        url: `/api/v1/users/${userId}/password`,
        payload: { newPassword: PASSWORD },
      },
    ];

    for (const testCase of cases) {
      const response = await harness.app.inject({
        method: testCase.method,
        url: testCase.url,
        headers: testCase.method === 'GET' ? { cookie: userCookie } : writeHeaders(userCookie),
        ...(testCase.payload === undefined ? {} : { payload: testCase.payload }),
      });

      expect(response.statusCode).toBe(403);
    }
  });
});
