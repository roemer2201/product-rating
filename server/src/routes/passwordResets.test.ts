import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PasswordResetLink, User } from '@product-rating/shared';
import { passwordResets } from '../db/index.js';
import { createSession, SESSION_COOKIE } from '../services/sessions.js';
import { createUser } from '../services/users.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/**
 * Password links: the way back into an account nobody has a password for.
 *
 * The case this exists for is an import — accounts arrive without hashes on
 * purpose — but it is the same mechanism after a lost phone. What is checked
 * here is the whole path: locked account cannot log in, administrator issues a
 * link, the link sets a password exactly once, and everything that was signed
 * in before is signed out.
 */

const PASSWORD = 'a-long-enough-password';
const NEW_PASSWORD = 'an-even-better-password';

let harness: TestApp;
let adminCookie: string;
let annaId: string;

async function loginAs(username: string, password = PASSWORD) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: writeHeaders(),
    payload: { username, password },
  });
}

/** Locks anna's account the way an administrator would. */
async function lockAnna(): Promise<void> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/v1/users/${annaId}/lock`,
    headers: writeHeaders(adminCookie),
    payload: {},
  });
  expect(response.statusCode).toBe(200);
}

async function issueLink(userId = annaId, cookie = adminCookie): Promise<PasswordResetLink> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/v1/users/${userId}/reset-link`,
    headers: writeHeaders(cookie),
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return response.json().link as PasswordResetLink;
}

function redeem(token: string, newPassword = NEW_PASSWORD) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/reset',
    headers: writeHeaders(),
    payload: { token, newPassword },
  });
}

beforeEach(async () => {
  harness = await createTestApp();

  const anna = await createUser(harness.app.db, harness.config, {
    username: 'anna',
    password: PASSWORD,
    role: 'user',
  });
  annaId = anna.id;

  await createUser(harness.app.db, harness.config, {
    username: 'chef',
    password: PASSWORD,
    role: 'admin',
  });
  adminCookie = sessionCookie(await loginAs('chef'));
});

afterEach(async () => {
  await harness.close();
});

describe('an account without a password', () => {
  it('cannot be logged into, and says why instead of "wrong password"', async () => {
    await lockAnna();

    const response = await loginAs('anna');

    expect(response.statusCode).toBe(401);
    // The one place the login route is specific: the alternative is somebody
    // typing their correct old password into "wrong password" forever.
    expect(response.json().error.details.reason).toBe('password_reset_required');
  });

  it('is marked as such in the list of accounts', async () => {
    await lockAnna();

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { cookie: adminCookie },
    });

    const anna = (response.json().users as User[]).find((user) => user.username === 'anna');
    expect(anna?.passwordResetRequired).toBe(true);
  });

  it('loses its sessions when the password is taken away', async () => {
    const { token } = createSession(harness.app.db, harness.config, annaId, null);
    const cookie = `${SESSION_COOKIE}=${harness.app.signCookie(token)}`;

    const before = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(before.statusCode).toBe(200);

    await lockAnna();

    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it('cannot be locked by an administrator against themselves', async () => {
    const me = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: adminCookie },
    });
    const adminId = (me.json().user as User).id;

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/users/${adminId}/lock`,
      headers: writeHeaders(adminCookie),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('a password link', () => {
  it('carries the account, an address and a deadline, and is shown once', async () => {
    const link = await issueLink();

    expect(link.username).toBe('anna');
    expect(link.url).toContain(`/reset?token=${encodeURIComponent(link.token)}`);
    expect(Date.parse(link.expiresAt)).toBeGreaterThan(Date.now());

    // Only the hash is stored, so nothing hands the token out a second time.
    const stored = harness.app.db.select().from(passwordResets).all();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(link.token);
  });

  it('says which account it belongs to before a password is typed', async () => {
    const link = await issueLink();

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/auth/reset/${link.token}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().username).toBe('anna');
  });

  it('sets the password, signs the account in and ends its other sessions', async () => {
    const { token: sessionToken } = createSession(harness.app.db, harness.config, annaId, null);
    const oldCookie = `${SESSION_COOKIE}=${harness.app.signCookie(sessionToken)}`;

    await lockAnna();
    const link = await issueLink();

    const response = await redeem(link.token);

    expect(response.statusCode).toBe(200);
    expect((response.json().user as User).username).toBe('anna');
    // Straight into the app: the answer carries a session of its own.
    expect(response.cookies.length).toBeGreaterThan(0);

    // The old password is gone, the new one works, the flag is cleared.
    expect((await loginAs('anna', PASSWORD)).statusCode).toBe(401);
    const fresh = await loginAs('anna', NEW_PASSWORD);
    expect(fresh.statusCode).toBe(200);
    expect((fresh.json().user as User).passwordResetRequired).toBe(false);

    const stale = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: oldCookie },
    });
    expect(stale.statusCode).toBe(401);
  });

  it('works exactly once', async () => {
    const link = await issueLink();

    expect((await redeem(link.token)).statusCode).toBe(200);

    const second = await redeem(link.token, 'yet-another-password');
    expect(second.statusCode).toBe(400);
    expect((await loginAs('anna', NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('replaces an earlier link instead of adding a second one', async () => {
    const first = await issueLink();
    const second = await issueLink();

    expect((await redeem(first.token)).statusCode).toBe(400);
    expect((await redeem(second.token)).statusCode).toBe(200);
  });

  it('refuses an unknown token and one that is too short to be one', async () => {
    expect((await redeem('x'.repeat(43))).statusCode).toBe(400);
    expect((await redeem('short')).statusCode).toBe(400);

    const unknown = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/auth/reset/${'y'.repeat(43)}`,
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('refuses a password below the configured minimum', async () => {
    const link = await issueLink();

    const response = await redeem(link.token, 'kurz');

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe('password');
    // The link is still good: a rejected password may not burn it.
    expect((await redeem(link.token)).statusCode).toBe(200);
  });

  it('stops working once the account is disabled', async () => {
    const link = await issueLink();

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${annaId}`,
      headers: writeHeaders(adminCookie),
      payload: { disabled: true },
    });

    expect((await redeem(link.token)).statusCode).toBe(400);
  });

  it('is refused to anyone but an administrator', async () => {
    const annaCookie = sessionCookie(await loginAs('anna'));

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/users/${annaId}/reset-link`,
      headers: writeHeaders(annaCookie),
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });
});
