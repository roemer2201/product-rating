import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig, type AppConfig } from '../config/index.js';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../db/testing.js';
import {
  createBackup,
  inspectSnapshot,
  listSnapshots,
  restoreBackup,
  snapshotDate,
  snapshotName,
} from './backup.js';

/**
 * The backup path is the one part of the application that has to work when
 * everything else does not, so it is tested against real files: a real SQLite
 * database, real photos and a real restore over the top of them.
 */

let database: TestDatabase;
let config: AppConfig;
let target: string;

/** Writes a file below the upload directory, creating what it needs. */
function writePhoto(relativePath: string, content: string): void {
  const path = join(config.paths.uploads, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  database = createTestDatabase();
  config = parseConfig({
    paths: {
      database: database.path,
      uploads: join(database.directory, 'uploads'),
      temp: join(database.directory, 'tmp'),
    },
  });

  mkdirSync(config.paths.uploads, { recursive: true });
  target = mkdtempSync(join(tmpdir(), 'product-rating-backups-'));

  seedDatabase(database.db, { users: [{ username: 'anna' }] });
  writePhoto('ab/photo-1.webp', 'first');
  writePhoto('cd/photo-2.webp', 'second');
});

afterEach(() => {
  database.close();
  rmSync(target, { recursive: true, force: true });
});

describe('snapshot names', () => {
  it('are readable and can be read back', () => {
    const moment = new Date(2026, 7, 16, 3, 5, 7);

    expect(snapshotName(moment)).toBe('2026-08-16_030507');
    expect(snapshotDate('2026-08-16_030507')?.getTime()).toBe(moment.getTime());
    expect(snapshotDate('latest')).toBeNull();
  });
});

describe('createBackup', () => {
  it('copies database and photos into a directory named after the moment', async () => {
    const result = await createBackup({ config, target });

    expect(result.files).toBe(2);
    expect(result.databaseBytes).toBeGreaterThan(0);
    expect(await inspectSnapshot(result.directory)).toBeNull();
    expect(readFileSync(join(result.directory, 'uploads', 'ab', 'photo-1.webp'), 'utf8')).toBe(
      'first',
    );
    expect(await listSnapshots(target)).toHaveLength(1);
  });

  it('works while the database is open and answers queries', async () => {
    const result = await createBackup({ config, target });

    // The handle of the test database is still open, which is exactly the
    // situation a backup of a running instance is taken in.
    expect(database.sqlite.prepare('select count(*) as count from users').get()).toEqual({
      count: 1,
    });
    expect(await inspectSnapshot(result.directory)).toBeNull();
  });

  it('hard links photos that have not changed since the last snapshot', async () => {
    const first = await createBackup({ config, target, now: new Date(2026, 7, 16, 3, 0, 0) });
    expect(first.linked).toBe(0);

    writePhoto('ef/photo-3.webp', 'third');
    const second = await createBackup({ config, target, now: new Date(2026, 7, 17, 3, 0, 0) });

    expect(second.files).toBe(3);
    expect(second.linked).toBe(2);
    // A hard link means one file with two names, not two files.
    expect(statSync(join(first.directory, 'uploads', 'ab', 'photo-1.webp')).ino).toBe(
      statSync(join(second.directory, 'uploads', 'ab', 'photo-1.webp')).ino,
    );
  });

  it('removes snapshots beyond the retention limit, never the new one', async () => {
    await createBackup({ config, target, now: new Date(2026, 6, 1, 3, 0, 0) });
    await createBackup({ config, target, now: new Date(2026, 7, 15, 3, 0, 0) });

    const result = await createBackup({
      config,
      target,
      keepDays: 7,
      now: new Date(2026, 7, 16, 3, 0, 0),
    });

    expect(result.removed).toEqual(['2026-07-01_030000']);
    expect(await listSnapshots(target)).toEqual(['2026-08-15_030000', '2026-08-16_030000']);
  });

  it('refuses to write over an existing snapshot', async () => {
    const now = new Date(2026, 7, 16, 3, 0, 0);
    await createBackup({ config, target, now });

    await expect(createBackup({ config, target, now })).rejects.toThrow(/already exists/);
  });
});

describe('restoreBackup', () => {
  it('puts database and photos back and keeps what it replaced', async () => {
    const snapshot = await createBackup({ config, target });

    seedDatabase(database.db, { users: [{ username: 'tom' }] });
    writePhoto('gh/photo-4.webp', 'fourth');
    rmSync(join(config.paths.uploads, 'ab', 'photo-1.webp'));
    // The restore replaces the file the open handle is using, so it has to be
    // closed first - exactly what "stop the service" means for a deployment.
    database.sqlite.close();

    const result = await restoreBackup({ config, source: snapshot.directory });

    expect(result.files).toBe(2);
    expect(result.removedFiles).toBe(1);
    expect(result.previousDatabase).not.toBeNull();
    expect(readFileSync(join(config.paths.uploads, 'ab', 'photo-1.webp'), 'utf8')).toBe('first');

    const restored = new Database(config.paths.database, { readonly: true });
    try {
      expect(restored.prepare('select username from users').all()).toEqual([{ username: 'anna' }]);
    } finally {
      restored.close();
    }
  });

  it('refuses a directory without a database in it', async () => {
    await expect(restoreBackup({ config, source: target })).rejects.toThrow(/app\.db/);
  });
});
