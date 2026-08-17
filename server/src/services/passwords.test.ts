import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config/index.js';
import {
  argon2Parameters,
  hashPassword,
  needsRehash,
  placeholderHash,
  verifyAgainstNobody,
  verifyPassword,
} from './passwords.js';

const cheap = { memoryCost: 8 * 1024, timeCost: 1, parallelism: 1 };

describe('hashPassword', () => {
  it('produces an argon2id hash carrying the configured parameters', async () => {
    const hashed = await hashPassword('correct horse battery', cheap);

    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(hashed).toContain('m=8192');
    expect(hashed).toContain('t=1');
    expect(hashed).not.toContain('correct horse battery');
  });

  it('salts, so the same password hashes differently every time', async () => {
    const first = await hashPassword('same password', cheap);
    const second = await hashPassword('same password', cheap);

    expect(first).not.toBe(second);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const hashed = await hashPassword('right', cheap);

    expect(await verifyPassword(hashed, 'right')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong')).toBe(false);
  });

  it('treats a damaged hash as a failed login instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });
});

describe('argon2Parameters', () => {
  it('converts the configured MiB into the KiB the library expects', () => {
    const config = parseConfig({ auth: { argon2_memory_mib: 32, argon2_time_cost: 4 } });

    expect(argon2Parameters(config)).toEqual({
      memoryCost: 32 * 1024,
      timeCost: 4,
      parallelism: 1,
    });
  });
});

describe('needsRehash', () => {
  it('flags hashes made with weaker parameters', async () => {
    const hashed = await hashPassword('secret', cheap);

    expect(needsRehash(hashed, cheap)).toBe(false);
    expect(needsRehash(hashed, { ...cheap, memoryCost: 64 * 1024 })).toBe(true);
    expect(needsRehash(hashed, { ...cheap, timeCost: 3 })).toBe(true);
  });

  it('flags anything that is not an argon2id hash', () => {
    expect(needsRehash('$2b$12$something', cheap)).toBe(true);
  });
});

describe('the login of an account that does not exist', () => {
  it('verifies against a real argon2id hash instead of returning early', async () => {
    const hashed = await placeholderHash(cheap);

    // Not a shortcut and not an empty string: it is a hash of the same shape
    // the accounts have, so verifying against it costs the same work.
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(hashed).toContain('m=8192');
  });

  it('is the same hash every time, so no login pays for building one', async () => {
    expect(await placeholderHash(cheap)).toBe(await placeholderHash(cheap));
  });

  it('never matches anything', async () => {
    expect(await verifyAgainstNobody('', cheap)).toBe(false);
    expect(await verifyAgainstNobody('a-long-enough-password', cheap)).toBe(false);
    expect(await verifyAgainstNobody(await placeholderHash(cheap), cheap)).toBe(false);
  });
});
