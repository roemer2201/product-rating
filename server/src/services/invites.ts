import { randomInt } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Invite } from '@product-rating/shared';
import type { DbHandle } from '../db/index.js';
import { invites, type InviteRow } from '../db/index.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { AppConfig } from '../config/index.js';

/**
 * Invite codes.
 *
 * There is no open registration: an account only comes into existence with a
 * code an administrator handed out. Codes are stored in clear text on purpose,
 * because an admin has to be able to read one again in order to pass it on.
 * They are short lived (`auth.invite_ttl_days`) and single use, which keeps
 * that acceptable.
 */

/** Characters without the pairs that get misread when typed off a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUPS = 3;
const CODE_GROUP_LENGTH = 4;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Builds a code such as `A1B2-C3D4-E5F6`. */
export function generateInviteCode(): string {
  const groups: string[] = [];

  for (let group = 0; group < CODE_GROUPS; group += 1) {
    let value = '';
    for (let index = 0; index < CODE_GROUP_LENGTH; index += 1) {
      value += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    groups.push(value);
  }

  return groups.join('-');
}

function statusOf(row: InviteRow, now: Date): Invite['status'] {
  if (row.usedAt !== null) return 'used';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'open';
}

export function toPublicInvite(row: InviteRow, now: Date = new Date()): Invite {
  return {
    code: row.code,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    usedBy: row.usedBy,
    usedAt: row.usedAt?.toISOString() ?? null,
    status: statusOf(row, now),
  };
}

export interface CreateInviteOptions {
  createdBy: string;
  note?: string | null;
  /** Overrides `auth.invite_ttl_days` for this code. */
  ttlDays?: number;
}

export function createInvite(
  db: DbHandle,
  config: AppConfig,
  options: CreateInviteOptions,
  now: Date = new Date(),
): Invite {
  const ttlDays = options.ttlDays ?? config.auth.invite_ttl_days;

  // A collision is unlikely (32^12), but retrying is cheaper than explaining
  // a UNIQUE violation to an administrator.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row: InviteRow = {
      code: generateInviteCode(),
      createdBy: options.createdBy,
      note: options.note ?? null,
      expiresAt: new Date(now.getTime() + ttlDays * MILLISECONDS_PER_DAY),
      usedBy: null,
      usedAt: null,
      createdAt: now,
    };

    try {
      db.insert(invites).values(row).run();
      return toPublicInvite(row, now);
    } catch (error) {
      if (!String(error).includes('UNIQUE')) throw error;
    }
  }

  throw new Error('could not generate a unique invite code');
}

export function listInvites(db: DbHandle, now: Date = new Date()): Invite[] {
  return db
    .select()
    .from(invites)
    .orderBy(desc(invites.createdAt))
    .all()
    .map((row) => toPublicInvite(row, now));
}

/** Removes a code. Used codes stay as a record of who joined with what. */
export function revokeInvite(db: DbHandle, code: string): void {
  const normalised = code.trim().toUpperCase();
  const existing = db.select().from(invites).where(eq(invites.code, normalised)).get();

  if (existing === undefined) throw new NotFoundError('invite code not found');
  if (existing.usedAt !== null) {
    throw new ValidationError('a used invite code cannot be revoked');
  }

  db.delete(invites).where(eq(invites.code, normalised)).run();
}

/**
 * Marks a code as used by a new account.
 *
 * The update is conditional on the code still being unused, so two parallel
 * registrations cannot both consume the same code: the second one changes no
 * row and is rejected.
 */
export function consumeInvite(
  db: DbHandle,
  code: string,
  userId: string,
  now: Date = new Date(),
): void {
  const normalised = code.trim().toUpperCase();
  const existing = db.select().from(invites).where(eq(invites.code, normalised)).get();

  if (existing === undefined || existing.usedAt !== null) {
    throw new ValidationError('invite code is not valid', { field: 'invite' });
  }
  if (existing.expiresAt.getTime() <= now.getTime()) {
    throw new ValidationError('invite code has expired', { field: 'invite' });
  }

  const result = db
    .update(invites)
    .set({ usedBy: userId, usedAt: now })
    .where(and(eq(invites.code, normalised), isNull(invites.usedAt)))
    .run();

  if (result.changes === 0) {
    throw new ValidationError('invite code is not valid', { field: 'invite' });
  }
}

/** Reads a code without consuming it, e.g. to show its state before signup. */
export function findInvite(db: DbHandle, code: string): InviteRow | undefined {
  return db.select().from(invites).where(eq(invites.code, code.trim().toUpperCase())).get();
}
