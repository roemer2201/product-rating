import { ConfigError } from './errors.js';
import {
  CONFIG_SECTIONS,
  getKeySchema,
  isConfigSection,
  keysOfSection,
  type ConfigSection,
} from './schema.js';
import { coerceStringValue, setRawValue, type RawConfig } from './values.js';

/** Convenience flags that map onto a single configuration key. */
const FLAG_TARGETS: Record<string, readonly [ConfigSection, string]> = {
  '--host': ['server', 'host'],
  '--port': ['server', 'port'],
  '--base-url': ['server', 'base_url'],
  '--database': ['paths', 'database'],
  '--uploads': ['paths', 'uploads'],
  '--temp': ['paths', 'temp'],
  '--log-level': ['log', 'level'],
  '--log-format': ['log', 'format'],
  '--log-destination': ['log', 'destination'],
};

export interface CliOverrides {
  /** Path from `--config`, if given. */
  configPath?: string | undefined;
  overrides: RawConfig;
}

/** Splits `--flag=value` into its parts, or reads the following argument. */
function readValue(args: string[], index: number, flag: string): { value: string; next: number } {
  const current = args[index] ?? '';
  const assignment = current.indexOf('=');

  if (assignment >= 0) {
    return { value: current.slice(assignment + 1), next: index + 1 };
  }

  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ConfigError(`Missing value for ${flag}`);
  }

  return { value, next: index + 2 };
}

function applyOverride(overrides: RawConfig, section: string, key: string, raw: string): void {
  if (!isConfigSection(section)) {
    throw new ConfigError(`Unknown configuration section: ${section}`, [
      `known sections: ${CONFIG_SECTIONS.join(', ')}`,
    ]);
  }

  const keySchema = getKeySchema(section, key);
  if (keySchema === undefined) {
    throw new ConfigError(`Unknown configuration key: ${section}.${key}`, [
      `known keys in [${section}]: ${keysOfSection(section).join(', ')}`,
    ]);
  }

  setRawValue(overrides, section, key, coerceStringValue(keySchema, raw));
}

/**
 * Reads configuration arguments from `argv`.
 *
 * Understood are `--config <path>`, the convenience flags above and the generic
 * `--set <section>.<key>=<value>`, each also in `--flag=value` form. Everything
 * else is ignored here and left to the command line interface added in M13.
 */
export function parseCliOverrides(argv: string[] = []): CliOverrides {
  const overrides: RawConfig = {};
  let configPath: string | undefined;

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? '';
    const flag = arg.split('=', 1)[0] ?? arg;

    if (flag === '--config') {
      const { value, next } = readValue(argv, index, flag);
      configPath = value;
      index = next;
      continue;
    }

    if (flag === '--set') {
      const { value, next } = readValue(argv, index, flag);
      const match = /^([a-z_]+)\.([a-z0-9_]+)=(.*)$/is.exec(value);
      if (match === null) {
        throw new ConfigError(`Invalid --set argument: ${value}`, [
          'expected --set <section>.<key>=<value>, for example --set paths.database=/srv/app.db',
        ]);
      }
      applyOverride(
        overrides,
        (match[1] ?? '').toLowerCase(),
        (match[2] ?? '').toLowerCase(),
        match[3] ?? '',
      );
      index = next;
      continue;
    }

    const target = Object.hasOwn(FLAG_TARGETS, flag) ? FLAG_TARGETS[flag] : undefined;
    if (target !== undefined) {
      const { value, next } = readValue(argv, index, flag);
      applyOverride(overrides, target[0], target[1], value);
      index = next;
      continue;
    }

    index += 1;
  }

  return { configPath, overrides };
}
