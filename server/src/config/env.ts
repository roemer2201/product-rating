import { ConfigError } from './errors.js';
import { CONFIG_SECTIONS, getKeySchema, isConfigSection, keysOfSection } from './schema.js';
import { coerceStringValue, setRawValue, type RawConfig } from './values.js';

/** Prefix of every configuration override, for example `PR_PATHS__DATABASE`. */
export const ENV_PREFIX = 'PR_';
/** Separator between section and key inside an override name. */
export const ENV_SEPARATOR = '__';

/**
 * Collects `PR_<SECTION>__<KEY>` variables into a raw configuration.
 *
 * Names are case insensitive; values are converted to the type the key expects.
 * A variable that carries the prefix but names no existing key aborts the
 * start-up: the namespace belongs to this application, so a typo there is a
 * mistake rather than an unrelated variable.
 */
export function collectEnvOverrides(env: NodeJS.ProcessEnv = process.env): RawConfig {
  const overrides: RawConfig = {};

  for (const [rawName, value] of Object.entries(env)) {
    const name = rawName.toUpperCase();
    if (value === undefined || !name.startsWith(ENV_PREFIX)) continue;

    const path = name.slice(ENV_PREFIX.length);
    const separatorIndex = path.indexOf(ENV_SEPARATOR);
    if (separatorIndex <= 0) {
      throw new ConfigError(`Unknown configuration override: ${name}`, [
        `expected ${ENV_PREFIX}<SECTION>${ENV_SEPARATOR}<KEY>, for example ${ENV_PREFIX}PATHS${ENV_SEPARATOR}DATABASE`,
      ]);
    }

    const section = path.slice(0, separatorIndex).toLowerCase();
    const key = path.slice(separatorIndex + ENV_SEPARATOR.length).toLowerCase();

    if (!isConfigSection(section)) {
      throw new ConfigError(`Unknown configuration section in ${name}: ${section}`, [
        `known sections: ${CONFIG_SECTIONS.join(', ')}`,
      ]);
    }

    const keySchema = getKeySchema(section, key);
    if (keySchema === undefined) {
      throw new ConfigError(`Unknown configuration key in ${name}: ${section}.${key}`, [
        `known keys in [${section}]: ${keysOfSection(section).join(', ')}`,
      ]);
    }

    setRawValue(overrides, section, key, coerceStringValue(keySchema, value));
  }

  return overrides;
}
