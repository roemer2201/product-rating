/**
 * Shrinking a photo before it is uploaded.
 *
 * The server re-encodes every upload anyway — that is what strips EXIF and
 * defuses a manipulated file, and it is not something a client could be trusted
 * with. Doing it here as well is about the line in between: a current iPhone
 * takes twelve megapixel pictures of four megabytes, and sending that over a
 * phone connection to have the server throw nine tenths of it away is a wait
 * for nothing.
 *
 * Everything here is best effort. If the browser cannot decode the file — an
 * iPhone HEIC in a Chrome on the desktop, say — the original is uploaded
 * unchanged and `sharp` deals with it. A failed optimisation must never cost
 * someone their photo.
 */

/** Longest edge of an uploaded picture. Above the detail size the server keeps. */
export const UPLOAD_MAX_EDGE = 2048;

/** JPEG quality of the re-encoded picture. */
const UPLOAD_QUALITY = 0.85;

/** Below this a file is sent as it is; re-encoding could only make it worse. */
const SKIP_BELOW_BYTES = 512 * 1024;

export interface PreparedPhoto {
  blob: Blob;
  /** Name for the upload part; the server generates the name on disk anyway. */
  filename: string;
  /** Bytes of the file that was picked, for the "saved x %" of the progress. */
  originalBytes: number;
  /** False when the original is being sent, decoding or drawing having failed. */
  reduced: boolean;
}

/** `canvas.toBlob` as a promise; it reports failure as `null`. */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error('canvas could not be encoded'));
        else resolve(blob);
      },
      type,
      quality,
    );
  });
}

/** Replaces the extension, since the re-encoded picture is always a JPEG. */
function jpegName(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/, '');
  return `${base === '' ? 'photo' : base}.jpg`;
}

/**
 * Scales a picture down to `UPLOAD_MAX_EDGE` on its longest side.
 *
 * `createImageBitmap` is asked to apply the EXIF orientation, so a photo taken
 * with the phone on its side is drawn upright rather than being handed to the
 * canvas rotated — the canvas would then bake the wrong orientation in and the
 * server, which trusts the pixels, could no longer correct it.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const original: PreparedPhoto = {
    blob: file,
    filename: file.name === '' ? 'photo.jpg' : file.name,
    originalBytes: file.size,
    reduced: false,
  };

  if (file.size <= SKIP_BELOW_BYTES) return original;
  if (typeof createImageBitmap !== 'function') return original;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // An unsupported format — HEIC outside Safari, most likely. The server can
    // read it, so it goes up as it is.
    return original;
  }

  try {
    const scale = Math.min(1, UPLOAD_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return original;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext('2d');
    if (context === null) return original;

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', UPLOAD_QUALITY);

    // A re-encode that grew the file helps nobody.
    if (blob.size >= file.size) return original;

    return {
      blob,
      filename: jpegName(original.filename),
      originalBytes: file.size,
      reduced: true,
    };
  } catch {
    return original;
  } finally {
    bitmap.close();
  }
}
