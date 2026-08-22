import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { normaliseEan } from '@product-rating/shared';
import type { AppConfig } from '../config/index.js';
import type { AppDatabase, DbHandle } from '../db/index.js';
import { photos, prices, products, ratings, users, type ProductRow } from '../db/index.js';
import { APP_VERSION } from '../version.js';
import { ValidationError } from './errors.js';
import { photoFilePath, storePhoto } from './photos.js';

/**
 * Export and import of the catalogue: taking the data out of an instance and
 * putting it into another one.
 *
 * This is deliberately not a backup. `backup` and `restore` move a whole
 * installation — the database file with its accounts, sessions and invites, the
 * upload directory byte for byte — and only ever between instances of the same
 * application. What is here is the readable form of the same content: products,
 * verdicts and pictures, addressed by EAN and by user name instead of by
 * identifier, so it survives a move to a fresh installation, a different host,
 * or a spreadsheet: products, ratings, recorded prices and pictures.
 *
 * Accounts are not part of it. An export that carried password hashes around
 * would turn a file somebody mails to themselves into a set of credentials; the
 * import therefore expects the accounts to exist and matches them by name.
 */

/** Name of the machine readable export inside the target directory. */
export const EXPORT_JSON_FILE = 'export.json';
export const EXPORT_PRODUCTS_CSV = 'products.csv';
export const EXPORT_RATINGS_CSV = 'ratings.csv';
export const EXPORT_PRICES_CSV = 'prices.csv';

/** Directory holding the exported detail images. */
export const EXPORT_PHOTOS_DIR = 'photos';

/** Marker in the JSON file, so an import knows what it is reading. */
export const EXPORT_FORMAT = 'product-rating-export';

/**
 * Version of the file format, not of the application.
 *
 * It goes up when a reader of version 1 could misunderstand a newer file. Added
 * fields do not need it — the import ignores what it does not know.
 */
export const EXPORT_VERSION = 1;

/** Owner only: a catalogue is personal data, and the photos are of a home. */
const PRIVATE_MODE = 0o700;

/* ------------------------------------------------------------------ shape */

const exportedRatingSchema = z.object({
  user: z.string().min(1),
  stars: z.number().int().min(0).max(5),
  comment: z.string().nullish(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const exportedPriceSchema = z.object({
  user: z.string().min(1),
  cents: z.number().int().min(0),
  currency: z.string().min(3).max(3),
  shop: z.string().nullish(),
  note: z.string().nullish(),
  purchasedAt: z.string().optional(),
});

const exportedPhotoSchema = z.object({
  user: z.string().min(1),
  /** Path of the image inside the export, relative to the export directory. */
  file: z.string().min(1),
  position: z.number().int().min(0).optional(),
  createdAt: z.string().optional(),
});

const exportedProductSchema = z.object({
  ean: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().nullish(),
  category: z.string().nullish(),
  notes: z.string().nullish(),
  createdBy: z.string().nullish(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  ratings: z.array(exportedRatingSchema).default([]),
  prices: z.array(exportedPriceSchema).default([]),
  photos: z.array(exportedPhotoSchema).default([]),
});

/**
 * The file as a whole. Unknown keys are allowed on purpose: a file written by a
 * later version should still import what this one understands.
 */
const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().min(1),
  products: z.array(exportedProductSchema),
});

export type ExportedProduct = z.infer<typeof exportedProductSchema>;
export type ExportFile = z.infer<typeof exportFileSchema>;

/* ----------------------------------------------------------------- export */

export type ExportFormat = 'json' | 'csv' | 'both';

export interface ExportOptions {
  db: AppDatabase;
  config: AppConfig;
  /** Directory the files are written into; created if it is missing. */
  target: string;
  format?: ExportFormat;
  /** Copy the detail images into `photos/` as well. */
  withPhotos?: boolean;
  /** Take products in the trash along; they are left out by default. */
  includeTrash?: boolean;
  onProgress?: (message: string) => void;
  now?: Date;
}

export interface ExportResult {
  directory: string;
  files: string[];
  products: number;
  ratings: number;
  /** Price rows written into the JSON file. */
  prices: number;
  /** Photo rows written into the JSON file. */
  photos: number;
  /** Image files copied, `0` without `withPhotos`. */
  photoFiles: number;
  /** Photo rows whose file was missing on disk; `fsck` finds these too. */
  missingPhotoFiles: number;
}

/** Everything the export needs, in one read per table. */
function collectProducts(db: DbHandle, includeTrash: boolean): ExportedProduct[] {
  const accounts = new Map(
    db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((row) => [row.id, row.username]),
  );

  const productRows = db
    .select()
    .from(products)
    .where(includeTrash ? undefined : isNull(products.deletedAt))
    .orderBy(asc(products.ean))
    .all();

  const ratingRows = db.select().from(ratings).orderBy(asc(ratings.createdAt)).all();
  const priceRows = db.select().from(prices).orderBy(asc(prices.purchasedAt)).all();
  const photoRows = db
    .select()
    .from(photos)
    .orderBy(asc(photos.position), asc(photos.createdAt))
    .all();

  return productRows.map((product) => ({
    ean: product.ean,
    name: product.name,
    brand: product.brand,
    category: product.category,
    notes: product.notes,
    createdBy: accounts.get(product.createdBy) ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    ratings: ratingRows
      .filter((rating) => rating.productId === product.id)
      .map((rating) => ({
        user: accounts.get(rating.userId) ?? '',
        stars: rating.stars,
        comment: rating.comment,
        createdAt: rating.createdAt.toISOString(),
        updatedAt: rating.updatedAt.toISOString(),
      }))
      // A rating whose account is gone has nothing to be attributed to.
      .filter((rating) => rating.user !== ''),
    prices: priceRows
      .filter((price) => price.productId === product.id)
      .map((price) => ({
        user: accounts.get(price.userId) ?? '',
        cents: price.cents,
        currency: price.currency,
        shop: price.shop,
        note: price.note,
        purchasedAt: price.purchasedAt.toISOString(),
      }))
      .filter((price) => price.user !== ''),
    photos: photoRows
      .filter((photo) => photo.productId === product.id)
      .map((photo) => ({
        user: accounts.get(photo.userId) ?? '',
        file: `${EXPORT_PHOTOS_DIR}/${photo.id}.webp`,
        position: photo.position,
        createdAt: photo.createdAt.toISOString(),
      }))
      .filter((photo) => photo.user !== ''),
  }));
}

/**
 * Writes the catalogue into a directory.
 *
 * JSON is the form the import reads; CSV is for everything else a household
 * does with its data — a spreadsheet, a shopping list, a look at which brand
 * ends up with three stars. Both are written from the same rows, so they cannot
 * drift apart.
 */
export async function exportCatalogue(options: ExportOptions): Promise<ExportResult> {
  const { db, config, target } = options;
  const format = options.format ?? 'json';
  const includeTrash = options.includeTrash ?? false;
  const onProgress = options.onProgress;

  await mkdir(target, { recursive: true, mode: PRIVATE_MODE });

  const exported = collectProducts(db, includeTrash);
  const photoRows = db.select().from(photos).all();
  const files: string[] = [];

  const totalRatings = exported.reduce((sum, product) => sum + product.ratings.length, 0);
  const totalPrices = exported.reduce((sum, product) => sum + product.prices.length, 0);
  const totalPhotos = exported.reduce((sum, product) => sum + product.photos.length, 0);

  if (format === 'json' || format === 'both') {
    const document = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: (options.now ?? new Date()).toISOString(),
      application: APP_VERSION,
      products: exported,
    };
    const path = join(target, EXPORT_JSON_FILE);
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    files.push(path);
    onProgress?.(`${EXPORT_JSON_FILE}: ${String(exported.length)} product(s)`);
  }

  if (format === 'csv' || format === 'both') {
    const productsPath = join(target, EXPORT_PRODUCTS_CSV);
    await writeFile(productsPath, productsCsv(exported), { mode: 0o600 });
    files.push(productsPath);

    const ratingsPath = join(target, EXPORT_RATINGS_CSV);
    await writeFile(ratingsPath, ratingsCsv(exported), { mode: 0o600 });
    files.push(ratingsPath);

    const pricesPath = join(target, EXPORT_PRICES_CSV);
    await writeFile(pricesPath, pricesCsv(exported), { mode: 0o600 });
    files.push(pricesPath);

    onProgress?.(
      `${EXPORT_PRODUCTS_CSV}, ${EXPORT_RATINGS_CSV}, ${EXPORT_PRICES_CSV}: ` +
        `${String(totalRatings)} rating(s), ${String(totalPrices)} price(s)`,
    );
  }

  let photoFiles = 0;
  let missingPhotoFiles = 0;

  if (options.withPhotos === true) {
    const directory = join(target, EXPORT_PHOTOS_DIR);
    await mkdir(directory, { recursive: true, mode: PRIVATE_MODE });

    const wanted = new Set(
      exported.flatMap((product) => product.photos.map((photo) => photo.file)),
    );

    for (const row of photoRows) {
      const name = `${EXPORT_PHOTOS_DIR}/${row.id}.webp`;
      if (!wanted.has(name)) continue;

      try {
        // The detail image only: the thumbnail is a derivative the import
        // writes again anyway, and it would double the size of the export.
        const data = await readFile(photoFilePath(config, row, 'full'));
        await writeFile(join(target, name), data, { mode: 0o600 });
        photoFiles += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        missingPhotoFiles += 1;
        onProgress?.(`missing image file for photo ${row.id}, skipped`);
      }
    }

    onProgress?.(`${EXPORT_PHOTOS_DIR}/: ${String(photoFiles)} image file(s)`);
  }

  return {
    directory: target,
    files,
    products: exported.length,
    ratings: totalRatings,
    prices: totalPrices,
    photos: totalPhotos,
    photoFiles,
    missingPhotoFiles,
  };
}

/* -------------------------------------------------------------------- CSV */

/**
 * One field in RFC 4180 form: quoted whenever it carries a separator, a quote
 * or a line break, and a quote inside is doubled.
 */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Joins rows the way RFC 4180 wants them, with a byte order mark in front.
 *
 * The mark is what makes a spreadsheet read "Getränke" instead of "GetrÃ¤nke":
 * without it, Excel falls back to the code page of the system rather than
 * assuming UTF-8.
 */
function csvDocument(rows: (string | number | null)[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

function productsCsv(exported: ExportedProduct[]): string {
  const rows: (string | number | null)[][] = [
    [
      'ean',
      'name',
      'brand',
      'category',
      'notes',
      'created_by',
      'created_at',
      'updated_at',
      'rating_count',
      'average_stars',
      'photo_count',
    ],
  ];

  for (const product of exported) {
    const count = product.ratings.length;
    const average =
      count === 0
        ? null
        : Math.round((product.ratings.reduce((sum, r) => sum + r.stars, 0) / count) * 100) / 100;

    rows.push([
      product.ean,
      product.name,
      product.brand ?? null,
      product.category ?? null,
      product.notes ?? null,
      product.createdBy ?? null,
      product.createdAt ?? null,
      product.updatedAt ?? null,
      count,
      average,
      product.photos.length,
    ]);
  }

  return csvDocument(rows);
}

function ratingsCsv(exported: ExportedProduct[]): string {
  const rows: (string | number | null)[][] = [
    ['ean', 'product', 'user', 'stars', 'comment', 'created_at', 'updated_at'],
  ];

  for (const product of exported) {
    for (const rating of product.ratings) {
      rows.push([
        product.ean,
        product.name,
        rating.user,
        rating.stars,
        rating.comment ?? null,
        rating.createdAt ?? null,
        rating.updatedAt ?? null,
      ]);
    }
  }

  return csvDocument(rows);
}

function pricesCsv(exported: ExportedProduct[]): string {
  const rows: (string | number | null)[][] = [
    ['ean', 'product', 'user', 'cents', 'currency', 'shop', 'note', 'purchased_at'],
  ];

  for (const product of exported) {
    for (const price of product.prices) {
      rows.push([
        product.ean,
        product.name,
        price.user,
        price.cents,
        price.currency,
        price.shop ?? null,
        price.note ?? null,
        price.purchasedAt ?? null,
      ]);
    }
  }

  return csvDocument(rows);
}

/* ----------------------------------------------------------------- import */

export interface ImportOptions {
  db: AppDatabase;
  config: AppConfig;
  /** The `export.json` to read, or the directory holding it. */
  source: string;
  /**
   * Account that takes over everything whose user name does not exist here.
   * Without it, an unknown name is a reason to stop before anything is written.
   */
  owner?: string;
  /** Write the data of products that already exist over what is stored. */
  update?: boolean;
  /** Read and check everything, change nothing. */
  dryRun?: boolean;
  onProgress?: (message: string) => void;
  now?: Date;
}

export interface ImportResult {
  productsCreated: number;
  productsUpdated: number;
  /** Products that exist here and were left alone (no `--update`). */
  productsSkipped: number;
  ratingsCreated: number;
  /** Ratings that were already there; an existing verdict is never overwritten. */
  ratingsSkipped: number;
  pricesCreated: number;
  /** Prices that this file had already put here on an earlier run. */
  pricesSkipped: number;
  photosCreated: number;
  photosSkipped: number;
  /** User names of the file that no account here answers to. */
  unknownUsers: string[];
  /** Entries that could not be taken over, with the reason. */
  problems: string[];
}

/** Reads and validates the file, whether a directory or the file was named. */
export async function readExportFile(source: string): Promise<ExportFile> {
  const candidates = source.endsWith('.json') ? [source] : [join(source, EXPORT_JSON_FILE), source];

  let raw: string | undefined;
  for (const candidate of candidates) {
    try {
      raw = await readFile(candidate, 'utf8');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  if (raw === undefined) {
    throw new ValidationError(`no ${EXPORT_JSON_FILE} found at ${source}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError(`${source} is not readable JSON`);
  }

  const result = exportFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `${source} is not a ${EXPORT_FORMAT} file: ${result.error.issues[0]?.message ?? 'unknown'}`,
    );
  }

  if (result.data.version > EXPORT_VERSION) {
    throw new ValidationError(
      `the file was written by a newer version (format ${String(result.data.version)}, ` +
        `this one reads ${String(EXPORT_VERSION)})`,
    );
  }

  return result.data;
}

/** Turns a date from the file into a `Date`, falling back to the import time. */
function momentOf(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

/**
 * Reads an export into this instance.
 *
 * Merging, not replacing: a product that is already here keeps its data unless
 * `update` says otherwise, and a rating that is already here is never
 * overwritten — somebody's verdict is not something an import gets to change.
 * That also makes the whole thing repeatable: the same file twice leaves the
 * same catalogue behind.
 */
export async function importCatalogue(options: ImportOptions): Promise<ImportResult> {
  const { db, config, source } = options;
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const onProgress = options.onProgress;

  const file = await readExportFile(source);

  const accounts = new Map(
    db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((row) => [row.username, row.id]),
  );

  const fallbackId =
    options.owner === undefined ? undefined : accounts.get(options.owner.trim().toLowerCase());
  if (options.owner !== undefined && fallbackId === undefined) {
    throw new ValidationError(`no account named "${options.owner}" exists here`);
  }

  const result: ImportResult = {
    productsCreated: 0,
    productsUpdated: 0,
    productsSkipped: 0,
    ratingsCreated: 0,
    ratingsSkipped: 0,
    pricesCreated: 0,
    pricesSkipped: 0,
    photosCreated: 0,
    photosSkipped: 0,
    unknownUsers: [],
    problems: [],
  };

  const unknown = new Set<string>();
  const resolve = (name: string | null | undefined): string | undefined => {
    if (name === null || name === undefined || name === '') return fallbackId;
    const id = accounts.get(name.trim().toLowerCase());
    if (id !== undefined) return id;
    unknown.add(name);
    return fallbackId;
  };

  // Every name in the file is looked up before anything is written: stopping
  // halfway through an import is the one outcome nobody can clean up by hand.
  for (const product of file.products) {
    resolve(product.createdBy);
    for (const rating of product.ratings) resolve(rating.user);
    for (const price of product.prices) resolve(price.user);
    for (const photo of product.photos) resolve(photo.user);
  }

  result.unknownUsers = [...unknown].sort();
  if (unknown.size > 0 && fallbackId === undefined) {
    throw new ValidationError(
      `the file mentions accounts that do not exist here: ${result.unknownUsers.join(', ')}`,
    );
  }

  for (const entry of file.products) {
    const ean = normaliseEan(entry.ean);
    if (ean === null) {
      result.problems.push(`${entry.ean}: not a valid EAN, skipped`);
      continue;
    }

    const owner = resolve(entry.createdBy);
    if (owner === undefined) {
      result.problems.push(`${ean}: no account to attribute it to, skipped`);
      continue;
    }

    const existing = db.select().from(products).where(eq(products.ean, ean)).get();
    const productId = existing?.id ?? randomUUID();

    if (existing === undefined) {
      result.productsCreated += 1;
      if (!dryRun) {
        const row: ProductRow = {
          id: productId,
          ean,
          name: entry.name,
          brand: entry.brand ?? null,
          category: entry.category ?? null,
          notes: entry.notes ?? null,
          createdBy: owner,
          createdAt: momentOf(entry.createdAt, now),
          updatedAt: momentOf(entry.updatedAt, now),
          deletedAt: null,
          deletedBy: null,
        };
        db.insert(products).values(row).run();
      }
    } else if (options.update === true) {
      result.productsUpdated += 1;
      if (!dryRun) {
        db.update(products)
          .set({
            name: entry.name,
            brand: entry.brand ?? null,
            category: entry.category ?? null,
            notes: entry.notes ?? null,
            updatedAt: now,
            // A product that is in the trash here comes back with the import:
            // the file says it belongs in the catalogue.
            deletedAt: null,
            deletedBy: null,
          })
          .where(eq(products.id, productId))
          .run();
      }
    } else {
      result.productsSkipped += 1;
    }

    // A dry run has no product to hang ratings and photos off, so counting
    // them against a row that does not exist would be a lie.
    if (dryRun && existing === undefined) {
      result.ratingsCreated += entry.ratings.length;
      result.pricesCreated += entry.prices.length;
      result.photosCreated += entry.photos.length;
      continue;
    }

    for (const rating of entry.ratings) {
      const userId = resolve(rating.user);
      if (userId === undefined) {
        result.problems.push(`${ean}: rating of "${rating.user}" has no account, skipped`);
        continue;
      }

      const already = db
        .select({ id: ratings.id })
        .from(ratings)
        .where(and(eq(ratings.productId, productId), eq(ratings.userId, userId)))
        .get();

      if (already !== undefined) {
        result.ratingsSkipped += 1;
        continue;
      }

      result.ratingsCreated += 1;
      if (!dryRun) {
        db.insert(ratings)
          .values({
            id: randomUUID(),
            productId,
            userId,
            stars: rating.stars,
            comment: rating.comment ?? null,
            createdAt: momentOf(rating.createdAt, now),
            updatedAt: momentOf(rating.updatedAt, now),
          })
          .run();
      }
    }

    for (const price of entry.prices) {
      const userId = resolve(price.user);
      if (userId === undefined) {
        result.problems.push(`${ean}: price of "${price.user}" has no account, skipped`);
        continue;
      }

      const paidAt = momentOf(price.purchasedAt, now);

      // Same account, same day, same amount: that is the entry this file
      // already put here on an earlier run.
      const already = db
        .select({ id: prices.id })
        .from(prices)
        .where(
          and(
            eq(prices.productId, productId),
            eq(prices.userId, userId),
            eq(prices.purchasedAt, paidAt),
            eq(prices.cents, price.cents),
          ),
        )
        .get();

      if (already !== undefined) {
        result.pricesSkipped += 1;
        continue;
      }

      result.pricesCreated += 1;
      if (!dryRun) {
        db.insert(prices)
          .values({
            id: randomUUID(),
            productId,
            userId,
            cents: price.cents,
            currency: price.currency,
            shop: price.shop ?? null,
            note: price.note ?? null,
            purchasedAt: paidAt,
            createdAt: now,
          })
          .run();
      }
    }

    for (const photo of entry.photos) {
      const userId = resolve(photo.user);
      if (userId === undefined) {
        result.problems.push(`${ean}: photo of "${photo.user}" has no account, skipped`);
        continue;
      }

      const takenAt = momentOf(photo.createdAt, now);

      // Same account, same moment: that is the picture this file already put
      // here on an earlier run.
      const already = db
        .select({ id: photos.id })
        .from(photos)
        .where(
          and(
            eq(photos.productId, productId),
            eq(photos.userId, userId),
            eq(photos.createdAt, takenAt),
          ),
        )
        .get();

      if (already !== undefined) {
        result.photosSkipped += 1;
        continue;
      }

      const imagePath = join(directoryOf(source), photo.file);
      let data: Buffer;
      try {
        data = await readFile(imagePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        result.problems.push(`${ean}: image file ${photo.file} is missing, skipped`);
        continue;
      }

      result.photosCreated += 1;
      if (!dryRun) {
        // Through the ordinary upload path: the picture is re-encoded, the
        // thumbnail is written and nothing from a foreign file reaches the
        // disk unchecked.
        await storePhoto({ db, config, productId, userId, data, now: takenAt });
      }
    }

    onProgress?.(`${ean} ${entry.name}`);
  }

  return result;
}

/** The directory an image path in the file is relative to. */
function directoryOf(source: string): string {
  return source.endsWith('.json') ? join(source, '..') : source;
}
