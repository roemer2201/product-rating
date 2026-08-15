import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { mediaQuerySchema, PHOTO_FIELD, type Photo } from '@product-rating/shared';
import { currentUser } from '../plugins/auth.js';
import type { ErrorBody } from '../plugins/errorHandler.js';
import {
  deletePhoto,
  findPhotoById,
  setPrimaryPhoto,
  statPhotoFile,
  storePhoto,
} from '../services/photos.js';
import { NotFoundError, ValidationError } from '../services/errors.js';

/**
 * Photos and the route that hands the images out.
 *
 * Uploading is open to every account — the catalogue is shared — but a photo
 * belongs to whoever took it, so removing or promoting one is theirs and the
 * administrators'. Images never lie in the web root: `GET /api/v1/media/:id` is
 * the only way to them, and it wants a session like everything else.
 */

/** Seconds a browser may keep an image; the content behind an id never changes. */
const MEDIA_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Turns the plugin's "file too large" into the project's error shape, so a
 * client sees the same JSON here as everywhere else and learns the limit.
 */
function uploadError(error: unknown, limitMb: number): Error {
  const code = (error as { code?: string }).code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new ValidationError(`the image is larger than the limit of ${limitMb} MB`, {
      field: PHOTO_FIELD,
      maxFileSizeMb: limitMb,
    });
  }
  if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
    return new ValidationError('the request has to be sent as multipart/form-data');
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** `If-None-Match` may carry a list and weak markers; any match is a match. */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(',')
    .map((entry) => entry.trim().replace(/^W\//, ''))
    .some((entry) => entry === '*' || entry === etag);
}

interface ByteRange {
  start: number;
  end: number;
}

/**
 * A single `bytes=` range against a known size.
 *
 * Returns `null` when the header asks for something that is not a simple
 * range — several ranges at once, or a unit that is not `bytes` — in which case
 * the whole file is a valid answer. `'unsatisfiable'` is the case RFC 9110 wants
 * answered with `416`: a start beyond the end of the file.
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange | null | 'unsatisfiable' {
  if (header === undefined) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;

  const [, rawStart = '', rawEnd = ''] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // `bytes=-500` means the last 500 bytes.
    const length = Number(rawEnd);
    if (length === 0) return 'unsatisfiable';
    return { start: Math.max(size - length, 0), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return 'unsatisfiable';

  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return 'unsatisfiable';

  return { start, end };
}

export function registerPhotoRoutes(app: FastifyInstance): void {
  const limitMb = app.config.uploads.max_file_size_mb;

  /**
   * Adds a photo to a product. The image arrives as `multipart/form-data` in
   * the field `photo`; anything the client says about type or file name is
   * discarded in favour of what the bytes turn out to be.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/products/:id/photos',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const user = currentUser(request);

      let data: Buffer;
      let claimed: { filename: string; mimetype: string };
      try {
        const part = await request.file();
        if (part === undefined) {
          throw new ValidationError(`no image in the request; expected the field "${PHOTO_FIELD}"`);
        }
        claimed = { filename: part.filename, mimetype: part.mimetype };
        data = await part.toBuffer();
      } catch (error) {
        throw uploadError(error, limitMb);
      }

      const stored = await storePhoto({
        db: app.db,
        config: app.config,
        productId: request.params.id,
        userId: user.id,
        data,
      });

      request.log.info(
        {
          photoId: stored.photo.id,
          productId: request.params.id,
          by: user.id,
          source: stored.sourceFormat,
          claimedMime: claimed.mimetype,
          bytes: stored.bytes,
        },
        'photo stored',
      );

      return reply.code(201).send({ photo: stored.photo satisfies Photo });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/photos/:id',
    { preHandler: app.requireUser },
    async (request) => {
      const user = currentUser(request);
      const removed = await deletePhoto(app.db, app.config, user, request.params.id);

      request.log.info(
        {
          photoId: removed.photo.id,
          productId: removed.photo.productId,
          by: user.id,
          files: removed.filesRemoved,
        },
        'photo removed',
      );

      return { ok: true };
    },
  );

  /** Promotes a photo to the one shown on the product card. */
  app.put<{ Params: { id: string } }>(
    '/api/v1/photos/:id/primary',
    { preHandler: app.requireUser },
    async (request) => {
      const user = currentUser(request);
      const photo = setPrimaryPhoto(app.db, user, request.params.id);

      request.log.info(
        { photoId: photo.id, productId: photo.productId, by: user.id },
        'primary photo changed',
      );

      return { photo: photo satisfies Photo };
    },
  );

  /**
   * Hands out an image.
   *
   * Every logged in account may read every photo: the catalogue is shared, and
   * a product card without its picture would be pointless. What is guarded is
   * the way in — no guessable direct link, no static directory in the web root.
   *
   * The bytes behind an identifier never change (a new upload is a new photo),
   * so the `ETag` is the identifier itself and the answer may be cached for a
   * year — privately, because it took a session to get here.
   */
  app.get<{ Params: { id: string }; Querystring: { size?: string } }>(
    '/api/v1/media/:id',
    { preHandler: app.requireUser },
    async (request, reply) => {
      const { size } = mediaQuerySchema.parse(request.query ?? {});

      const row = findPhotoById(app.db, request.params.id);
      if (row === undefined) throw new NotFoundError('photo not found');

      const file = await statPhotoFile(app.config, row, size);
      if (file === undefined) {
        request.log.error(
          { photoId: row.id, productId: row.productId, size },
          'photo file is missing on disk',
        );
        throw new NotFoundError('the image file is missing');
      }

      return sendImage(request, reply, {
        path: file.path,
        size: file.size,
        mime: row.mime,
        etag: `"${row.id}-${size}"`,
      });
    },
  );
}

interface ImageResponse {
  path: string;
  size: number;
  mime: string;
  etag: string;
}

/** Conditional request, range request or the whole file. */
function sendImage(
  request: FastifyRequest,
  reply: FastifyReply,
  image: ImageResponse,
): FastifyReply {
  void reply
    .header('etag', image.etag)
    .header('cache-control', `private, max-age=${MEDIA_MAX_AGE_SECONDS}, immutable`)
    .header('accept-ranges', 'bytes');

  if (etagMatches(request.headers['if-none-match'], image.etag)) {
    return reply.code(304).send();
  }

  const range = parseByteRange(request.headers.range, image.size);

  // The only answer here that is not an image, so it keeps the JSON error
  // shape rather than the image content type.
  if (range === 'unsatisfiable') {
    return reply
      .code(416)
      .header('content-range', `bytes */${image.size}`)
      .send({
        error: { code: 'range_not_satisfiable', message: 'the requested range is out of bounds' },
      } satisfies ErrorBody);
  }

  void reply.header('content-type', image.mime);

  if (range === null) {
    return reply.header('content-length', String(image.size)).send(createReadStream(image.path));
  }

  return reply
    .code(206)
    .header('content-range', `bytes ${range.start}-${range.end}/${image.size}`)
    .header('content-length', String(range.end - range.start + 1))
    .send(createReadStream(image.path, { start: range.start, end: range.end }));
}
