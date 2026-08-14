import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

/** The Drizzle handle used by every service. */
export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

/** The handle a `db.transaction()` callback receives. */
export type TransactionHandle = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

/**
 * What services accept: either the connection or an open transaction. Keeping
 * both behind one type lets the same function run standalone and as part of a
 * larger unit of work.
 */
export type DbHandle = AppDatabase | TransactionHandle;

export interface OpenDatabaseOptions {
  /** File path of the SQLite database, or `:memory:` for tests. */
  path: string;
  /** Milliseconds a write waits for a competing writer before failing. */
  busyTimeoutMs?: number;
  /** Log every executed statement; only used by `log.level = "debug"`. */
  logger?: boolean;
}

export interface OpenedDatabase {
  db: AppDatabase;
  /** The underlying handle, needed for pragmas, backups and `close()`. */
  sqlite: Database.Database;
  close(): void;
}

/** Default time a blocked writer waits before giving up. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/** Name of the case folding function used by the product search. */
export const LOWER_FUNCTION = 'pr_lower';

/**
 * Registers the SQL functions the queries rely on.
 *
 * SQLite's built-in `lower()` only folds ASCII, so "Müller" and "müller" would
 * be different words to the product search — not acceptable for a catalogue of
 * German groceries. JavaScript's `toLowerCase()` knows the full Unicode case
 * mapping, and a search that scans a six digit number of short rows can afford
 * the call.
 */
function registerFunctions(sqlite: Database.Database): void {
  sqlite.function(LOWER_FUNCTION, { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : null,
  );
}

/**
 * Opens the SQLite database with the pragmas this application relies on.
 *
 * WAL keeps readers from blocking the single writer, `foreign_keys` makes the
 * declared references actually enforced (SQLite ignores them otherwise) and
 * `busy_timeout` turns a lock conflict into a short wait instead of an
 * immediate `SQLITE_BUSY`. `synchronous = NORMAL` is the usual companion of
 * WAL: durable across process crashes, at most the last transaction is lost if
 * the machine loses power.
 */
export function openDatabase(options: OpenDatabaseOptions): OpenedDatabase {
  const { path, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS } = options;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);

  // In-memory databases have no WAL; setting it there is a no-op that SQLite
  // silently answers with "memory", so it is skipped for clarity.
  if (path !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma(`busy_timeout = ${busyTimeoutMs}`);
  sqlite.pragma('synchronous = NORMAL');

  registerFunctions(sqlite);

  const db = drizzle(sqlite, { schema, logger: options.logger ?? false });

  return {
    db,
    sqlite,
    close(): void {
      sqlite.close();
    },
  };
}
