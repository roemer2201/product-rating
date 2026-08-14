import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { SessionInfo } from '@product-rating/shared';
import type { DbHandle } from '../db/index.js';
import { sessions, type SessionRow } from '../db/index.js';
import type { AppConfig } from '../config/index.js';

/**
 * Server side sessions.
 *
 * The cookie carries 32 random bytes; the database only stores their SHA-256
 * digest. A leaked database therefore yields no usable cookie, while revoking
 * a session stays a single `DELETE`. There is no JWT: sessions have to be
 * revocable immediately, which a self contained token cannot offer.
 */

/** Length of the random part of a session token, in bytes. */
export const SESSION_TOKEN_BYTES = 32;

/** Name of the session cookie. */
export const SESSION_COOKIE = 'pr_session';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CreatedSession {
  /** Value for the cookie; only ever seen here and by the client. */
  token: string;
  row: SessionRow;
}

/** Digest stored in the database instead of the token itself. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Creates a session for a user and returns the cookie value. */
export function createSession(
  db: DbHandle,
  config: AppConfig,
  userId: string,
  userAgent: string | null,
  now: Date = new Date(),
): CreatedSession {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const row: SessionRow = {
    id: hashToken(token),
    userId,
    expiresAt: new Date(now.getTime() + config.auth.session_ttl_days * MILLISECONDS_PER_DAY),
    // Long user agent strings are pointless in a session list.
    userAgent: userAgent === null ? null : userAgent.slice(0, 255),
    createdAt: now,
    lastSeenAt: now,
  };

  db.insert(sessions).values(row).run();
  return { token, row };
}

/** Looks up a session by cookie value; expired rows count as absent. */
export function findSessionByToken(
  db: DbHandle,
  token: string,
  now: Date = new Date(),
): SessionRow | undefined {
  const row = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, hashToken(token)))
    .get();
  if (row === undefined) return undefined;
  if (row.expiresAt.getTime() <= now.getTime()) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return undefined;
  }
  return row;
}

/**
 * Marks a session as used and extends it once less than
 * `session_renew_threshold_days` are left.
 *
 * Rolling renewal is what keeps the home screen PWA logged in: someone using
 * the app regularly is never asked for the password again, while an abandoned
 * session still expires after `session_ttl_days`. `lastSeenAt` is only written
 * once a minute, so ordinary requests do not turn into database writes.
 */
export function touchSession(
  db: DbHandle,
  config: AppConfig,
  row: SessionRow,
  now: Date = new Date(),
): SessionRow {
  const threshold = config.auth.session_renew_threshold_days * MILLISECONDS_PER_DAY;
  const remaining = row.expiresAt.getTime() - now.getTime();
  const renews = remaining < threshold;

  const seenAgeMs = now.getTime() - row.lastSeenAt.getTime();
  if (!renews && seenAgeMs < 60_000) return row;

  const next: SessionRow = {
    ...row,
    lastSeenAt: now,
    expiresAt: renews
      ? new Date(now.getTime() + config.auth.session_ttl_days * MILLISECONDS_PER_DAY)
      : row.expiresAt,
  };

  db.update(sessions)
    .set({ lastSeenAt: next.lastSeenAt, expiresAt: next.expiresAt })
    .where(eq(sessions.id, row.id))
    .run();

  return next;
}

/** True when `touchSession()` would push the expiry out. */
export function willRenew(config: AppConfig, row: SessionRow, now: Date = new Date()): boolean {
  const threshold = config.auth.session_renew_threshold_days * MILLISECONDS_PER_DAY;
  return row.expiresAt.getTime() - now.getTime() < threshold;
}

export function listSessions(
  db: DbHandle,
  userId: string,
  currentSessionId: string | null,
): SessionInfo[] {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .all()
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: row.id === currentSessionId,
    }));
}

/** Revokes one session of a user. Returns false if it was not theirs. */
export function revokeSession(db: DbHandle, userId: string, sessionId: string): boolean {
  const result = db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .run();
  return result.changes > 0;
}

/** Revokes every session of a user, optionally sparing the current one. */
export function revokeAllSessions(db: DbHandle, userId: string, exceptSessionId?: string): number {
  const rows = db.select().from(sessions).where(eq(sessions.userId, userId)).all();
  let removed = 0;

  for (const row of rows) {
    if (row.id === exceptSessionId) continue;
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
    removed += 1;
  }

  return removed;
}

/** Deletes every session whose lifetime has run out. */
export function deleteExpiredSessions(db: DbHandle, now: Date = new Date()): number {
  return db.delete(sessions).where(lt(sessions.expiresAt, now)).run().changes;
}

/**
 * Compares two session identifiers without leaking their difference through
 * timing. Used where a caller supplied identifier meets a stored one.
 */
export function sameSessionId(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
