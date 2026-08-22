import { createHash, randomBytes } from 'node:crypto';
import { eq, isNotNull, lt, or } from 'drizzle-orm';
import type { PasswordResetLink } from '@product-rating/shared';
import type { AppConfig } from '../config/index.js';
import type { DbHandle } from '../db/index.js';
import { passwordResets, type PasswordResetRow } from '../db/index.js';
import { NotFoundError, ValidationError } from './errors.js';
import { findUserById } from './users.js';

/**
 * Password reset links.
 *
 * An account can end up without a password anybody knows: it arrived through
 * an import, which deliberately carries no hashes, or somebody locked it. The
 * way back in is a link an administrator hands over — the same shape as an
 * invite, but for an account that already exists.
 *
 * The application sends no mail. It makes no outbound requests at all
 * (CLAUDE.md, decision 6), so "sending a link" means an administrator copies it
 * and passes it on the way they would pass an invite: a message, a note, a
 * conversation in the kitchen.
 *
 * Unlike an invite, the token is stored as a SHA-256 hash. An invite code only
 * allows creating a new account; a reset link takes over an existing one, so a
 * stolen database must not contain a usable one. The consequence is that the
 * link can be read exactly once, when it is created — after that it can only be
 * replaced.
 */

/** Bytes of randomness in a token; the same size the session tokens use. */
const TOKEN_BYTES = 32;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** The stored form of a token. Never store what the link carries. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The address the account owner opens; `base_url` decides the host. */
export function resetUrl(config: AppConfig, token: string): string {
  const base = config.server.base_url.replace(/\/+$/, '');
  return `${base}/reset?token=${encodeURIComponent(token)}`;
}

export interface CreateResetOptions {
  userId: string;
  /** The administrator issuing it, or `null` for the command line. */
  createdBy?: string | null;
  /** Overrides `auth.password_reset_ttl_hours` for this link. */
  ttlHours?: number;
}

/**
 * Issues a link for one account, invalidating any earlier one.
 *
 * Exactly one live link per account: two links in circulation are two things
 * that can be intercepted, and the second one is always issued because the
 * first went missing anyway.
 */
export function createPasswordReset(
  db: DbHandle,
  config: AppConfig,
  options: CreateResetOptions,
  now: Date = new Date(),
): PasswordResetLink {
  const user = findUserById(db, options.userId);
  if (user === undefined) throw new NotFoundError('user not found');

  const ttlHours = options.ttlHours ?? config.auth.password_reset_ttl_hours;
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  const row: PasswordResetRow = {
    id: hashToken(token),
    userId: user.id,
    createdBy: options.createdBy ?? null,
    expiresAt: new Date(now.getTime() + ttlHours * MILLISECONDS_PER_HOUR),
    usedAt: null,
    createdAt: now,
  };

  db.transaction((tx) => {
    tx.delete(passwordResets).where(eq(passwordResets.userId, user.id)).run();
    tx.insert(passwordResets).values(row).run();
  });

  return {
    username: user.username,
    // The only moment the token exists outside the browser of whoever gets it.
    token,
    url: resetUrl(config, token),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export interface ResolvedReset {
  row: PasswordResetRow;
  username: string;
}

/**
 * Looks a token up and answers with the account it belongs to.
 *
 * Everything that is wrong with a token — unknown, expired, already used, or
 * belonging to a disabled account — is the same answer, so the route cannot be
 * used to find out which links exist.
 */
export function resolvePasswordReset(
  db: DbHandle,
  token: string,
  now: Date = new Date(),
): ResolvedReset {
  const row = db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.id, hashToken(token)))
    .get();

  const user = row === undefined ? undefined : findUserById(db, row.userId);

  if (
    row === undefined ||
    row.usedAt !== null ||
    row.expiresAt.getTime() <= now.getTime() ||
    user === undefined ||
    user.disabledAt !== null
  ) {
    throw new ValidationError('this link is not valid any more', { field: 'token' });
  }

  return { row, username: user.username };
}

/** Marks a link as spent. Called in the same transaction as the new password. */
export function consumePasswordReset(db: DbHandle, id: string, now: Date = new Date()): void {
  db.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, id)).run();
}

/**
 * Drops links that are spent or expired.
 *
 * Runs on the same daily timer as the session cleanup: neither is urgent, both
 * are rows nobody will ever look at again.
 */
export function cleanupPasswordResets(db: DbHandle, now: Date = new Date()): number {
  return db
    .delete(passwordResets)
    .where(or(lt(passwordResets.expiresAt, now), isNotNull(passwordResets.usedAt)))
    .run().changes;
}
