import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../config/index.js';
import { createTestDatabase, type TestDatabase } from '../db/testing.js';
import { ConflictError, ValidationError } from './errors.js';
import { verifyPassword } from './passwords.js';
import {
  countActiveAdmins,
  createUser,
  findUserByUsername,
  listUsers,
  setPassword,
  updateUser,
} from './users.js';

const config = parseConfig({ auth: { argon2_memory_mib: 8, argon2_time_cost: 1 } });
const PASSWORD = 'a-long-enough-password';

let database: TestDatabase;

beforeEach(() => {
  database = createTestDatabase();
});

afterEach(() => {
  database.close();
});

describe('createUser', () => {
  it('stores the username lower case and never the plain password', async () => {
    const user = await createUser(database.db, config, { username: 'Anna', password: PASSWORD });

    expect(user.username).toBe('anna');
    expect(JSON.stringify(user)).not.toContain(PASSWORD);

    const row = findUserByUsername(database.db, 'ANNA');
    expect(row?.id).toBe(user.id);
    expect(await verifyPassword(row?.passwordHash ?? '', PASSWORD)).toBe(true);
  });

  it('refuses a username that only differs in case', async () => {
    await createUser(database.db, config, { username: 'anna', password: PASSWORD });

    await expect(
      createUser(database.db, config, { username: 'Anna', password: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a password below the configured minimum', async () => {
    await expect(
      createUser(database.db, config, { username: 'anna', password: 'short' }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(listUsers(database.db)).toHaveLength(0);
  });
});

describe('updateUser', () => {
  it('disables and enables an account', async () => {
    const user = await createUser(database.db, config, { username: 'anna', password: PASSWORD });

    expect(updateUser(database.db, user.id, { disabled: true }).disabledAt).not.toBeNull();
    expect(updateUser(database.db, user.id, { disabled: false }).disabledAt).toBeNull();
  });

  it('keeps at least one active administrator', async () => {
    const admin = await createUser(database.db, config, {
      username: 'chef',
      password: PASSWORD,
      role: 'admin',
    });
    await createUser(database.db, config, { username: 'anna', password: PASSWORD });

    expect(countActiveAdmins(database.db)).toBe(1);
    expect(() => updateUser(database.db, admin.id, { role: 'user' })).toThrow(ValidationError);
    expect(() => updateUser(database.db, admin.id, { disabled: true })).toThrow(ValidationError);

    const second = await createUser(database.db, config, {
      username: 'zweit',
      password: PASSWORD,
      role: 'admin',
    });

    // With a second administrator in place the first one may step down.
    expect(updateUser(database.db, admin.id, { role: 'user' }).role).toBe('user');
    expect(countActiveAdmins(database.db)).toBe(1);
    expect(() => updateUser(database.db, second.id, { disabled: true })).toThrow(ValidationError);
  });
});

describe('setPassword', () => {
  it('replaces the hash and rejects a too short password', async () => {
    const user = await createUser(database.db, config, { username: 'anna', password: PASSWORD });
    const before = findUserByUsername(database.db, 'anna')?.passwordHash;

    await setPassword(database.db, config, user.id, 'another-good-password');

    const after = findUserByUsername(database.db, 'anna')?.passwordHash;
    expect(after).not.toBe(before);
    expect(await verifyPassword(after ?? '', 'another-good-password')).toBe(true);

    await expect(setPassword(database.db, config, user.id, 'nope')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
