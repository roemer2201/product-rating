import { z } from 'zod';

/**
 * Validation schemas around product photos.
 *
 * The image itself arrives as `multipart/form-data` and is checked by the
 * server against the real file content, not against what the client claims —
 * neither the file name nor the declared MIME type is trusted. What is left to
 * validate here is the little that travels as plain parameters: which
 * derivative of a photo is being asked for.
 */

/**
 * Name of the file part in `POST /api/v1/products/:id/photos`. Part of the API
 * contract, so the web client builds its `FormData` from the same constant the
 * server validates against.
 */
export const PHOTO_FIELD = 'photo';

/**
 * The two derivatives written for every upload: a thumbnail for lists and a
 * detail image for the product page. Originals are never kept; re-encoding is
 * what strips EXIF and defuses manipulated files.
 */
export const PHOTO_SIZES = ['thumb', 'full'] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];

export const photoSizeSchema = z.enum(PHOTO_SIZES);

/** Query of `GET /api/v1/media/:id`; the detail image is the default. */
export const mediaQuerySchema = z.object({
  size: photoSizeSchema.default('full'),
});

export type MediaQuery = z.infer<typeof mediaQuerySchema>;
