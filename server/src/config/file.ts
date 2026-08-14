import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseToml, TomlError } from 'smol-toml';
import { ConfigError } from './errors.js';
import type { RawConfig } from './values.js';

/** Environment variable pointing at a configuration file. */
export const CONFIG_PATH_ENV_VAR = 'PRODUCT_RATING_CONFIG';
/** Location used by the Debian package and the container image. */
export const SYSTEM_CONFIG_PATH = '/etc/product-rating/config.toml';
/** Location used during development, relative to the working directory. */
export const LOCAL_CONFIG_PATH = 'config/config.toml';
/** How many directory levels above the working directory are searched. */
export const LOCAL_CONFIG_MAX_LEVELS = 4;

/** Where a configuration file path came from, in ascending precedence. */
export type ConfigFileSource = 'cli' | 'env' | 'system' | 'local';

export interface ConfigFileCandidate {
  path: string;
  source: ConfigFileSource;
  /** A path named explicitly must exist; the fixed locations are optional. */
  required: boolean;
}

export interface ConfigFileLookupOptions {
  /** Path from `--config`, taking precedence over everything else. */
  explicitPath?: string | undefined;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** The search order `--config` → `$PRODUCT_RATING_CONFIG` → system → local. */
export function configFileCandidates(options: ConfigFileLookupOptions = {}): ConfigFileCandidate[] {
  const { explicitPath, env = process.env, cwd = process.cwd() } = options;
  const candidates: ConfigFileCandidate[] = [];
  const absolute = (path: string): string => (isAbsolute(path) ? path : resolve(cwd, path));

  if (explicitPath !== undefined && explicitPath.length > 0) {
    candidates.push({ path: absolute(explicitPath), source: 'cli', required: true });
  }

  const fromEnv = env[CONFIG_PATH_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    candidates.push({ path: absolute(fromEnv), source: 'env', required: true });
  }

  candidates.push({ path: SYSTEM_CONFIG_PATH, source: 'system', required: false });

  // `config/config.toml` is looked for in the working directory and above it.
  // npm runs a workspace script with the workspace as working directory, so
  // `npm run dev` from the repository root starts in `server/` while the file
  // lives one level up.
  let directory = resolve(cwd);
  for (let level = 0; level <= LOCAL_CONFIG_MAX_LEVELS; level += 1) {
    candidates.push({ path: join(directory, LOCAL_CONFIG_PATH), source: 'local', required: false });

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return candidates;
}

function isReadableFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Returns the first existing configuration file. A path given per `--config`
 * or `$PRODUCT_RATING_CONFIG` that does not exist is an error; the fixed
 * locations are simply skipped, so the application also starts on defaults and
 * environment variables alone.
 */
export function findConfigFile(options: ConfigFileLookupOptions = {}): ConfigFileCandidate | null {
  for (const candidate of configFileCandidates(options)) {
    if (isReadableFile(candidate.path)) return candidate;

    if (candidate.required) {
      const origin = candidate.source === 'cli' ? '--config' : `$${CONFIG_PATH_ENV_VAR}`;
      throw new ConfigError(`Configuration file from ${origin} not found: ${candidate.path}`);
    }
  }

  return null;
}

/** Reads and parses a TOML configuration file. */
export function readConfigFile(path: string): RawConfig {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Configuration file cannot be read: ${path}`, [reason]);
  }

  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (error) {
    const reason =
      error instanceof TomlError
        ? `line ${error.line}, column ${error.column}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ConfigError(`Configuration file is not valid TOML: ${path}`, [reason]);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`Configuration file does not contain sections: ${path}`);
  }

  return parsed as RawConfig;
}
