import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, type AppDatabase, type OpenedDatabase } from './client.js';
import { runMigrations } from './migrate.js';
import { products, ratings, users } from './schema.js';

/**
 * Test helpers for the database layer.
 *
 * Every test gets its own migrated database in a temporary directory. A file
 * rather than `:memory:` keeps WAL, `busy_timeout` and the migration snapshot
 * on the same code path the server uses.
 */

export interface TestDatabase extends OpenedDatabase {
  /** Directory holding the database; removed by `close()`. */
  directory: string;
  path: string;
}

/** Creates a migrated, throwaway database. Always pair with `close()`. */
export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'product-rating-test-'));
  const path = join(directory, 'app.db');
  const opened = openDatabase({ path });

  runMigrations({ db: opened.db, sqlite: opened.sqlite, databasePath: path });

  return {
    ...opened,
    directory,
    path,
    close(): void {
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export interface SeedUser {
  id?: string;
  username: string;
  email?: string | null;
  passwordHash?: string;
  role?: 'admin' | 'user';
  disabledAt?: Date | null;
}

export interface SeedProduct {
  id?: string;
  ean: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  createdBy: string;
}

export interface SeedRating {
  id?: string;
  productId: string;
  userId: string;
  stars: number;
  comment?: string | null;
  /** Pin the timestamps where a test sorts or pages by rating date. */
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SeedData {
  users?: SeedUser[];
  products?: SeedProduct[];
  ratings?: SeedRating[];
}

/**
 * Placeholder hash for rows whose password is never checked. Tests that log in
 * create their users through the auth service so a real argon2id hash is used.
 */
export const SEED_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=1$c2VlZHNlZWRzZWVk$seed-not-usable';

/** Inserts fixture rows and returns the generated identifiers. */
export function seedDatabase(db: AppDatabase, data: SeedData): SeedData {
  const seeded: Required<SeedData> = { users: [], products: [], ratings: [] };

  for (const user of data.users ?? []) {
    const row = {
      id: user.id ?? randomUUID(),
      username: user.username.trim().toLowerCase(),
      email: user.email ?? null,
      passwordHash: user.passwordHash ?? SEED_PASSWORD_HASH,
      role: user.role ?? ('user' as const),
      disabledAt: user.disabledAt ?? null,
    };
    db.insert(users).values(row).run();
    seeded.users.push(row);
  }

  for (const product of data.products ?? []) {
    const row = {
      id: product.id ?? randomUUID(),
      ean: product.ean,
      name: product.name,
      brand: product.brand ?? null,
      category: product.category ?? null,
      createdBy: product.createdBy,
    };
    db.insert(products).values(row).run();
    seeded.products.push(row);
  }

  for (const rating of data.ratings ?? []) {
    const row = {
      id: rating.id ?? randomUUID(),
      productId: rating.productId,
      userId: rating.userId,
      stars: rating.stars,
      comment: rating.comment ?? null,
      ...(rating.createdAt === undefined ? {} : { createdAt: rating.createdAt }),
      ...(rating.updatedAt === undefined ? {} : { updatedAt: rating.updatedAt }),
    };
    db.insert(ratings).values(row).run();
    seeded.ratings.push(row);
  }

  return seeded;
}
