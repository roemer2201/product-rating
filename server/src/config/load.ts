import { dirname, isAbsolute, resolve } from 'node:path';
import { parseCliOverrides } from './cli.js';
import { collectEnvOverrides } from './env.js';
import { ConfigError, formatZodIssues } from './errors.js';
import { findConfigFile, readConfigFile, type ConfigFileSource } from './file.js';
import { configSchema, type AppConfig } from './schema.js';
import { mergeRawConfigs, type RawConfig } from './values.js';

export interface LoadConfigOptions {
  /** Command line arguments without `node` and the script path. */
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface LoadedConfig {
  config: AppConfig;
  /** Absolute path of the file that was read, `null` if none was found. */
  configFile: string | null;
  configFileSource: ConfigFileSource | null;
  /** Directory relative paths were resolved against. */
  baseDir: string;
}

/**
 * Turns every relative path into an absolute one.
 *
 * The base is the directory of the configuration file, so a file may describe
 * its data directories relative to itself. Without a configuration file the
 * working directory is used.
 */
function resolveConfigPaths(config: AppConfig, baseDir: string): AppConfig {
  const absolute = (path: string): string => (isAbsolute(path) ? path : resolve(baseDir, path));

  return {
    ...config,
    server: {
      ...config.server,
      static_dir: config.server.static_dir === '' ? '' : absolute(config.server.static_dir),
    },
    paths: {
      database: absolute(config.paths.database),
      uploads: absolute(config.paths.uploads),
      temp: absolute(config.paths.temp),
    },
    auth: { ...config.auth, secret_file: absolute(config.auth.secret_file) },
    log: { ...config.log, file: absolute(config.log.file) },
  };
}

/**
 * Validates a merged raw configuration and resolves its paths. Exported for
 * tests and for tools that assemble the sources themselves.
 */
export function parseConfig(raw: RawConfig, baseDir: string = process.cwd()): AppConfig {
  const result = configSchema.safeParse(raw);

  if (!result.success) {
    throw new ConfigError('Invalid configuration', formatZodIssues(result.error));
  }

  return resolveConfigPaths(result.data, baseDir);
}

/**
 * Loads the configuration from all sources.
 *
 * Precedence, ascending: defaults from the schema, the TOML file,
 * `PR_<SECTION>__<KEY>` environment variables, command line arguments.
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const { argv = [], env = process.env, cwd = process.cwd() } = options;

  const cli = parseCliOverrides(argv);
  const candidate = findConfigFile({ explicitPath: cli.configPath, env, cwd });
  const fromFile = candidate === null ? {} : readConfigFile(candidate.path);
  const fromEnv = collectEnvOverrides(env);

  const baseDir = candidate === null ? cwd : dirname(candidate.path);
  const merged = mergeRawConfigs(fromFile, fromEnv, cli.overrides);

  try {
    return {
      config: parseConfig(merged, baseDir),
      configFile: candidate?.path ?? null,
      configFileSource: candidate?.source ?? null,
      baseDir,
    };
  } catch (error) {
    if (error instanceof ConfigError && candidate !== null) {
      throw new ConfigError(`${error.message} (${candidate.path})`, error.details);
    }
    throw error;
  }
}
