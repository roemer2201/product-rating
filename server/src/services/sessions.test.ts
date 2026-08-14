import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../config/index.js';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../db/testing.js';
import {
  createSession,
  deleteExpiredSessions,
  findSessionByToken,
  hashToken,
  listSessions,
  revokeAllSessions,
  revokeSession,
  SESSION_TOKEN_BYTES,
  touchSession,
} from './sessions.js';

const config = parseConfig({ auth: { session_ttl_days: 90, session_renew_threshold_days: 7 } });
const DAY = 24 * 60 * 60 * 1000;

let database: TestDatabase;
let userId: string;

beforeEach(() => {
  database = createTestDatabase();
  const seeded = seedDatabase(database.db, { users: [{ username: 'anna' }] });
  userId = seeded.users?.[0]?.id as string;
});

afterEach(() => {
  database.close();
});

describe('createSession', () => {
  it('stores only the digest of the token', () => {
    const { token, row } = createSession(database.db, config, userId, 'iPhone');

    // 32 random bytes as base64url.
    expect(Buffer.from(token, 'base64url')).toHaveLength(SESSION_TOKEN_BYTES);
    expect(row.id).toBe(hashToken(token));
    expect(row.id).not.toContain(token);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * DAY);
  });

  it('shortens an absurdly long user agent', () => {
    const { row } = createSession(database.db, config, userId, 'x'.repeat(1000));
    expect(row.userAgent).toHaveLength(255);
  });
});

describe('findSessionByToken', () => {
  it('finds a live session and forgets an expired one', () => {
    const { token, row } = createSession(database.db, config, userId, null);

    expect(findSessionByToken(database.db, token)?.id).toBe(row.id);
    expect(findSessionByToken(database.db, 'some-other-token')).toBeUndefined();

    const afterExpiry = new Date(row.expiresAt.getTime() + 1000);
    expect(findSessionByToken(database.db, token, afterExpiry)).toBeUndefined();
    // The lookup cleans up behind itself.
    expect(findSessionByToken(database.db, token)).toBeUndefined();
  });
});

describe('touchSession', () => {
  it('extends the lifetime once the renewal threshold is reached', () => {
    const created = new Date(Date.now() - 85 * DAY);
    const { row } = createSession(database.db, config, userId, null, created);

    // 5 days left, below the 7 day threshold.
    const now = new Date(created.getTime() + 85 * DAY);
    const renewed = touchSession(database.db, config, row, now);

    expect(renewed.expiresAt.getTime()).toBe(now.getTime() + 90 * DAY);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(row.expiresAt.getTime());
  });

  it('leaves the lifetime alone while there is plenty left', () => {
    const { row } = createSession(database.db, config, userId, null);
    const now = new Date(row.createdAt.getTime() + 2 * DAY);

    const touched = touchSession(database.db, config, row, now);

    expect(touched.expiresAt.getTime()).toBe(row.expiresAt.getTime());
    expect(touched.lastSeenAt.getTime()).toBe(now.getTime());
  });

  it('does not write on every request within the same minute', () => {
    const { row } = createSession(database.db, config, userId, null);
    const soon = new Date(row.lastSeenAt.getTime() + 5_000);

    const touched = touchSession(database.db, config, row, soon);

    expect(touched.lastSeenAt.getTime()).toBe(row.lastSeenAt.getTime());
  });
});

describe('revoking and listing', () => {
  it('lists the sessions of an account newest first and marks the current one', () => {
    const first = createSession(database.db, config, userId, 'Safari');
    const second = createSession(
      database.db,
      config,
      userId,
      'Firefox',
      new Date(Date.now() + 1000),
    );

    const listed = listSessions(database.db, userId, second.row.id);

    expect(listed).toHaveLength(2);
    expect(listed[0]?.id).toBe(second.row.id);
    expect(listed[0]?.current).toBe(true);
    expect(listed[1]?.id).toBe(first.row.id);
    expect(listed[1]?.current).toBe(false);
  });

  it('refuses to revoke a session of a different account', () => {
    const other = seedDatabase(database.db, { users: [{ username: 'bert' }] });
    const otherId = other.users?.[0]?.id as string;
    const { row } = createSession(database.db, config, userId, null);

    expect(revokeSession(database.db, otherId, row.id)).toBe(false);
    expect(revokeSession(database.db, userId, row.id)).toBe(true);
  });

  it('revokes every session but the current one', () => {
    const keep = createSession(database.db, config, userId, null);
    createSession(database.db, config, userId, null);
    createSession(database.db, config, userId, null);

    expect(revokeAllSessions(database.db, userId, keep.row.id)).toBe(2);
    expect(listSessions(database.db, userId, null)).toHaveLength(1);
  });
});

describe('deleteExpiredSessions', () => {
  it('removes only sessions whose lifetime has run out', () => {
    const stale = new Date(Date.now() - 200 * DAY);
    createSession(database.db, config, userId, null, stale);
    createSession(database.db, config, userId, null);

    expect(deleteExpiredSessions(database.db)).toBe(1);
    expect(listSessions(database.db, userId, null)).toHaveLength(1);
  });
});
