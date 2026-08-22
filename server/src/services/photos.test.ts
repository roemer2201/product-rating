import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseConfig, type AppConfig } from '../config/index.js';
import { createTestDatabase, seedDatabase, type TestDatabase } from '../db/testing.js';
import type { PhotoRow } from '../db/index.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import {
  checkUploads,
  deletePhoto,
  listProductPhotos,
  photoFilePath,
  photoRelativePath,
  movePhoto,
  processImage,
  setPrimaryPhoto,
  storePhoto,
  PHOTO_MIME,
} from './photos.js';

/**
 * Image processing and storage.
 *
 * The point of re-encoding is checked here rather than through HTTP: what goes
 * in carries EXIF including a GPS position and an orientation that exists only
 * in the metadata, and what comes out has neither.
 */

const ANNA = { id: 'user-anna', role: 'user' };
const BERT = { id: 'user-bert', role: 'user' };
const ADMIN = { id: 'user-admin', role: 'admin' };

let database: TestDatabase;
let config: AppConfig;
let productId: string;

/** A JPEG the way a phone hands one over. */
async function phonePhoto(width = 1200, height = 900): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3a7d44' } })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Model: 'Test Phone' },
      IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
    })
    .jpeg()
    .toBuffer();
}

/** One stored photo row, failing loudly instead of returning `undefined`. */
function photoRow(id?: string): PhotoRow {
  const rows = listProductPhotos(database.db, productId);
  const row = id === undefined ? rows[0] : rows.find((entry) => entry.id === id);
  if (row === undefined) throw new Error('expected a stored photo');
  return row;
}

async function upload(userId: string, data?: Buffer) {
  return storePhoto({
    db: database.db,
    config,
    productId,
    userId,
    data: data ?? (await phonePhoto()),
  });
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

  const seeded = seedDatabase(database.db, {
    users: [
      { id: ANNA.id, username: 'anna' },
      { id: BERT.id, username: 'bert' },
      { id: ADMIN.id, username: 'admin', role: 'admin' },
    ],
    products: [{ ean: '4260000000011', name: 'Apfelsaft', createdBy: ANNA.id }],
  });

  productId = seeded.products?.[0]?.id ?? '';
});

afterEach(() => {
  database.close();
});

describe('processing an upload', () => {
  it('removes EXIF including the GPS position', async () => {
    const source = await phonePhoto();
    expect((await sharp(source).metadata()).exif).toBeDefined();

    const image = await processImage(config, source);

    expect((await sharp(image.detail).metadata()).exif).toBeUndefined();
    expect((await sharp(image.thumbnail).metadata()).exif).toBeUndefined();
  });

  it('applies the orientation instead of only recording it', async () => {
    // 1200x900 tagged "rotate by 90°" has to come out taller than it is wide.
    const image = await processImage(config, await phonePhoto(1200, 900));

    expect(image.width).toBeLessThan(image.height);
    expect(image.sourceFormat).toBe('jpeg');
  });

  it('writes a detail image and a smaller thumbnail, both WebP', async () => {
    const image = await processImage(config, await phonePhoto(3000, 3000));

    const detail = await sharp(image.detail).metadata();
    const thumbnail = await sharp(image.thumbnail).metadata();

    expect(detail.format).toBe('webp');
    expect(thumbnail.format).toBe('webp');
    expect(Math.max(detail.width, detail.height)).toBe(config.uploads.detail_px);
    expect(Math.max(thumbnail.width, thumbnail.height)).toBe(config.uploads.thumbnail_px);
    expect(image.thumbnail.length).toBeLessThan(image.detail.length);
  });

  it('does not enlarge an image that is already small', async () => {
    const small = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();

    const image = await processImage(config, small);
    expect([image.width, image.height]).toEqual([80, 60]);
  });

  it('keeps the metadata when strip_exif is switched off', async () => {
    const keeping = parseConfig({ paths: config.paths, uploads: { strip_exif: false } });

    const image = await processImage(keeping, await phonePhoto());
    expect((await sharp(image.detail).metadata()).exif).toBeDefined();
  });

  it('refuses a type outside the whitelist', async () => {
    const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } })
      .gif()
      .toBuffer();

    // image/gif is not among the accepted types.
    await expect(processImage(config, gif)).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses something that is not an image at all', async () => {
    await expect(
      processImage(config, Buffer.from('#!/bin/sh\necho hello\n')),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('storing a photo', () => {
  it('writes both derivatives under the product prefix, with a generated name', async () => {
    const stored = await upload(ANNA.id);
    const row = photoRow();

    expect(stored.photo.mime).toBe(PHOTO_MIME);
    expect(stored.photo.isPrimary).toBe(true);
    expect(photoRelativePath(row, 'full')).toMatch(
      new RegExp(`^${productId.slice(0, 2)}/${productId}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(photoRelativePath(row, 'thumb')).toContain('.thumb.webp');
    expect(existsSync(photoFilePath(config, row, 'full'))).toBe(true);
    expect(existsSync(photoFilePath(config, row, 'thumb'))).toBe(true);
  });

  it('leaves nothing behind, neither in temp nor as an unclaimed file', async () => {
    await upload(ANNA.id);

    const report = await checkUploads(database.db, config);
    expect(report.orphanFiles).toEqual([]);
    expect(report.missingFiles).toEqual([]);
  });

  it('makes the first photo primary and leaves later ones alone', async () => {
    const first = await upload(ANNA.id);
    const second = await upload(BERT.id);

    expect(first.photo.isPrimary).toBe(true);
    expect(second.photo.isPrimary).toBe(false);
  });

  it('refuses an unknown product', async () => {
    await expect(
      storePhoto({
        db: database.db,
        config,
        productId: 'does-not-exist',
        userId: ANNA.id,
        data: await phonePhoto(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('changing and removing photos', () => {
  it('moves the promoted photo to the front instead of adding a second primary', async () => {
    const mine = await upload(ANNA.id);
    const theirs = await upload(BERT.id);

    const promoted = setPrimaryPhoto(database.db, BERT, theirs.photo.id);

    expect(promoted.isPrimary).toBe(true);
    const rows = listProductPhotos(database.db, productId);
    // Being primary is being first, so there is only one of each.
    expect(rows.map((row) => row.id)).toEqual([theirs.photo.id, mine.photo.id]);
    expect(rows.map((row) => row.position)).toEqual([0, 1]);
  });

  it('moves a photo to a place in the gallery and keeps the numbering dense', async () => {
    const first = await upload(ANNA.id);
    const second = await upload(ANNA.id);
    const third = await upload(ANNA.id);

    const gallery = movePhoto(database.db, ANNA, first.photo.id, 2);

    expect(gallery.map((entry) => entry.id)).toEqual([
      second.photo.id,
      third.photo.id,
      first.photo.id,
    ]);
    expect(gallery.map((entry) => entry.position)).toEqual([0, 1, 2]);
    expect(gallery.map((entry) => entry.isPrimary)).toEqual([true, false, false]);
  });

  it('reads a position beyond the end as "last"', async () => {
    const first = await upload(ANNA.id);
    const second = await upload(ANNA.id);

    const gallery = movePhoto(database.db, ANNA, first.photo.id, 99);

    expect(gallery.map((entry) => entry.id)).toEqual([second.photo.id, first.photo.id]);
  });

  it('closes the gap when a photo in the middle is deleted', async () => {
    const first = await upload(ANNA.id);
    const second = await upload(ANNA.id);
    const third = await upload(ANNA.id);

    await deletePhoto(database.db, config, ANNA, second.photo.id);

    const rows = listProductPhotos(database.db, productId);
    expect(rows.map((row) => row.id)).toEqual([first.photo.id, third.photo.id]);
    expect(rows.map((row) => row.position)).toEqual([0, 1]);
  });

  it('deletes the row and both files', async () => {
    const mine = await upload(ANNA.id);
    await upload(BERT.id);
    const row = photoRow(mine.photo.id);

    const removed = await deletePhoto(database.db, config, ANNA, mine.photo.id);

    expect(removed.filesRemoved).toBe(2);
    expect(existsSync(photoFilePath(config, row, 'full'))).toBe(false);
    expect(existsSync(photoFilePath(config, row, 'thumb'))).toBe(false);
    expect(listProductPhotos(database.db, productId).map((entry) => entry.id)).not.toContain(
      mine.photo.id,
    );
  });

  it('keeps other accounts away from a photo, but not administrators', async () => {
    const theirs = await upload(BERT.id);

    await expect(deletePhoto(database.db, config, ANNA, theirs.photo.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(() => setPrimaryPhoto(database.db, ANNA, theirs.photo.id)).toThrow(ForbiddenError);
    expect(listProductPhotos(database.db, productId).map((row) => row.id)).toContain(
      theirs.photo.id,
    );

    await expect(deletePhoto(database.db, config, ADMIN, theirs.photo.id)).resolves.toMatchObject({
      filesRemoved: 2,
    });
  });

  it('answers an unknown photo with a not-found error', async () => {
    await expect(deletePhoto(database.db, config, ANNA, 'nope')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('checking the upload directory', () => {
  it('reports files no row claims and rows whose files are gone', async () => {
    const stored = await upload(ANNA.id);
    const row = photoRow();

    // A file left over from an interrupted delete, and a lost thumbnail.
    mkdirSync(join(config.paths.uploads, 'ab'), { recursive: true });
    writeFileSync(join(config.paths.uploads, 'ab', 'stray.webp'), 'not referenced');
    unlinkSync(photoFilePath(config, row, 'thumb'));

    const report = await checkUploads(database.db, config);

    expect(report.photos).toBe(1);
    expect(report.orphanFiles).toEqual(['ab/stray.webp']);
    expect(report.missingFiles).toEqual([
      { photoId: stored.photo.id, productId, path: photoRelativePath(row, 'thumb') },
    ]);
    // Reporting alone changes nothing on disk.
    expect(report.removed).toBe(0);
    expect(existsSync(join(config.paths.uploads, 'ab', 'stray.webp'))).toBe(true);
  });

  it('removes orphans only when repairing, never a referenced file', async () => {
    await upload(ANNA.id);
    const row = photoRow();

    mkdirSync(join(config.paths.uploads, 'ab'), { recursive: true });
    writeFileSync(join(config.paths.uploads, 'ab', 'stray.webp'), 'not referenced');

    const report = await checkUploads(database.db, config, { repair: true });

    expect(report.removed).toBe(1);
    expect(existsSync(join(config.paths.uploads, 'ab', 'stray.webp'))).toBe(false);
    // The bucket it lived in is empty now and goes as well.
    expect(existsSync(join(config.paths.uploads, 'ab'))).toBe(false);
    expect(existsSync(photoFilePath(config, row, 'full'))).toBe(true);
    expect(existsSync(photoFilePath(config, row, 'thumb'))).toBe(true);
  });

  it('is happy with an upload directory that does not exist yet', async () => {
    const report = await checkUploads(database.db, config);
    expect(report).toMatchObject({ photos: 0, orphanFiles: [], missingFiles: [], removed: 0 });
  });
});
