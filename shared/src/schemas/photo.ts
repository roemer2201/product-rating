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

/**
 * Highest position a photo can be moved to. The bound exists so a mistyped
 * number cannot walk a photo past every gallery a household will ever have;
 * the service clamps to the number of photos the product really carries.
 */
export const PHOTO_MAX_POSITION = 999;

/**
 * Body of `PUT /api/v1/photos/:id/position`: where in the gallery the photo
 * goes. Zero is the front, and the front is what the product
 * card shows — moving a photo there is the same act as promoting it.
 */
export const movePhotoSchema = z.object({
  position: z.int().min(0).max(PHOTO_MAX_POSITION),
});

export type MovePhotoInput = z.infer<typeof movePhotoSchema>;
