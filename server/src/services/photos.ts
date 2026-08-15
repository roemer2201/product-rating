import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { and, asc, desc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { PHOTO_FIELD, type Photo, type PhotoSize } from '@product-rating/shared';
import type { AppConfig } from '../config/index.js';
import type { DbHandle } from '../db/index.js';
import { photos, products, type PhotoRow } from '../db/index.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

/**
 * Product photos: storing them, serving them and finding the ones that got
 * lost.
 *
 * Nothing the client sends about a file is believed. The declared MIME type and
 * the file name are ignored; what counts is the format `sharp` actually finds in
 * the bytes. Every upload is re-encoded, which is the whole point of the
 * exercise: it drops EXIF — GPS position above all — normalises the orientation
 * an iPhone only records in metadata, and turns a crafted image file into
 * ordinary pixels before anything else touches it.
 *
 * Files live under `paths.uploads`, never in the database and never in the web
 * root. They are reachable through `GET /api/v1/media/:id` alone.
 */

/**
 * Both derivatives are written as WebP, whatever came in.
 *
 * One output format keeps the storage layout and the cache headers simple, and
 * WebP is the format every browser this application targets understands —
 * including Safari on iOS, which is the client that matters here. It also means
 * an iPhone HEIC becomes something a browser can display at all.
 */
export const PHOTO_MIME = 'image/webp';
const PHOTO_EXTENSION = 'webp';

/** Marks the thumbnail next to its detail image: `<id>.thumb.webp`. */
const THUMBNAIL_INFIX = '.thumb';

/** Quality of the two derivatives; the thumbnail may be visibly cheaper. */
const DETAIL_QUALITY = 82;
const THUMBNAIL_QUALITY = 72;

/**
 * Input formats `sharp` reports and the MIME type they are checked against.
 * HEIC and HEIF are the same container; iOS labels its photos either way, so
 * allowing one of them in the configuration is enough.
 */
const INPUT_MIME_BY_FORMAT: Record<string, string[]> = {
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  tiff: ['image/tiff'],
  avif: ['image/avif'],
  heif: ['image/heic', 'image/heif'],
};

/* --------------------------------------------------------------- storage */

/**
 * Where a photo lives, relative to `paths.uploads`.
 *
 * Files are bucketed by the first two characters of the product identifier and
 * then by the product itself: a six figure catalogue spreads over 256
 * directories instead of piling up in one, and everything belonging to a
 * product can be removed in a single step. The name is generated from the photo
 * identifier — what the client called its file never reaches the disk.
 */
export function photoRelativePath(row: PhotoRow, size: PhotoSize): string {
  return size === 'full' ? row.filename : thumbnailOf(row.filename);
}

/** The thumbnail belonging to a detail image, by the naming rule above. */
function thumbnailOf(detailPath: string): string {
  const cut = detailPath.lastIndexOf('.');
  return cut < 0
    ? `${detailPath}${THUMBNAIL_INFIX}`
    : `${detailPath.slice(0, cut)}${THUMBNAIL_INFIX}${detailPath.slice(cut)}`;
}

/** Absolute path of one derivative. */
export function photoFilePath(config: AppConfig, row: PhotoRow, size: PhotoSize): string {
  return join(config.paths.uploads, ...photoRelativePath(row, size).split(posix.sep));
}

/** Directory holding every photo of one product, relative to the uploads root. */
function productDirectory(productId: string): string {
  return posix.join(productId.slice(0, 2), productId);
}

function newDetailPath(productId: string, photoId: string): string {
  return posix.join(productDirectory(productId), `${photoId}.${PHOTO_EXTENSION}`);
}

/**
 * Writes a file so that no half finished image is ever visible: the bytes go to
 * `paths.temp` first and are moved into place in one step. A rename only works
 * within a filesystem, so a `paths.temp` on a different mount falls back to
 * copying — still atomic enough, because the copy happens under the temporary
 * name.
 */
async function writeAtomically(config: AppConfig, targetPath: string, data: Buffer): Promise<void> {
  await mkdir(config.paths.temp, { recursive: true, mode: 0o750 });
  const temporary = join(config.paths.temp, `upload-${randomUUID()}.tmp`);

  await writeFile(temporary, data, { mode: 0o640 });
  try {
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o750 });
    try {
      await rename(temporary, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyFile(temporary, targetPath);
      await unlink(temporary);
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Removes a file that may already be gone. */
async function removeFile(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Drops the product directory once its last photo is gone. Failure is fine. */
async function pruneDirectory(config: AppConfig, productId: string): Promise<void> {
  const directory = join(config.paths.uploads, ...productDirectory(productId).split(posix.sep));
  await rmdir(directory).catch(() => undefined);
  await rmdir(dirname(directory)).catch(() => undefined);
}

/**
 * Deletes the files of the given photo rows. Used when a photo is removed and
 * when an administrator deletes a whole product — the rows are gone by then,
 * their files are not.
 */
export async function removePhotoFiles(
  config: AppConfig,
  rows: readonly PhotoRow[],
): Promise<number> {
  let removed = 0;

  for (const row of rows) {
    for (const size of ['full', 'thumb'] as const) {
      if (await removeFile(photoFilePath(config, row, size))) removed += 1;
    }
  }

  for (const productId of new Set(rows.map((row) => row.productId))) {
    await pruneDirectory(config, productId);
  }

  return removed;
}

/* ------------------------------------------------------------ processing */

export interface ProcessedImage {
  detail: Buffer;
  thumbnail: Buffer;
  /** Dimensions of the detail image, which is what the API reports. */
  width: number;
  height: number;
  /** What the bytes really were, for the log. */
  sourceFormat: string;
}

/** Turns whatever `sharp` reports into the MIME type it would be called. */
function mimeCandidates(format: string | undefined): string[] {
  return format === undefined ? [] : (INPUT_MIME_BY_FORMAT[format] ?? [`image/${format}`]);
}

/**
 * Re-encodes an upload into a detail image and a thumbnail.
 *
 * `rotate()` without an argument applies the EXIF orientation and then drops
 * it, so a photo taken sideways is stored the way it was seen. Metadata is not
 * carried over unless `uploads.strip_exif` is switched off — the default keeps
 * the GPS position of the kitchen out of the shared catalogue.
 */
export async function processImage(config: AppConfig, input: Buffer): Promise<ProcessedImage> {
  const { allowed_mime, detail_px, thumbnail_px, strip_exif } = config.uploads;

  let format: string | undefined;
  try {
    // `failOn: 'error'` tolerates the warnings real phone cameras produce and
    // still refuses anything that cannot be decoded.
    format = (await sharp(input, { failOn: 'error' }).metadata()).format;
  } catch {
    // Named field and all: the client shows its message next to the picker,
    // and "not readable" is a different sentence than "wrong type".
    throw new ValidationError('the uploaded file is not a readable image', {
      field: PHOTO_FIELD,
    });
  }

  const candidates = mimeCandidates(format);
  if (candidates.length === 0 || !candidates.some((mime) => allowed_mime.includes(mime))) {
    throw new ValidationError('this image type is not accepted', {
      field: PHOTO_FIELD,
      detected: candidates[0] ?? 'unknown',
      allowed: allowed_mime,
    });
  }

  const encode = async (edge: number, quality: number) => {
    const pipeline = sharp(input, { failOn: 'error' }).rotate();
    return (strip_exif ? pipeline : pipeline.keepMetadata())
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
  };

  const detail = await encode(detail_px, DETAIL_QUALITY);
  const thumbnail = await encode(thumbnail_px, THUMBNAIL_QUALITY);

  return {
    detail: detail.data,
    thumbnail: thumbnail.data,
    width: detail.info.width,
    height: detail.info.height,
    sourceFormat: format ?? 'unknown',
  };
}

/* -------------------------------------------------------------- queries */

export function toPublicPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    productId: row.productId,
    userId: row.userId,
    mime: row.mime,
    width: row.width,
    height: row.height,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt.toISOString(),
  };
}

export function findPhotoById(db: DbHandle, id: string): PhotoRow | undefined {
  return db.select().from(photos).where(eq(photos.id, id)).get();
}

/** Photos of a product, primary first and oldest first after that. */
export function listProductPhotos(db: DbHandle, productId: string): PhotoRow[] {
  return db
    .select()
    .from(photos)
    .where(eq(photos.productId, productId))
    .orderBy(desc(photos.isPrimary), asc(photos.createdAt), asc(photos.id))
    .all();
}

/** The same list in the shape the API returns. */
export function productPhotos(db: DbHandle, productId: string): Photo[] {
  return listProductPhotos(db, productId).map(toPublicPhoto);
}

/**
 * A photo may be changed by the account that uploaded it and by
 * administrators. The catalogue is shared, but someone else's picture is not.
 */
function requireOwnership(row: PhotoRow, user: { id: string; role: string }): void {
  if (row.userId !== user.id && user.role !== 'admin') {
    throw new ForbiddenError('this photo belongs to another account');
  }
}

/* --------------------------------------------------------------- writing */

export interface StorePhotoOptions {
  db: DbHandle;
  config: AppConfig;
  productId: string;
  userId: string;
  data: Buffer;
  now?: Date;
}

export interface StoredPhoto {
  photo: Photo;
  /** What the upload really was, so the route can log it. */
  sourceFormat: string;
  bytes: number;
}

/**
 * Stores an upload against a product.
 *
 * The files are written before the row exists: a file without a row is litter
 * that `fsck` finds, a row without files would be a broken image in the app.
 * If the insert fails anyway, the files are taken back out.
 */
export async function storePhoto(options: StorePhotoOptions): Promise<StoredPhoto> {
  const { db, config, productId, userId, data } = options;
  const now = options.now ?? new Date();

  const product = db.select().from(products).where(eq(products.id, productId)).get();
  if (product === undefined) throw new NotFoundError('product not found');

  const image = await processImage(config, data);

  const row: PhotoRow = {
    id: randomUUID(),
    productId,
    userId,
    filename: newDetailPath(productId, randomUUID()),
    mime: PHOTO_MIME,
    width: image.width,
    height: image.height,
    // The first photo of a product carries the product; later ones have to be
    // promoted deliberately.
    isPrimary: listProductPhotos(db, productId).length === 0,
    createdAt: now,
  };

  await writeAtomically(config, photoFilePath(config, row, 'full'), image.detail);
  await writeAtomically(config, photoFilePath(config, row, 'thumb'), image.thumbnail);

  try {
    db.insert(photos).values(row).run();
  } catch (error) {
    await removePhotoFiles(config, [row]);
    throw error;
  }

  return {
    photo: toPublicPhoto(row),
    sourceFormat: image.sourceFormat,
    bytes: image.detail.length + image.thumbnail.length,
  };
}

export interface RemovedPhoto {
  photo: Photo;
  filesRemoved: number;
}

/** Removes a photo and its files. Owner or administrator. */
export async function deletePhoto(
  db: DbHandle,
  config: AppConfig,
  user: { id: string; role: string },
  photoId: string,
): Promise<RemovedPhoto> {
  const row = findPhotoById(db, photoId);
  if (row === undefined) throw new NotFoundError('photo not found');
  requireOwnership(row, user);

  db.delete(photos).where(eq(photos.id, photoId)).run();
  const filesRemoved = await removePhotoFiles(config, [row]);

  // No successor is promoted: the product query falls back to the oldest
  // remaining photo on its own, so a product never loses its picture.
  return { photo: toPublicPhoto(row), filesRemoved };
}

/**
 * Makes a photo the one shown on cards and in the list.
 *
 * "Primary" is a property of the product, not of an account, so promoting one
 * photo demotes the others. Both statements run in one transaction; a half
 * applied change would leave a product with two primary photos.
 */
export function setPrimaryPhoto(
  db: DbHandle,
  user: { id: string; role: string },
  photoId: string,
): Photo {
  const row = findPhotoById(db, photoId);
  if (row === undefined) throw new NotFoundError('photo not found');
  requireOwnership(row, user);

  db.transaction((tx) => {
    tx.update(photos)
      .set({ isPrimary: false })
      .where(and(eq(photos.productId, row.productId), eq(photos.isPrimary, true)))
      .run();
    tx.update(photos).set({ isPrimary: true }).where(eq(photos.id, photoId)).run();
  });

  return toPublicPhoto({ ...row, isPrimary: true });
}

/* ------------------------------------------------------------------ fsck */

export interface UploadCheckReport {
  /** Files under `paths.uploads` that no photo row claims. */
  orphanFiles: string[];
  /** Photo rows whose files are missing; the app would show a broken image. */
  missingFiles: { photoId: string; productId: string; path: string }[];
  /** Number of photo rows examined. */
  photos: number;
  /** Files deleted, `0` unless `repair` was asked for. */
  removed: number;
}

/** Every regular file below `directory`, as paths relative to it. */
async function listFiles(directory: string, base = directory): Promise<string[]> {
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
      found.push(...(await listFiles(full, base)));
    } else if (entry.isFile()) {
      found.push(relative(base, full).split(sep).join(posix.sep));
    }
  }

  return found;
}

/**
 * Compares the upload directory against the photo table in both directions.
 *
 * Orphaned files happen when a delete is interrupted between the row and the
 * file, or when a database is restored from an older backup. They cost space
 * and nothing else, so removing them is opt in — `repair` is what
 * `product-rating fsck --uploads --repair` passes.
 */
export async function checkUploads(
  db: DbHandle,
  config: AppConfig,
  options: { repair?: boolean } = {},
): Promise<UploadCheckReport> {
  const rows = db.select().from(photos).all();

  const expected = new Map<string, PhotoRow>();
  for (const row of rows) {
    expected.set(photoRelativePath(row, 'full'), row);
    expected.set(photoRelativePath(row, 'thumb'), row);
  }

  const onDisk = new Set(await listFiles(config.paths.uploads));

  const orphanFiles = [...onDisk].filter((path) => !expected.has(path)).sort();
  const missingFiles = [...expected]
    .filter(([path]) => !onDisk.has(path))
    .map(([path, row]) => ({ photoId: row.id, productId: row.productId, path }))
    .sort((left, right) => left.path.localeCompare(right.path));

  let removed = 0;
  if (options.repair === true) {
    for (const path of orphanFiles) {
      if (await removeFile(join(config.paths.uploads, ...path.split(posix.sep)))) removed += 1;
    }
    await pruneEmptyDirectories(config.paths.uploads);
  }

  return { orphanFiles, missingFiles, photos: rows.length, removed };
}

/** Removes directories left behind by deleted files, deepest first. */
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

/** Path and size of a stored derivative, or `undefined` if it is gone. */
export async function statPhotoFile(
  config: AppConfig,
  row: PhotoRow,
  size: PhotoSize,
): Promise<{ path: string; size: number } | undefined> {
  const path = photoFilePath(config, row, size);
  try {
    const stats = await stat(path);
    return stats.isFile() ? { path, size: stats.size } : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
