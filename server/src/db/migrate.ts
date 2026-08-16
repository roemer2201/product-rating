import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
  migrate(db, { migrationsFolder: folder });

  return { applied: pending, snapshot };
}
