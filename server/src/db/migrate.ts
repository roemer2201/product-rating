import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type BetterSqlite3 from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { AppDatabase } from './client.js';

/** Entry of the journal drizzle-kit writes next to the generated SQL. */
interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface Journal {
  entries?: JournalEntry[];
}

export interface MigrateOptions {
  db: AppDatabase;
  sqlite: BetterSqlite3.Database;
  /** Database file path; `:memory:` and missing files skip the snapshot. */
  databasePath: string;
  /** Where to keep pre-migration snapshots. Defaults to the database folder. */
  snapshotDir?: string;
  /** Overrides the generated SQL folder; used by tests. */
  folder?: string;
  /** Called with human readable progress, usually the Fastify logger. */
  onInfo?: (message: string, details?: Record<string, unknown>) => void;
}

export interface MigrateResult {
  /** Number of migrations applied during this run. */
  applied: number;
  /** Path of the snapshot taken beforehand, if one was needed. */
  snapshot: string | null;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Locates the folder holding the generated SQL files.
 *
 * Two layouts have to work: the TypeScript sources during development and
 * tests (`server/src/db/migrations`) and the bundled server, where the folder
 * is copied next to `dist/index.js`.
 */
export function migrationsFolder(): string {
  const candidates = [
    join(moduleDir, 'migrations'),
    join(moduleDir, 'db', 'migrations'),
    join(moduleDir, '..', 'db', 'migrations'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
  }

  throw new Error(
    `no migrations folder found; looked in: ${candidates.map((c) => resolve(c)).join(', ')}`,
  );
}

/** Reads the migration tags drizzle-kit generated, in application order. */
function journalTags(folder: string): string[] {
  const raw = readFileSync(join(folder, 'meta', '_journal.json'), 'utf8');
  const journal = JSON.parse(raw) as Journal;
  return (journal.entries ?? []).map((entry) => entry.tag);
}

/** Number of migrations drizzle already recorded in this database. */
function appliedCount(sqlite: BetterSqlite3.Database): number {
  const table = sqlite
    .prepare(
      `select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`,
    )
    .get();
  if (table === undefined) return 0;

  const row = sqlite.prepare('select count(*) as count from __drizzle_migrations').get() as
    { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Migrations that are generated but not applied to this database yet.
 *
 * The command line interface uses it to refuse work on an outdated schema:
 * a query against a missing column fails with a message about SQL, not with
 * the one thing that helps — "run product-rating migrate".
 */
export function pendingMigrations(sqlite: BetterSqlite3.Database, folder?: string): number {
  const resolved = folder ?? migrationsFolder();
  return journalTags(resolved).length - appliedCount(sqlite);
}

/** Timestamp suffix for snapshot files: `20260814-171205`. */
function timestampSuffix(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Writes a consistent copy of the database before schema changes are applied.
 *
 * `VACUUM INTO` is the only safe way to copy a database in WAL mode: plain file
 * copies miss the write-ahead log. A failing snapshot aborts the migration,
 * because the whole point is to have a way back.
 */
export function snapshotDatabase(
  sqlite: BetterSqlite3.Database,
  databasePath: string,
  snapshotDir?: string,
): string {
  const target = join(
    snapshotDir ?? dirname(databasePath),
    `pre-migration-${timestampSuffix(new Date())}.db`,
  );

  sqlite.prepare('vacuum into ?').run(target);
  return target;
}

/**
 * Applies every pending migration, taking a snapshot first when an existing
 * database is about to change. Running it against an up-to-date database does
 * nothing, which makes it safe to call on every start-up.
 */
export function runMigrations(options: MigrateOptions): MigrateResult {
  const { db, sqlite, databasePath, onInfo } = options;
  const folder = options.folder ?? migrationsFolder();

  const total = journalTags(folder).length;
  const already = appliedCount(sqlite);
  const pending = total - already;

  if (pending <= 0) {
    onInfo?.('database schema is up to date', { migrations: total });
    return { applied: 0, snapshot: null };
  }

  let snapshot: string | null = null;
  const hasData = databasePath !== ':memory:' && existsSync(databasePath) && already > 0;

  if (hasData) {
    snapshot = snapshotDatabase(
      sqlite,
      databasePath,
      options.snapshotDir === undefined ? undefined : options.snapshotDir,
    );
    onInfo?.('database snapshot written', { snapshot, bytes: statSync(snapshot).size });
  }

  onInfo?.('applying migrations', { pending });
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  withoutForeignKeys(sqlite, () => {
    // Drizzle's synchronous migrator commits before it returns. Keep its
    // journal layout and timestamp selection, but own the transaction so a
    // failed foreign key check rolls back both the data and the journal.
    db.transaction((tx) => {
      tx.run(sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )`);
      const last = tx.get<{ created_at: number }>(
        sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
      );
      for (const migration of migrations) {
        if (last !== undefined && Number(last.created_at) >= migration.folderMillis) continue;
        for (const statement of migration.sql) tx.run(sql.raw(statement));
        tx.run(sql`INSERT INTO __drizzle_migrations (hash, created_at)
          VALUES (${migration.hash}, ${migration.folderMillis})`);
      }
      assertForeignKeys(sqlite, snapshot);
    });
  });

  return { applied: pending, snapshot };
}

/**
 * Runs the migrations with foreign key enforcement switched off, the way the
 * SQLite manual describes for schema changes ALTER TABLE cannot express
 * (https://www.sqlite.org/lang_altertable.html, "Making Other Kinds Of Table
 * Schema Changes").
 *
 * Such a change rebuilds the table: create the new one, copy the rows, drop
 * the old one, rename. With enforcement on, the DROP is an implicit DELETE of
 * every row, and each `on delete cascade` pointing at the table fires —
 * rebuilding `products` would take every rating, photo and price with it. The
 * `PRAGMA foreign_keys=OFF` drizzle-kit writes into such a migration cannot
 * help: the migrator runs all pending files in one transaction, and inside a
 * transaction the pragma is a no-op. So it is switched off here, before the
 * transaction starts, and the references are checked before it commits.
 * A violation rolls back the migrations and their journal entries, so another
 * start cannot quietly skip the check and use an inconsistent database.
 */
function withoutForeignKeys(sqlite: BetterSqlite3.Database, run: () => void): void {
  if (sqlite.inTransaction) throw new Error('migrations must run outside an existing transaction');
  const enabled = sqlite.pragma('foreign_keys', { simple: true }) === 1;
  if (enabled) sqlite.pragma('foreign_keys = OFF');

  try {
    run();
  } finally {
    if (enabled) sqlite.pragma('foreign_keys = ON');
  }
}

/** Checks the rebuilt tables while a failure can still roll the changes back. */
function assertForeignKeys(sqlite: BetterSqlite3.Database, snapshot: string | null): void {
  const violations = sqlite.pragma('foreign_key_check') as { table: string; parent: string }[];
  if (violations.length === 0) return;
  const tables = [...new Set(violations.map((entry) => `${entry.table} -> ${entry.parent}`))];
  throw new Error(
    `migrations left ${violations.length} broken reference(s) (${tables.join(', ')}); ` +
      'the migration was rolled back; ' +
      (snapshot === null
        ? 'no snapshot was taken because the database was empty'
        : `the state before the migration is also in ${snapshot}`),
  );
}
