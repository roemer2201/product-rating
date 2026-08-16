import {
  ConfigError,
  ensureRuntimeDirectories,
  loadConfig,
  type AppConfig,
  type LoadedConfig,
} from '../config/index.js';
import { openDatabase, pendingMigrations, type AppDatabase } from '../db/index.js';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * The pieces every command needs before it can do anything: the configuration
 * and, for most of them, an open database.
 */

/** Loads the configuration the same way the server does. */
export function loadRuntimeConfig(configArgs: string[]): LoadedConfig {
  const loaded = loadConfig({ argv: configArgs });
  ensureRuntimeDirectories(loaded.config);
  return loaded;
}

export interface DatabaseSession {
  db: AppDatabase;
  sqlite: BetterSqlite3.Database;
}

export interface WithDatabaseOptions {
  /**
   * Refuse to work on a schema that is behind the shipped migrations. Reading
   * commands set this as well: a query against a missing column fails with a
   * message about SQL instead of the one sentence that helps.
   */
  requireSchema?: boolean;
}

/**
 * Opens the database, runs `work` and closes the handle afterwards, whether
 * that ends well or not — an open SQLite handle keeps a `-wal` file around.
 */
export async function withDatabase<T>(
  config: AppConfig,
  work: (session: DatabaseSession) => Promise<T> | T,
  options: WithDatabaseOptions = {},
): Promise<T> {
  const database = openDatabase({ path: config.paths.database });

  try {
    if (options.requireSchema !== false) {
      const pending = pendingMigrations(database.sqlite);
      if (pending > 0) {
        throw new ConfigError(
          `the database schema is ${String(pending)} migration(s) behind this version`,
          ['bring it up to date first: product-rating migrate'],
        );
      }
    }

    return await work({ db: database.db, sqlite: database.sqlite });
  } finally {
    database.close();
  }
}
