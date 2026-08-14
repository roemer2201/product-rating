/**
 * Standalone migration entry point: `npm run migrate`.
 *
 * Used by the Debian `postinst`, the container entrypoint and during
 * development, so the schema can be brought up to date without starting the
 * server. The proper `product-rating migrate` subcommand wraps this in M13.
 */

import {
  ConfigError,
  ensureRuntimeDirectories,
  loadConfig,
  type LoadedConfig,
} from './config/index.js';
import { openDatabase, runMigrations } from './db/index.js';

let loaded: LoadedConfig;
try {
  loaded = loadConfig({ argv: process.argv.slice(2) });
  ensureRuntimeDirectories(loaded.config);
} catch (error) {
  console.error(error instanceof ConfigError ? error.format() : error);
  process.exit(1);
}

const { config } = loaded;
const database = openDatabase({ path: config.paths.database });

try {
  const result = runMigrations({
    db: database.db,
    sqlite: database.sqlite,
    databasePath: config.paths.database,
    onInfo: (message, details) => {
      console.warn(details === undefined ? message : `${message} ${JSON.stringify(details)}`);
    },
  });

  console.warn(
    result.applied === 0
      ? 'nothing to do'
      : `applied ${result.applied} migration(s)${result.snapshot === null ? '' : `, snapshot: ${result.snapshot}`}`,
  );
} catch (error) {
  console.error('migration failed:', error);
  database.close();
  process.exit(1);
}

database.close();
