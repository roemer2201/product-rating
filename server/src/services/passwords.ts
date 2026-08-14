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
