import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './client.js';
import { migrationsFolder, runMigrations } from './migrate.js';
import { ratings, sessions, users } from './schema.js';
import { createTestDatabase, seedDatabase, type TestDatabase } from './testing.js';

let database: TestDatabase | null = null;

function db(): TestDatabase {
  database ??= createTestDatabase();
  return database;
}

afterEach(() => {
  database?.close();
  database = null;
});

describe('openDatabase', () => {
  it('enables the pragmas the application relies on', () => {
    const { sqlite } = db();

    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1);
  });
});

describe('runMigrations', () => {
  it('creates every table and is a no-op on the second run', () => {
    const { db: handle, sqlite, path } = db();

    const tables = sqlite
      .prepare(`select name from sqlite_master where type = 'table' order by name`)
      .all() as { name: string }[];
    const names = tables.map((table) => table.name);

    for (const table of ['users', 'sessions', 'invites', 'products', 'ratings', 'photos']) {
      expect(names).toContain(table);
    }

    const second = runMigrations({ db: handle, sqlite, databasePath: path });
    expect(second.applied).toBe(0);
    expect(second.snapshot).toBeNull();
  });

  it('writes a snapshot before applying migrations to a populated database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'product-rating-migrate-'));
    const path = join(directory, 'app.db');
    const fixtures = join(import.meta.dirname, '__fixtures__');

    try {
      // First release: fresh database, nothing to save.
      const initial = openDatabase({ path });
      const firstRun = runMigrations({
        db: initial.db,
        sqlite: initial.sqlite,
        databasePath: path,
        folder: join(fixtures, 'migrations-v1'),
      });
      expect(firstRun.applied).toBe(1);
      expect(firstRun.snapshot).toBeNull();

      initial.sqlite.prepare("insert into demo (id) values ('keep-me')").run();
      initial.close();

      // Second release adds a migration; the existing data has to be saved.
      const upgraded = openDatabase({ path });
      const secondRun = runMigrations({
        db: upgraded.db,
        sqlite: upgraded.sqlite,
        databasePath: path,
        folder: join(fixtures, 'migrations-v2'),
      });

      expect(secondRun.applied).toBe(1);
      expect(secondRun.snapshot).not.toBeNull();
      expect(existsSync(secondRun.snapshot as string)).toBe(true);
      expect(readdirSync(directory).some((entry) => entry.startsWith('pre-migration-'))).toBe(true);

      const row = upgraded.sqlite.prepare('select id, label from demo').get();
      expect(row).toEqual({ id: 'keep-me', label: null });

      // Running the same release again changes nothing.
      const thirdRun = runMigrations({
        db: upgraded.db,
        sqlite: upgraded.sqlite,
        databasePath: path,
        folder: join(fixtures, 'migrations-v2'),
      });
      expect(thirdRun).toEqual({ applied: 0, snapshot: null });
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('migration 0009: categories become a list', () => {
  it('takes the free text categories over, one entry per spelling regardless of case', () => {
    const directory = mkdtempSync(join(tmpdir(), 'product-rating-categories-'));
    const path = join(directory, 'app.db');
    // The real migrations up to 0008: the state of an instance before the
    // category list existed.
    const before = join(directory, 'migrations');
    cpSync(migrationsFolder(), before, { recursive: true });
    const journalPath = join(before, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const upTo = journal.entries.findIndex((entry) => entry.tag === '0009_product_categories');
    expect(upTo).toBeGreaterThan(0);
    writeFileSync(
      journalPath,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo) }),
    );

    try {
      const opened = openDatabase({ path });
      runMigrations({ db: opened.db, sqlite: opened.sqlite, databasePath: path, folder: before });

      const insertUser = opened.sqlite.prepare(
        `insert into users (id, username, password_hash, created_at) values (?, ?, 'x', 0)`,
      );
      insertUser.run('u1', 'anna');
      const insertProduct = opened.sqlite.prepare(
        `insert into products (id, ean, name, category, created_by, created_at, updated_at)
         values (?, ?, ?, ?, 'u1', 0, 0)`,
      );
      insertProduct.run('p1', '4260000000011', 'Apfelsaft', 'Getränke');
      insertProduct.run('p2', '4260000000028', 'Orangensaft', 'Getränke');
      insertProduct.run('p3', '4260000000035', 'Wasser', 'GETRÄNKE ');
      insertProduct.run('p4', '4260000000042', 'Zahnpasta', 'Bad');
      insertProduct.run('p5', '4006381333931', 'Stift', null);
      insertProduct.run('p6', '96385074', 'Radiergummi', '  ');

      // The next release brings 0009.
      runMigrations({ db: opened.db, sqlite: opened.sqlite, databasePath: path });

      const list = opened.sqlite.prepare('select id, name, frequent from categories').all() as {
        id: string;
        name: string;
        frequent: number;
      }[];
      // The spelling most products used names the entry; umlauts fold too.
      expect(list.map((entry) => entry.name).sort()).toEqual(['Bad', 'Getränke']);
      expect(list.every((entry) => entry.frequent === 0)).toBe(true);
      expect(
        list.every((entry) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]/.test(entry.id)),
      ).toBe(true);

      const assigned = opened.sqlite
        .prepare(
          `select pc.product_id as product, c.name as name from product_categories pc
           join categories c on c.id = pc.category_id order by pc.product_id`,
        )
        .all();
      expect(assigned).toEqual([
        { product: 'p1', name: 'Getränke' },
        { product: 'p2', name: 'Getränke' },
        { product: 'p3', name: 'Getränke' },
        { product: 'p4', name: 'Bad' },
      ]);

      // The column is gone, the products and everything hanging off them are not.
      const columns = opened.sqlite.prepare('pragma table_info(products)').all() as {
        name: string;
      }[];
      expect(columns.map((column) => column.name)).not.toContain('category');
      expect(opened.sqlite.prepare('select count(*) as count from products').get()).toEqual({
        count: 6,
      });
      opened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('schema constraints', () => {
  it('rejects a second user with the same username', () => {
    const { db: handle } = db();
    seedDatabase(handle, { users: [{ username: 'anna' }] });

    expect(() => seedDatabase(handle, { users: [{ username: 'anna' }] })).toThrow(/UNIQUE/i);
  });

  it('rejects an upper case username', () => {
    const { db: handle } = db();

    expect(() =>
      handle.insert(users).values({ id: randomUUID(), username: 'Anna', passwordHash: 'x' }).run(),
    ).toThrow(/CHECK/i);
  });

  it('rejects stars outside 0..10', () => {
    const { db: handle } = db();
    const userId = randomUUID();
    const productId = randomUUID();
    seedDatabase(handle, {
      users: [{ id: userId, username: 'anna' }],
      products: [{ id: productId, ean: '4006381333931', name: 'Stift', createdBy: userId }],
    });

    expect(() =>
      handle.insert(ratings).values({ id: randomUUID(), productId, userId, stars: 11 }).run(),
    ).toThrow(/CHECK/i);
    expect(() =>
      handle.insert(ratings).values({ id: randomUUID(), productId, userId, stars: -1 }).run(),
    ).toThrow(/CHECK/i);

    handle.insert(ratings).values({ id: randomUUID(), productId, userId, stars: 0 }).run();
    expect(handle.select().from(ratings).all()).toHaveLength(1);
  });

  it('enforces foreign keys and cascades sessions when a user disappears', () => {
    const { db: handle } = db();
    const seeded = seedDatabase(handle, { users: [{ username: 'anna' }] });
    const userId = seeded.users?.[0]?.id as string;

    handle
      .insert(sessions)
      .values({ id: 'hash', userId, expiresAt: new Date(Date.now() + 1000) })
      .run();

    expect(() =>
      handle
        .insert(sessions)
        .values({ id: 'other', userId: 'nobody', expiresAt: new Date() })
        .run(),
    ).toThrow(/FOREIGN KEY/i);

    handle.delete(users).where(eq(users.id, userId)).run();
    expect(handle.select().from(sessions).all()).toHaveLength(0);
  });
});
