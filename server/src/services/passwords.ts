import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { AppConfig } from '../config/index.js';

/**
 * Password hashing.
 *
 * argon2id only — never a hand written scheme, never a plain hash function.
 * The cost parameters come from `[auth]`, so an operator can trade login
 * latency against resistance on the hardware they actually run on. Because the
 * parameters are encoded in every hash, raising them later keeps old hashes
 * verifiable; `needsRehash()` reports which ones should be upgraded on the next
 * successful login.
 */

export interface Argon2Parameters {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** Reads the argon2id parameters from the configuration. */
export function argon2Parameters(config: AppConfig): Argon2Parameters {
  return {
    // `@node-rs/argon2` counts memory in KiB, the configuration in MiB.
    memoryCost: config.auth.argon2_memory_mib * 1024,
    timeCost: config.auth.argon2_time_cost,
    parallelism: config.auth.argon2_parallelism,
  };
}

/**
 * Hashes a password; the result carries its own parameters and salt.
 *
 * The algorithm is not passed explicitly because `@node-rs/argon2` exports it
 * as an ambient const enum, which cannot be used under `verbatimModuleSyntax`.
 * Its default is argon2id, and a test asserts that every hash starts with
 * `$argon2id$` so a library change cannot slip past unnoticed.
 */
export async function hashPassword(
  password: string,
  parameters: Argon2Parameters,
): Promise<string> {
  return hash(password, parameters);
}

/**
 * The stored hash of an account nobody can log into.
 *
 * Borrowed from `/etc/shadow`, where a `!` in the password field has meant
 * "locked" for decades: it is not a hash, so no password can ever verify
 * against it, and it says at a glance that the account is waiting for a reset
 * rather than carrying a weak password somebody might guess.
 */
export const LOCKED_PASSWORD_HASH = '!';

/** True for an account that has no password anybody could know. */
export function isLockedHash(hashed: string): boolean {
  return hashed === LOCKED_PASSWORD_HASH;
}

/**
 * Checks a password against a stored hash. A malformed hash is treated as a
 * failed login rather than an exception, so a damaged row cannot take the
 * login route down.
 */
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/**
 * A hash of a password nobody knows, verified against when the account of a
 * login does not exist.
 *
 * Without it the route answers a login for an unknown name in under a
 * millisecond and one for a known name after a tenth of a second, which tells
 * anybody who can count who has an account here — exactly what the identical
 * error message is there to prevent. So an unknown name is made to cost the
 * same argon2id verification as a known one.
 *
 * The hash is built once and kept: it is derived from random bytes, it never
 * leaves this module, and no password is ever going to match it. Raising the
 * cost parameters while the process runs leaves it on the old ones, which
 * costs a fraction of the time — this is a curtain, not a lock.
 */
let placeholder: Promise<string> | null = null;

export function placeholderHash(parameters: Argon2Parameters): Promise<string> {
  placeholder ??= hashPassword(randomBytes(32).toString('hex'), parameters);
  return placeholder;
}

/**
 * Answers a login for an account that does not exist — always `false`, and
 * always after the same work a real verification would have cost.
 */
export async function verifyAgainstNobody(
  password: string,
  parameters: Argon2Parameters,
): Promise<boolean> {
  return verifyPassword(await placeholderHash(parameters), password);
}

/** Parsed `m`, `t` and `p` of an argon2 hash, if it looks like one. */
function parseHashParameters(hashed: string): Argon2Parameters | null {
  const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hashed);
  if (match === null) return null;

  return {
    memoryCost: Number(match[1]),
    timeCost: Number(match[2]),
    parallelism: Number(match[3]),
  };
}

/**
 * True when the stored hash uses weaker parameters than configured, or is not
 * an argon2id hash at all.
 */
export function needsRehash(hashed: string, parameters: Argon2Parameters): boolean {
  const current = parseHashParameters(hashed);
  if (current === null) return true;

  return (
    current.memoryCost < parameters.memoryCost ||
    current.timeCost < parameters.timeCost ||
    current.parallelism !== parameters.parallelism
  );
}
