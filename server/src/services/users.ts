import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { User, UserRole } from '@product-rating/shared';
import type { DbHandle } from '../db/index.js';
import { users, type UserRow } from '../db/index.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { argon2Parameters, hashPassword, LOCKED_PASSWORD_HASH } from './passwords.js';
import type { AppConfig } from '../config/index.js';

/**
 * Account management.
 *
 * Accounts are never deleted, only disabled: their ratings and photos stay
 * attributable and the shared catalogue keeps a valid `created_by`. Usernames
 * are stored lower case, which is also enforced by a CHECK constraint, so
 * "Anna" and "anna" can never both exist.
 */

export interface CreateUserOptions {
  username: string;
  password: string;
  email?: string | null;
  role?: UserRole;
}

/** Maps a database row to the shape the API hands out. Never the hash. */
export function toPublicUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    passwordResetRequired: row.passwordResetRequired,
    createdAt: row.createdAt.toISOString(),
    disabledAt: row.disabledAt?.toISOString() ?? null,
  };
}

/** Rejects passwords below `auth.min_password_length`. */
export function assertPasswordPolicy(password: string, config: AppConfig): void {
  const minimum = config.auth.min_password_length;
  if (password.length < minimum) {
    throw new ValidationError(`password must be at least ${minimum} characters long`, {
      field: 'password',
      minimum,
    });
  }
}

export function findUserById(db: DbHandle, id: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function findUserByUsername(db: DbHandle, username: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.username, username.trim().toLowerCase())).get();
}

/** Number of accounts, used to decide whether bootstrapping is needed. */
export function countUsers(db: DbHandle): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .get();
  return row?.count ?? 0;
}

/** Number of enabled administrators, used to keep at least one of them. */
export function countActiveAdmins(db: DbHandle): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(sql`${users.role} = 'admin' and ${users.disabledAt} is null`)
    .get();
  return row?.count ?? 0;
}

export function listUsers(db: DbHandle): User[] {
  return db.select().from(users).orderBy(asc(users.username)).all().map(toPublicUser);
}

export interface InsertUserOptions {
  username: string;
  passwordHash: string;
  email?: string | null;
  role?: UserRole;
  /** Marks the account as waiting for a password; see `insertLockedUser()`. */
  passwordResetRequired?: boolean;
  /** Keeps the original creation date when an account arrives by import. */
  createdAt?: Date;
  disabledAt?: Date | null;
}

/**
 * Writes an account whose password has already been hashed.
 *
 * Separate from `createUser()` because hashing is asynchronous while a SQLite
 * transaction is not: registration hashes first and then does all database
 * work — consuming the invite and inserting the account — in one transaction.
 */
export function insertUser(db: DbHandle, options: InsertUserOptions): User {
  const row: UserRow = {
    id: randomUUID(),
    username: options.username.trim().toLowerCase(),
    email: options.email ?? null,
    passwordHash: options.passwordHash,
    role: options.role ?? 'user',
    passwordResetRequired: options.passwordResetRequired ?? false,
    createdAt: options.createdAt ?? new Date(),
    disabledAt: options.disabledAt ?? null,
  };

  try {
    db.insert(users).values(row).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new ConflictError('username is already taken', { field: 'username' });
    }
    throw error;
  }

  return toPublicUser(row);
}

export interface InsertLockedUserOptions {
  username: string;
  email?: string | null;
  role?: UserRole;
  createdAt?: Date;
  disabledAt?: Date | null;
}

/**
 * Creates an account that has no password yet.
 *
 * This is what an import leaves behind: the name, the role and the e-mail
 * address are known, the password deliberately is not — an export that carried
 * hashes around would be a set of credentials. The account exists so that
 * ratings, photos and prices have an owner again; getting into it takes a reset
 * link from an administrator.
 */
export function insertLockedUser(db: DbHandle, options: InsertLockedUserOptions): User {
  return insertUser(db, {
    username: options.username,
    passwordHash: LOCKED_PASSWORD_HASH,
    email: options.email ?? null,
    role: options.role ?? 'user',
    passwordResetRequired: true,
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    ...(options.disabledAt === undefined ? {} : { disabledAt: options.disabledAt }),
  });
}

/** Creates an account with a fresh argon2id hash. */
export async function createUser(
  db: DbHandle,
  config: AppConfig,
  options: CreateUserOptions,
): Promise<User> {
  const username = options.username.trim().toLowerCase();
  assertPasswordPolicy(options.password, config);

  if (findUserByUsername(db, username) !== undefined) {
    throw new ConflictError('username is already taken', { field: 'username' });
  }

  return insertUser(db, {
    username,
    passwordHash: await hashPassword(options.password, argon2Parameters(config)),
    email: options.email ?? null,
    role: options.role ?? 'user',
  });
}

/** Replaces the password hash; callers decide about session invalidation. */
export async function setPassword(
  db: DbHandle,
  config: AppConfig,
  userId: string,
  password: string,
): Promise<void> {
  assertPasswordPolicy(password, config);

  const hashed = await hashPassword(password, argon2Parameters(config));
  // Setting a password is what ends the locked state — every way of doing it
  // goes through here, so no caller can forget to clear the flag.
  const result = db
    .update(users)
    .set({ passwordHash: hashed, passwordResetRequired: false })
    .where(eq(users.id, userId))
    .run();

  if (result.changes === 0) throw new NotFoundError('user not found');
}

/**
 * Stores a freshly computed hash after a successful login, used when the
 * configured argon2id parameters have been raised since the account was made.
 */
export function updatePasswordHash(db: DbHandle, userId: string, hashed: string): void {
  db.update(users).set({ passwordHash: hashed }).where(eq(users.id, userId)).run();
}

/**
 * Takes the password away from an account, so only a reset link gets back in.
 *
 * The counterpart of `setPassword()`: an administrator uses it when a device
 * was lost or a password may have leaked, and the import uses the same state
 * for accounts it creates.
 */
export function lockPassword(db: DbHandle, userId: string): void {
  const result = db
    .update(users)
    .set({ passwordHash: LOCKED_PASSWORD_HASH, passwordResetRequired: true })
    .where(eq(users.id, userId))
    .run();

  if (result.changes === 0) throw new NotFoundError('user not found');
}

export interface UpdateUserOptions {
  role?: UserRole | undefined;
  disabled?: boolean | undefined;
  email?: string | null | undefined;
}

/**
 * Changes role, enabled state or e-mail. The last enabled administrator can
 * neither be demoted nor disabled — otherwise nobody could manage the instance
 * any more.
 */
export function updateUser(db: DbHandle, userId: string, options: UpdateUserOptions): User {
  const existing = findUserById(db, userId);
  if (existing === undefined) throw new NotFoundError('user not found');

  const nextRole = options.role ?? existing.role;
  const nextDisabled =
    options.disabled === undefined ? existing.disabledAt !== null : options.disabled;

  const losesAdmin =
    existing.role === 'admin' &&
    existing.disabledAt === null &&
    (nextRole !== 'admin' || nextDisabled);
  if (losesAdmin && countActiveAdmins(db) <= 1) {
    throw new ValidationError('the last active administrator cannot be demoted or disabled');
  }

  const changes: Partial<UserRow> = { role: nextRole };
  if (options.disabled !== undefined) {
    changes.disabledAt = options.disabled ? (existing.disabledAt ?? new Date()) : null;
  }
  if (options.email !== undefined) {
    changes.email = options.email;
  }

  db.update(users).set(changes).where(eq(users.id, userId)).run();

  const updated = findUserById(db, userId);
  if (updated === undefined) throw new NotFoundError('user not found');
  return toPublicUser(updated);
}
