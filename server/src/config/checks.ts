import { accessSync, constants, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigError } from './errors.js';
import { APP_SHELL, type AppConfig } from './schema.js';

/** Shortest accepted session secret, in characters. */
export const MIN_SECRET_LENGTH = 32;

/** Keys accepted inside an env style `secret_file`. */
const SECRET_KEYS = ['PRODUCT_RATING_SECRET', 'SESSION_SECRET'];

interface DirectoryRequirement {
  label: string;
  path: string;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates a directory if needed and reports why it is unusable otherwise.
 * Returns an error message instead of throwing so that the caller can collect
 * every problem before aborting.
 */
function checkDirectory(requirement: DirectoryRequirement): string | null {
  const { label, path } = requirement;

  try {
    const stats = statSync(path);
    if (!stats.isDirectory()) return `${label}: ${path} exists but is not a directory`;
  } catch {
    try {
      mkdirSync(path, { recursive: true, mode: 0o750 });
    } catch (error) {
      return `${label}: directory ${path} cannot be created (${reason(error)})`;
    }
  }

  try {
    accessSync(path, constants.W_OK | constants.X_OK);
  } catch {
    return `${label}: directory ${path} is not writable by this process`;
  }

  return null;
}

/**
 * Checks an existing database file. A missing file is fine — the migration
 * runner creates it — but an unreadable one has to be reported early.
 */
function checkDatabaseFile(path: string): string | null {
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return `paths.database: ${path} cannot be inspected (${reason(error)})`;
  }

  if (!stats.isFile()) return `paths.database: ${path} exists but is not a file`;

  try {
    accessSync(path, constants.R_OK | constants.W_OK);
  } catch {
    return `paths.database: ${path} is not readable and writable by this process`;
  }

  return null;
}

/**
 * Checks the directory with the built web client. Unlike the data directories
 * it is never created: it comes from the build, so a wrong path is a mistake
 * in the configuration and not something to paper over with an empty
 * directory. An empty value means "API only" and is not a problem.
 */
function checkStaticDirectory(path: string): string | null {
  if (path === '') return null;

  try {
    if (!statSync(path).isDirectory()) {
      return `server.static_dir: ${path} exists but is not a directory`;
    }
  } catch (error) {
    return `server.static_dir: ${path} cannot be read (${reason(error)})`;
  }

  try {
    statSync(join(path, APP_SHELL));
  } catch {
    return `server.static_dir: ${path} does not contain ${APP_SHELL}; is the web client built?`;
  }

  return null;
}

/**
 * Makes sure database, uploads, temp and — when logging to a file — the log
 * directory exist and are writable. Missing directories are created; anything
 * that cannot be fixed aborts the start-up with the full list of problems.
 * The frontend directory is checked alongside them, so one start-up reports
 * every path problem at once.
 */
export function ensureRuntimeDirectories(config: AppConfig): void {
  const requirements: DirectoryRequirement[] = [
    { label: 'paths.database', path: dirname(config.paths.database) },
    { label: 'paths.uploads', path: config.paths.uploads },
    { label: 'paths.temp', path: config.paths.temp },
  ];

  if (config.log.destination === 'file') {
    requirements.push({ label: 'log.file', path: dirname(config.log.file) });
  }

  const problems = [
    ...requirements.map((requirement) => checkDirectory(requirement)),
    checkDatabaseFile(config.paths.database),
    checkStaticDirectory(config.server.static_dir),
  ].filter((problem): problem is string => problem !== null);

  if (problems.length > 0) {
    throw new ConfigError('Configured paths are not usable', problems);
  }
}

/** Extracts the secret from a plain or env style `secret_file`. */
function extractSecret(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null) continue;

    const key = (match[1] ?? '').toUpperCase();
    if (!SECRET_KEYS.includes(key)) continue;

    return (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2').trim();
  }

  return content.trim();
}

/**
 * Reads the session secret and enforces its handling rules: the file has to
 * exist, must not be readable by group or others, and has to carry enough
 * material. The secret never lives in the configuration file itself.
 */
export function readSessionSecret(config: AppConfig): string {
  const path = config.auth.secret_file;
  const hint = `create it with: install -m 600 /dev/null ${path} && openssl rand -hex 32 > ${path}`;

  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new ConfigError(`Session secret file is missing: ${path}`, [hint]);
  }

  if (!stats.isFile()) {
    throw new ConfigError(`Session secret file is not a regular file: ${path}`);
  }

  if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
    const mode = (stats.mode & 0o777).toString(8).padStart(3, '0');
    throw new ConfigError(`Session secret file has too open permissions: ${path}`, [
      `found 0${mode}, expected 0600`,
      `fix it with: chmod 600 ${path}`,
    ]);
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(`Session secret file cannot be read: ${path}`, [reason(error)]);
  }

  const secret = extractSecret(content);
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`Session secret is too short: ${path}`, [
      `found ${secret.length} characters, at least ${MIN_SECRET_LENGTH} are required`,
      hint,
    ]);
  }

  return secret;
}
