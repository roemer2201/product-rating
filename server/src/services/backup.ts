import Database from 'better-sqlite3';
import { constants } from 'node:fs';
import {
  copyFile,
  link,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  utimes,
} from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import type { AppConfig } from '../config/index.js';

/**
 * Backup and restore of a complete instance: the SQLite database and the
 * photos that belong to it.
 *
 * Copying `app.db` while the service runs is not safe — in WAL mode the most
 * recent writes sit in a separate file and a plain copy catches the database
 * mid transaction. `VACUUM INTO` hands that job to SQLite itself: a compact,
 * consistent copy without stopping the service.
 *
 * The layout of a snapshot is the same one
 * `packaging/examples/backup/product-rating-backup` produces, so a snapshot
 * from either can be restored with either:
 *
 *   <target>/<YYYY-MM-DD_HHMMSS>/app.db
 *   <target>/<YYYY-MM-DD_HHMMSS>/uploads/...
 *   <target>/latest -> <YYYY-MM-DD_HHMMSS>
 */

/** File name of the database copy inside a snapshot. */
export const BACKUP_DATABASE_FILE = 'app.db';

/** Directory holding the photos inside a snapshot. */
export const BACKUP_UPLOADS_DIR = 'uploads';

/** Symlink that always points at the newest snapshot. */
export const LATEST_LINK = 'latest';

/** Directory names of snapshots: `2026-08-16_174205`. */
const SNAPSHOT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})$/;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Owner only, for both snapshots and their directories: this is personal data. */
const PRIVATE_MODE = 0o700;

export interface BackupOptions {
  config: AppConfig;
  /** Directory the snapshot is created in; created if missing. */
  target: string;
  /** Delete snapshots older than this many days. `0` keeps everything. */
  keepDays?: number;
  /** Progress messages, one line each. */
  onProgress?: (message: string) => void;
  /** Overrides the clock; used by the tests. */
  now?: Date;
}

export interface BackupResult {
  /** Directory of the new snapshot. */
  directory: string;
  databaseBytes: number;
  /** Photos copied into the snapshot. */
  files: number;
  /** How many of them are hard links into the previous snapshot. */
  linked: number;
  bytes: number;
  /** Snapshots the retention limit removed. */
  removed: string[];
}

export interface RestoreOptions {
  config: AppConfig;
  /** Snapshot directory to read, the one holding `app.db`. */
  source: string;
  onProgress?: (message: string) => void;
  now?: Date;
}

export interface RestoreResult {
  /** Copy of the database as it was before the restore, or `null`. */
  previousDatabase: string | null;
  /** Photos written into the upload directory. */
  files: number;
  /** Photos removed because the snapshot does not have them. */
  removedFiles: number;
}

/** Directory name of a snapshot taken at `now`, in local time. */
export function snapshotName(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/** The moment a snapshot directory name stands for, or `null`. */
export function snapshotDate(name: string): Date | null {
  const match = SNAPSHOT_PATTERN.exec(name);
  if (match === null) return null;

  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((part) => Number.parseInt(part, 10));

  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0);
}

/** Snapshot directories below `target`, oldest first. */
export async function listSnapshots(target: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory() && SNAPSHOT_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Every regular file below `directory`, as relative paths with `/`. */
async function walkFiles(directory: string, base = directory): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkFiles(full, base)));
    } else if (entry.isFile()) {
      found.push(relative(base, full).split(sep).join(posix.sep));
    }
  }

  return found;
}

/** Answers whether a path exists, without caring what it is. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Turns a relative path with `/` back into one for this platform. */
function toLocalPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split(posix.sep));
}

/**
 * Copies the database through SQLite.
 *
 * The source is opened read-only, so a backup can never be the reason the
 * live database changes, and the copy is read back afterwards: a file that
 * cannot be opened and checked is not a backup, it only looks like one.
 */
function copyDatabase(databasePath: string, into: string): void {
  const source = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    source.prepare('vacuum into ?').run(into);
  } finally {
    source.close();
  }

  const copy = new Database(into, { readonly: true, fileMustExist: true });
  try {
    const rows = copy.pragma('integrity_check') as { integrity_check: string }[];
    const verdict = rows[0]?.integrity_check ?? 'unknown';
    if (verdict !== 'ok') {
      throw new Error(`the database copy is damaged: ${verdict}`);
    }
  } finally {
    copy.close();
  }
}

/**
 * Copies a file and gives the copy the modification time of the original.
 *
 * Without that the copy would carry the time of the backup run, and the next
 * run could no longer tell an unchanged photo from a changed one — the whole
 * hard linking below rests on it. It is also what `cp -p` and `rsync -a` do,
 * so a snapshot looks the same however it was made.
 */
async function copyPreservingTime(from: string, to: string): Promise<void> {
  const source = await stat(from);
  await copyFile(from, to);
  await utimes(to, source.atime, source.mtime);
}

/**
 * Copies one photo, hard linking it to the previous snapshot when it has not
 * changed.
 *
 * An unchanged photo then costs a directory entry instead of a second copy,
 * while every snapshot still looks complete: a file survives as long as one
 * link to it remains, so deleting an old snapshot never damages a newer one.
 * Photos are written once and never modified, which is what makes matching on
 * size and modification time enough.
 */
async function linkOrCopy(
  from: string,
  to: string,
  previous: string | null,
): Promise<'linked' | 'copied'> {
  if (previous !== null) {
    try {
      const [current, old] = await Promise.all([stat(from), stat(previous)]);
      if (current.size === old.size && Math.abs(current.mtimeMs - old.mtimeMs) < 1) {
        await link(previous, to);
        return 'linked';
      }
    } catch {
      // No previous file, or it cannot be linked (different file system, for
      // instance). Copying always works and is the point of the exercise.
    }
  }

  await copyPreservingTime(from, to);
  return 'copied';
}

/** Points `latest` at the new snapshot without a moment of having none. */
async function updateLatestLink(target: string, name: string): Promise<void> {
  const temporary = join(target, `.${LATEST_LINK}.new`);
  try {
    await unlink(temporary);
  } catch {
    // Nothing to clean up.
  }

  try {
    await symlink(name, temporary);
    await rename(temporary, join(target, LATEST_LINK));
  } catch {
    // Symlinks are not available everywhere; the snapshot itself is complete
    // without one, only the hard linking of the next run loses its reference.
  }
}

/** Path of the previous snapshot's photos, or `null` if there is none. */
async function previousUploads(target: string): Promise<string | null> {
  try {
    const name = await readlink(join(target, LATEST_LINK));
    const uploads = join(target, name, BACKUP_UPLOADS_DIR);
    return (await stat(uploads)).isDirectory() ? uploads : null;
  } catch {
    const snapshots = await listSnapshots(target);
    const last = snapshots.at(-1);
    if (last === undefined) return null;

    const uploads = join(target, last, BACKUP_UPLOADS_DIR);
    try {
      return (await stat(uploads)).isDirectory() ? uploads : null;
    } catch {
      return null;
    }
  }
}

/** Removes snapshots older than `keepDays`, newest ones first kept. */
async function pruneSnapshots(
  target: string,
  keepDays: number,
  now: Date,
  current: string,
): Promise<string[]> {
  if (keepDays <= 0) return [];

  const limit = now.getTime() - keepDays * MILLISECONDS_PER_DAY;
  const removed: string[] = [];

  for (const name of await listSnapshots(target)) {
    if (name === current) continue;

    const taken = snapshotDate(name);
    if (taken === null || taken.getTime() >= limit) continue;

    await rm(join(target, name), { recursive: true, force: true });
    removed.push(name);
  }

  return removed;
}

/**
 * Writes a new snapshot of database and photos into `target`.
 *
 * The database is copied first: it is the part that has to be consistent, and
 * a snapshot whose photos are a few seconds younger than its database is
 * harmless — `fsck --uploads` finds the extra files, and nothing references
 * them.
 */
export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  const { config, target, onProgress } = options;
  const now = options.now ?? new Date();
  const name = snapshotName(now);
  const directory = join(target, name);

  await mkdir(target, { recursive: true, mode: PRIVATE_MODE });

  if (await exists(directory)) {
    throw new Error(`the snapshot directory already exists: ${directory}`);
  }

  await mkdir(directory, { mode: PRIVATE_MODE });

  const databaseCopy = join(directory, BACKUP_DATABASE_FILE);
  onProgress?.(`copying the database into ${databaseCopy}`);
  copyDatabase(config.paths.database, databaseCopy);
  const databaseBytes = (await stat(databaseCopy)).size;

  const previous = await previousUploads(target);
  if (previous !== null) onProgress?.(`hard linking unchanged photos against ${previous}`);

  const uploadsCopy = join(directory, BACKUP_UPLOADS_DIR);
  await mkdir(uploadsCopy, { recursive: true, mode: PRIVATE_MODE });

  const photos = await walkFiles(config.paths.uploads);
  let linked = 0;
  let bytes = 0;

  for (const photo of photos) {
    const from = toLocalPath(config.paths.uploads, photo);
    const to = toLocalPath(uploadsCopy, photo);

    await mkdir(dirname(to), { recursive: true, mode: PRIVATE_MODE });
    const how = await linkOrCopy(from, to, previous === null ? null : toLocalPath(previous, photo));
    if (how === 'linked') linked += 1;
    bytes += (await stat(to)).size;
  }

  await updateLatestLink(target, name);

  const removed = await pruneSnapshots(target, options.keepDays ?? 0, now, name);
  for (const gone of removed) onProgress?.(`removed the outdated snapshot ${gone}`);

  return { directory, databaseBytes, files: photos.length, linked, bytes, removed };
}

/** Reports what is wrong with a snapshot directory, or `null` if it is sound. */
export async function inspectSnapshot(source: string): Promise<string | null> {
  const database = join(source, BACKUP_DATABASE_FILE);

  try {
    if (!(await stat(database)).isFile()) return `${database} is not a file`;
  } catch {
    return `${database} does not exist; is ${source} a snapshot directory?`;
  }

  let handle;
  try {
    handle = new Database(database, { readonly: true, fileMustExist: true });
  } catch (error) {
    return `${database} cannot be opened (${error instanceof Error ? error.message : String(error)})`;
  }

  try {
    const rows = handle.pragma('integrity_check') as { integrity_check: string }[];
    const verdict = rows[0]?.integrity_check ?? 'unknown';
    return verdict === 'ok' ? null : `${database} is damaged: ${verdict}`;
  } finally {
    handle.close();
  }
}

/** Number of photos a snapshot carries; used before asking for confirmation. */
export async function countSnapshotFiles(source: string): Promise<number> {
  return (await walkFiles(join(source, BACKUP_UPLOADS_DIR))).length;
}

/** Removes directories that the restore left empty, deepest first. */
async function pruneEmptyDirectories(root: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = join(root, entry.name);
    await pruneEmptyDirectories(child);
    await rmdir(child).catch(() => undefined);
  }
}

/**
 * Puts a snapshot back in place: database first, then the photos.
 *
 * The service has to be stopped for this — the caller is responsible for
 * saying so — because the running server holds the database open and would
 * keep writing into the file that is being replaced.
 *
 * Whatever is in place beforehand is not simply thrown away: the current
 * database is copied next to the snapshot it is replaced by, so a restore
 * from the wrong directory can be undone.
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const { config, source, onProgress } = options;
  const now = options.now ?? new Date();

  const problem = await inspectSnapshot(source);
  if (problem !== null) throw new Error(problem);

  // --- Database ---------------------------------------------------------
  // Existence is checked on its own, so a failing copy stays a failing copy
  // instead of being taken for a database that was not there in the first
  // place. A first restore into an empty installation has nothing to keep.
  let previousDatabase: string | null = null;
  if (await exists(config.paths.database)) {
    previousDatabase = join(dirname(config.paths.database), `pre-restore-${snapshotName(now)}.db`);
    onProgress?.(`keeping the current database as ${previousDatabase}`);
    copyDatabase(config.paths.database, previousDatabase);
  }

  const incoming = `${config.paths.database}.restore`;
  await mkdir(dirname(config.paths.database), { recursive: true });
  await copyFile(join(source, BACKUP_DATABASE_FILE), incoming, constants.COPYFILE_FICLONE);
  await rename(incoming, config.paths.database);

  // The write-ahead log and the shared memory file belong to the database
  // that has just been replaced; leaving them behind would mix two databases.
  for (const suffix of ['-wal', '-shm']) {
    await rm(`${config.paths.database}${suffix}`, { force: true });
  }
  onProgress?.(`database restored into ${config.paths.database}`);

  // --- Photos -----------------------------------------------------------
  const from = join(source, BACKUP_UPLOADS_DIR);
  const wanted = await walkFiles(from);
  const present = new Set(await walkFiles(config.paths.uploads));

  await mkdir(config.paths.uploads, { recursive: true });

  for (const photo of wanted) {
    const to = toLocalPath(config.paths.uploads, photo);
    await mkdir(dirname(to), { recursive: true });
    await copyPreservingTime(toLocalPath(from, photo), to);
    present.delete(photo);
  }

  // What is left over belongs to the state that has just been replaced. The
  // database no longer knows these files, so they would only take up space.
  let removedFiles = 0;
  for (const photo of present) {
    await rm(toLocalPath(config.paths.uploads, photo), { force: true });
    removedFiles += 1;
  }
  await pruneEmptyDirectories(config.paths.uploads);

  onProgress?.(`photos restored into ${config.paths.uploads}`);

  return { previousDatabase, files: wanted.length, removedFiles };
}
