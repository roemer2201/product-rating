import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../config/index.js';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../db/testing.js';
import { bootstrapAdmin } from './bootstrap.js';
import { findUserByUsername, listUsers } from './users.js';
import { verifyPassword } from './passwords.js';

const config = parseConfig({ auth: { argon2_memory_mib: 8, argon2_time_cost: 1 } });

let database: TestDatabase;

beforeEach(() => {
  database = createTestDatabase();
});

afterEach(() => {
  database.close();
});

describe('bootstrapAdmin', () => {
  it('creates the first administrator from the environment', async () => {
    const result = await bootstrapAdmin(database.db, config, {
      env: {
        BOOTSTRAP_ADMIN_USER: 'Chef',
        BOOTSTRAP_ADMIN_PASSWORD: 'a-long-enough-password',
        BOOTSTRAP_ADMIN_EMAIL: 'chef@example.org',
      },
    });

    expect(result).toEqual({ created: true, username: 'chef', warning: null });

    const user = findUserByUsername(database.db, 'chef');
    expect(user?.role).toBe('admin');
    expect(user?.email).toBe('chef@example.org');
    expect(await verifyPassword(user?.passwordHash ?? '', 'a-long-enough-password')).toBe(true);
  });

  it('does nothing without the environment variables', async () => {
    const result = await bootstrapAdmin(database.db, config, { env: {} });

    expect(result.created).toBe(false);
    expect(result.warning).toBeNull();
    expect(listUsers(database.db)).toHaveLength(0);
  });

  it('never creates a second administrator on a populated instance', async () => {
    seedDatabase(database.db, { users: [{ username: 'anna' }] });

    const result = await bootstrapAdmin(database.db, config, {
      env: { BOOTSTRAP_ADMIN_USER: 'chef', BOOTSTRAP_ADMIN_PASSWORD: 'a-long-enough-password' },
    });

    expect(result.created).toBe(false);
    expect(result.warning).toContain('already has accounts');
    expect(listUsers(database.db)).toHaveLength(1);
  });

  it('refuses a password below the configured minimum', async () => {
    const result = await bootstrapAdmin(database.db, config, {
      env: { BOOTSTRAP_ADMIN_USER: 'chef', BOOTSTRAP_ADMIN_PASSWORD: 'short' },
    });

    expect(result.created).toBe(false);
    expect(result.warning).toContain('min_password_length');
    expect(listUsers(database.db)).toHaveLength(0);
  });

  it('complains when only one of the two variables is set', async () => {
    const result = await bootstrapAdmin(database.db, config, {
      env: { BOOTSTRAP_ADMIN_USER: 'chef' },
    });

    expect(result.warning).toContain('together');
  });

  it('rejects a username the application would never allow', async () => {
    const result = await bootstrapAdmin(database.db, config, {
      env: { BOOTSTRAP_ADMIN_USER: 'chef of the house', BOOTSTRAP_ADMIN_PASSWORD: 'long-enough-1' },
    });

    expect(result.created).toBe(false);
    expect(result.warning).toContain('not a valid username');
  });
});
