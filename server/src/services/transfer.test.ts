import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { parseConfig, type AppConfig } from '../config/index.js';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../db/testing.js';
import { listProductPhotos, storePhoto } from './photos.js';
import { createPrice, listProductPrices } from './prices.js';
import { listProducts, trashProduct } from './products.js';
import { listUsers } from './users.js';
import { ValidationError } from './errors.js';
import {
  exportCatalogue,
  importCatalogue,
  EXPORT_JSON_FILE,
  EXPORT_PRICES_CSV,
  EXPORT_PRODUCTS_CSV,
  EXPORT_RATINGS_CSV,
  EXPORT_USERS_CSV,
} from './transfer.js';

/**
 * Export and import.
 *
 * The pair is tested as a round trip through two throwaway instances, because
 * that is what it is for: whatever comes out of one has to arrive whole in a
 * fresh installation that shares nothing with it but the user names.
 */

const ANNA = 'user-anna';
const BERT = 'user-bert';

interface Instance {
  database: TestDatabase;
  config: AppConfig;
}

function newInstance(withProducts = true): Instance {
  const database = createTestDatabase();
  const config = parseConfig({
    paths: {
      database: database.path,
      uploads: join(database.directory, 'uploads'),
      temp: join(database.directory, 'tmp'),
    },
  });
  mkdirSync(config.paths.uploads, { recursive: true });
  mkdirSync(config.paths.temp, { recursive: true });

  seedDatabase(database.db, {
    users: [
      { id: ANNA, username: 'anna' },
      { id: BERT, username: 'bert' },
    ],
  });

  if (withProducts) {
    const seeded = seedDatabase(database.db, {
      products: [
        {
          ean: '4260000000011',
          name: 'Apfelsaft',
          brand: 'Bio Hof',
          category: 'Getränke',
          createdBy: ANNA,
        },
        { ean: '4006381333931', name: 'Kaffee', createdBy: BERT },
      ],
    });

    const juice = seeded.products?.[0]?.id ?? '';
    seedDatabase(database.db, {
      ratings: [
        { productId: juice, userId: ANNA, stars: 5, comment: 'trüb, wie er soll' },
        { productId: juice, userId: BERT, stars: 3, comment: null },
      ],
    });
  }

  return { database, config };
}

/** A JPEG the way a phone hands one over. */
async function photoBytes(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a7d44' } })
    .jpeg()
    .toBuffer();
}

let source: Instance;
let target: Instance;
let directory: string;

beforeEach(() => {
  source = newInstance();
  target = newInstance(false);
  directory = join(source.database.directory, 'export');
});

afterEach(() => {
  source.database.close();
  target.database.close();
  rmSync(directory, { recursive: true, force: true });
});

function productIdOf(instance: Instance, ean: string): string {
  const page = listProducts(instance.database.db, ANNA, {
    q: ean,
    sort: 'updated',
    limit: 25,
  });
  return page.products[0]?.id ?? '';
}

describe('exporting', () => {
  it('writes the products with their ratings, by user name', async () => {
    const result = await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
    });

    expect(result.products).toBe(2);
    expect(result.ratings).toBe(2);

    const file = JSON.parse(readFileSync(join(directory, EXPORT_JSON_FILE), 'utf8')) as {
      format: string;
      products: { ean: string; createdBy: string; ratings: { user: string; stars: number }[] }[];
    };

    expect(file.format).toBe('product-rating-export');
    const juice = file.products.find((entry) => entry.ean === '4260000000011');
    expect(juice?.createdBy).toBe('anna');
    // Identifiers are of no use to another instance; names are.
    expect(juice?.ratings.map((rating) => rating.user).sort()).toEqual(['anna', 'bert']);
  });

  it('writes CSV a spreadsheet can read, with quoted fields', async () => {
    await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
      format: 'csv',
    });

    const products = readFileSync(join(directory, EXPORT_PRODUCTS_CSV), 'utf8');
    const ratings = readFileSync(join(directory, EXPORT_RATINGS_CSV), 'utf8');

    // Byte order mark first, otherwise a spreadsheet mangles the umlauts.
    expect(products.startsWith('\uFEFF')).toBe(true);
    expect(products).toContain('ean,name,brand,category');
    expect(products).toContain('4260000000011,Apfelsaft,Bio Hof,Getränke');
    // The average of five and three stars, next to the count.
    expect(products).toMatch(/4260000000011.*,2,4,/);
    expect(ratings).toContain('"trüb, wie er soll"');
    expect(products.endsWith('\r\n')).toBe(true);
  });

  it('leaves the accounts out when they are not wanted', async () => {
    const result = await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
      format: 'both',
      withUsers: false,
    });

    expect(result.users).toBe(0);
    expect(existsSync(join(directory, EXPORT_USERS_CSV))).toBe(false);

    const file = JSON.parse(readFileSync(join(directory, EXPORT_JSON_FILE), 'utf8')) as {
      users?: unknown;
      products: { ratings: { user: string }[] }[];
    };

    // The key is absent rather than empty: "no accounts in this file" is not
    // the same statement as "this instance has no accounts".
    expect(file.users).toBeUndefined();
    // The names stay on the entries — that is what an import maps.
    expect(file.products.some((product) => product.ratings.length > 0)).toBe(true);
  });

  it('leaves the trash out unless it is asked for', async () => {
    trashProduct(source.database.db, productIdOf(source, '4006381333931'), ANNA);

    const without = await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
    });
    expect(without.products).toBe(1);

    const with_ = await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
      includeTrash: true,
    });
    expect(with_.products).toBe(2);
  });
});

describe('prices in an export', () => {
  it('travels with the product and arrives once, however often it is read', async () => {
    const juice = productIdOf(source, '4260000000011');
    createPrice(source.database.db, source.config, ANNA, juice, {
      cents: 199,
      shop: 'Bioladen',
      note: null,
      purchasedAt: '2026-08-10',
    });

    const exported = await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
      format: 'both',
    });
    expect(exported.prices).toBe(1);
    expect(readFileSync(join(directory, EXPORT_PRICES_CSV), 'utf8')).toContain('Bioladen');

    await importCatalogue({ db: target.database.db, config: target.config, source: directory });
    const second = await importCatalogue({
      db: target.database.db,
      config: target.config,
      source: directory,
    });

    expect(second.pricesSkipped).toBe(1);
    const here = listProductPrices(target.database.db, productIdOf(target, '4260000000011'));
    expect(here).toHaveLength(1);
    expect(here[0]).toMatchObject({ cents: 199, currency: 'EUR', shop: 'Bioladen' });
  });
});

describe('importing', () => {
  it('carries products, ratings and photos into a fresh instance', async () => {
    const juice = productIdOf(source, '4260000000011');
    await storePhoto({
      db: source.database.db,
      config: source.config,
      productId: juice,
      userId: ANNA,
      data: await photoBytes(),
    });

    await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
      withPhotos: true,
    });

    const result = await importCatalogue({
      db: target.database.db,
      config: target.config,
      source: directory,
    });

    expect(result).toMatchObject({
      productsCreated: 2,
      ratingsCreated: 2,
      photosCreated: 1,
      problems: [],
    });

    const page = listProducts(target.database.db, ANNA, { sort: 'updated', limit: 25 });
    expect(page.total).toBe(2);
    const imported = page.products.find((entry) => entry.ean === '4260000000011');
    expect(imported?.ratings).toEqual({ average: 4, count: 2 });
    // The verdict of the account it belonged to, not of whoever ran the import.
    expect(imported?.ownRating?.stars).toBe(5);

    const photos = listProductPhotos(target.database.db, imported?.id ?? '');
    expect(photos).toHaveLength(1);
    // Re-encoded through the ordinary upload path, thumbnail included.
    expect(existsSync(join(target.config.paths.uploads, photos[0]?.filename ?? ''))).toBe(true);
  });

  it('reads the same file twice without doubling anything', async () => {
    await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
    });

    await importCatalogue({ db: target.database.db, config: target.config, source: directory });
    const second = await importCatalogue({
      db: target.database.db,
      config: target.config,
      source: directory,
    });

    expect(second).toMatchObject({
      productsCreated: 0,
      productsSkipped: 2,
      ratingsCreated: 0,
      ratingsSkipped: 2,
    });
    expect(listProducts(target.database.db, ANNA, { sort: 'updated', limit: 25 }).total).toBe(2);
  });

  it('never overwrites a rating that is already here', async () => {
    await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
    });
    await importCatalogue({ db: target.database.db, config: target.config, source: directory });

    // The same product rated differently on this side afterwards.
    const here = productIdOf(target, '4260000000011');
    target.database.db.run(
      `update ratings set stars = 1 where product_id = '${here}' and user_id = '${ANNA}'`,
    );

    await importCatalogue({ db: target.database.db, config: target.config, source: directory });

    const page = listProducts(target.database.db, ANNA, { sort: 'updated', limit: 25 });
    expect(page.products.find((entry) => entry.ean === '4260000000011')?.ownRating?.stars).toBe(1);
  });

  it('creates the accounts of the file, without a password', async () => {
    // A target instance that has none of the accounts of the file.
    const fresh = newInstance(false);
    fresh.database.db.run(sql`delete from users`);

    await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
    });

    const result = await importCatalogue({
      db: fresh.database.db,
      config: fresh.config,
      source: directory,
    });

    expect(result.usersCreated).toBe(2);
    expect(result.usersNeedingPassword.sort()).toEqual(['anna', 'bert']);
    expect(result.productsCreated).toBe(2);

    const accounts = listUsers(fresh.database.db);
    expect(accounts.map((user) => user.username).sort()).toEqual(['anna', 'bert']);
    // No hash arrived, so nothing can be logged into until a link is handed out.
    expect(accounts.every((user) => user.passwordResetRequired)).toBe(true);

    // The ratings hang off the accounts that were just created, not off one
    // account that swallowed everything.
    const owners = new Set(
      listProducts(fresh.database.db, accounts[0]?.id ?? '', {
        sort: 'updated',
        limit: 25,
      }).products.map((product) => product.createdBy),
    );
    expect(owners.size).toBe(2);

    fresh.database.close();
  });

  it('leaves an account that is already here as it is', async () => {
    await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
    });

    const result = await importCatalogue({
      db: target.database.db,
      config: target.config,
      source: directory,
    });

    expect(result.usersCreated).toBe(0);
    expect(result.usersSkipped).toBe(2);
    // The accounts of this instance keep their password and their role.
    expect(listUsers(target.database.db).every((user) => !user.passwordResetRequired)).toBe(true);
  });

  it('stops on an unknown account, and takes it over with an owner', async () => {
    await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
    });

    // A file that mentions somebody the target instance does not know, with
    // --skip-users so no account is created for them either.
    const path = join(directory, EXPORT_JSON_FILE);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('"bert"', '"carla"'));

    await expect(
      importCatalogue({
        db: target.database.db,
        config: target.config,
        source: directory,
        skipUsers: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(listProducts(target.database.db, ANNA, { sort: 'updated', limit: 25 }).total).toBe(0);

    const result = await importCatalogue({
      db: target.database.db,
      config: target.config,
      source: directory,
      skipUsers: true,
      owner: 'anna',
    });

    expect(result.unknownUsers).toEqual(['carla']);
    expect(result.productsCreated).toBe(2);
  });

  it('changes nothing on a dry run', async () => {
    await exportCatalogue({
      db: source.database.db,
      config: source.config,
      target: directory,
    });

    const result = await importCatalogue({
      db: target.database.db,
      config: target.config,
      source: directory,
      dryRun: true,
    });

    expect(result.productsCreated).toBe(2);
    expect(listProducts(target.database.db, ANNA, { sort: 'updated', limit: 25 }).total).toBe(0);
  });

  it('refuses a file that is not an export of this application', async () => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, EXPORT_JSON_FILE), '{"format":"something-else"}');

    await expect(
      importCatalogue({ db: target.database.db, config: target.config, source: directory }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
