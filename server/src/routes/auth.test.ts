import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sessions, users } from '../db/index.js';
import { createInvite } from '../services/invites.js';
import { createUser } from '../services/users.js';
import { createSession, hashToken } from '../services/sessions.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/**
 * End-to-end tests of the authentication routes. Everything goes through
 * `app.inject()`, so cookie signing, the origin check and the authentication
 * hook are exercised the way a browser would.
 */

const PASSWORD = 'a-long-enough-password';

let harness: TestApp;

async function makeUser(username: string, role: 'admin' | 'user' = 'user'): Promise<string> {
  const user = await createUser(harness.app.db, harness.config, {
    username,
    password: PASSWORD,
    role,
  });
  return user.id;
}

async function login(username: string, password = PASSWORD) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: writeHeaders(),
    payload: { username, password },
  });
}

beforeEach(async () => {
  harness = await createTestApp();
});

afterEach(async () => {
  await harness.close();
});

describe('POST /api/v1/auth/login', () => {
  it('signs in and sets a signed, HttpOnly session cookie', async () => {
    await makeUser('anna');

    const response = await login('anna');

    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe('anna');
    expect(response.json().user).not.toHaveProperty('passwordHash');

    const raw = response.headers['set-cookie'] as string;
    expect(raw).toContain('pr_session=');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    // base_url is http:// in tests, so Secure would make the cookie unusable.
    expect(raw).not.toContain('Secure');
  });

  it('stores only the digest of the token, never the cookie value', async () => {
    await makeUser('anna');
    const response = await login('anna');

    const cookie = sessionCookie(response).replace('pr_session=', '');
    const rows = harness.app.db.select().from(sessions).all();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(cookie);
    // The cookie is signed, so the stored digest belongs to its plain part.
    expect(rows[0]?.id).toBe(hashToken(decodeURIComponent(cookie).split('.')[0] as string));
  });

  it('answers the same way for an unknown user and a wrong password', async () => {
    await makeUser('anna');

    const wrongPassword = await login('anna', 'definitely-wrong');
    const unknownUser = await login('nobody');

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownUser.json());
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a disabled account', async () => {
    const id = await makeUser('anna');
    harness.app.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, id)).run();

    const response = await login('anna');

    expect(response.statusCode).toBe(401);
  });

  it('rate limits repeated failures and lets a good login through again', async () => {
    await makeUser('anna');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login('anna', 'wrong')).statusCode).toBe(401);
    }

    const blocked = await login('anna', 'wrong');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();

    // Even the correct password is refused while the window is open.
    expect((await login('anna')).statusCode).toBe(429);

    harness.app.loginLimiter.reset('user:anna');
    harness.app.loginLimiter.reset('ip:127.0.0.1');
    expect((await login('anna')).statusCode).toBe(200);
  });

  it('re-hashes a password when the argon2id cost was raised', async () => {
    await makeUser('anna');
    const before = harness.app.db.select().from(users).all()[0]?.passwordHash;

    harness.config.auth.argon2_time_cost = 3;
    expect((await login('anna')).statusCode).toBe(200);

    const after = harness.app.db.select().from(users).all()[0]?.passwordHash;
    expect(after).not.toBe(before);
    expect(after).toContain('t=3');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('needs a session', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });

  it('reports the signed in account', async () => {
    await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.username).toBe('anna');
  });

  it('rejects a session that has expired in the meantime', async () => {
    await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));

    harness.app.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(401);
    // The stale row is cleaned up on the way.
    expect(harness.app.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('rejects a forged cookie', async () => {
    await makeUser('anna');

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: 'pr_session=made-up-value.made-up-signature' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('locks out an account that was disabled while signed in', async () => {
    const id = await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));

    harness.app.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, id)).run();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: writeHeaders(cookie),
    });

    expect(response.statusCode).toBe(200);
    expect(harness.app.db.select().from(sessions).all()).toHaveLength(0);

    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/register', () => {
  async function makeInvite(): Promise<string> {
    const adminId = await makeUser('chef', 'admin');
    return createInvite(harness.app.db, harness.config, { createdBy: adminId }).code;
  }

  it('creates an account with a valid code and signs it in', async () => {
    const code = await makeInvite();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { username: 'Berta', password: PASSWORD, invite: code },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.username).toBe('berta');
    expect(response.json().user.role).toBe('user');
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('rejects an unknown code', async () => {
    await makeInvite();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { username: 'berta', password: PASSWORD, invite: 'AAAA-BBBB-CCCC' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe('invite');
  });

  it('rejects a code that has already been used', async () => {
    const code = await makeInvite();

    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { username: 'berta', password: PASSWORD, invite: code },
    });
    expect(first.statusCode).toBe(201);

    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { username: 'clara', password: PASSWORD, invite: code },
    });

    expect(second.statusCode).toBe(400);
    expect(harness.app.db.select().from(users).all()).toHaveLength(2);
  });

  it('rejects an expired code', async () => {
    const adminId = await makeUser('chef', 'admin');
    const invite = createInvite(
      harness.app.db,
      harness.config,
      { createdBy: adminId, ttlDays: 1 },
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    );

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { username: 'berta', password: PASSWORD, invite: invite.code },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('expired');
    // No half finished account is left behind.
    expect(harness.app.db.select().from(users).all()).toHaveLength(1);
  });

  it('rejects a taken username and keeps the code unused', async () => {
    const code = await makeInvite();
    await makeUser('berta');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { username: 'berta', password: PASSWORD, invite: code },
    });

    expect(response.statusCode).toBe(409);

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/invites',
      headers: { cookie: sessionCookie(await login('chef')) },
    });
    expect(list.json().invites[0].status).toBe('open');
  });

  it('rejects a password below the configured minimum', async () => {
    const code = await makeInvite();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: writeHeaders(),
      payload: { username: 'berta', password: 'short', invite: code },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('at least 10');
  });
});

describe('own sessions', () => {
  it('lists them, marks the current one and revokes a single one', async () => {
    const id = await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));
    const other = createSession(harness.app.db, harness.config, id, 'other device');

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().sessions).toHaveLength(2);
    expect(listed.json().sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${other.row.id}`,
      headers: writeHeaders(cookie),
    });

    expect(revoked.statusCode).toBe(200);
    expect(harness.app.db.select().from(sessions).all()).toHaveLength(1);
  });

  it('refuses to revoke a session of another account', async () => {
    await makeUser('anna');
    const bertId = await makeUser('bert');
    const foreign = createSession(harness.app.db, harness.config, bertId, null);
    const cookie = sessionCookie(await login('anna'));

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${foreign.row.id}`,
      headers: writeHeaders(cookie),
    });

    expect(response.statusCode).toBe(403);
  });

  it('revokes every other session at once', async () => {
    const id = await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));
    createSession(harness.app.db, harness.config, id, 'phone');
    createSession(harness.app.db, harness.config, id, 'tablet');

    const response = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/sessions',
      headers: writeHeaders(cookie),
    });

    expect(response.json()).toEqual({ revoked: 2 });
    expect(harness.app.db.select().from(sessions).all()).toHaveLength(1);
  });
});

describe('POST /api/v1/auth/password', () => {
  it('changes the password and drops the other sessions', async () => {
    const id = await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));
    createSession(harness.app.db, harness.config, id, 'old phone');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: writeHeaders(cookie),
      payload: { currentPassword: PASSWORD, newPassword: 'an-even-better-password' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().revokedSessions).toBe(1);
    expect(harness.app.db.select().from(sessions).all()).toHaveLength(1);

    expect((await login('anna')).statusCode).toBe(401);
    expect((await login('anna', 'an-even-better-password')).statusCode).toBe(200);
  });

  it('needs the current password', async () => {
    await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: writeHeaders(cookie),
      payload: { currentPassword: 'not-the-one', newPassword: 'an-even-better-password' },
    });

    expect(response.statusCode).toBe(401);
    expect((await login('anna')).statusCode).toBe(200);
  });

  it('refuses a new password that is too short', async () => {
    await makeUser('anna');
    const cookie = sessionCookie(await login('anna'));

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: writeHeaders(cookie),
      payload: { currentPassword: PASSWORD, newPassword: 'short' },
    });

    expect(response.statusCode).toBe(400);
  });
});
