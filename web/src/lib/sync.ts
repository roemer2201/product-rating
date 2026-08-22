import { ApiError, api, isApiError } from '@/lib/api';
import {
  listCaptures,
  removeCapture,
  saveCapture,
  type Capture,
  type CaptureConflict,
} from '@/lib/offlineQueue';

/**
 * Getting what was captured offline onto the server.
 *
 * Every capture is resolved through its EAN, which is what makes the whole
 * approach work: a device without a connection cannot know whether an article
 * is already in the catalogue, so it records what it saw and this module
 * decides — later, with the server in reach — whether that becomes a new
 * product or an addition to one that is already there.
 *
 * The order inside a capture is deliberate: product, price, photos, rating.
 * The rating goes last because it is the only part that can be contested, and
 * everything before it is either idempotent (the product, addressed by EAN) or
 * append-only (price, photos) and is remembered in `progress` so a retry cannot
 * double it.
 *
 * Nothing is ever dropped without somebody saying so. A capture the server
 * refuses ends up as `failed` with the reason on it; a rating that would
 * overwrite a newer verdict ends up as `conflict` and waits for a decision.
 */

export interface SyncResult {
  /** Captures that made it onto the server and left the queue. */
  synced: number;
  /** Captures that are waiting for a person to resolve a conflict. */
  conflicts: number;
  /** Captures the server refused; the reason is on the capture. */
  failed: number;
  /** Captures still waiting because the connection did not hold. */
  pending: number;
}

const EMPTY_RESULT: SyncResult = { synced: 0, conflicts: 0, failed: 0, pending: 0 };

/**
 * A failure that is worth trying again later: the request never arrived, or the
 * server was in no state to answer. Everything else is a decision — a refused
 * value, a product that is gone — and repeating it would only repeat the answer.
 */
function isTransient(error: unknown): boolean {
  return isApiError(error) && (error.isNetworkError || error.status >= 500);
}

function messageOf(error: unknown): string {
  if (isApiError(error)) return error.serverMessage ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Finds the product this capture belongs to, creating it if the catalogue does
 * not have the EAN yet.
 *
 * The interesting case is the one in the middle: the EAN exists, and the
 * capture carries product data as well. Whoever entered it first wins — an
 * offline note from the shelf does not get to overwrite what the household has
 * agreed on since. What the capture carries beyond that (rating, price, photo)
 * is added all the same, which is the whole point of keeping it.
 */
async function resolveProduct(capture: Capture): Promise<string> {
  if (capture.progress.productId !== null) return capture.progress.productId;

  try {
    const { product } = await api.products.byEan(capture.ean);
    return product.id;
  } catch (error) {
    if (!isApiError(error) || error.status !== 404) throw error;
  }

  if (capture.product === null) {
    throw new ApiError({
      status: 404,
      code: 'not_found',
      serverMessage: 'the product this capture belongs to does not exist any more',
    });
  }

  try {
    const { product } = await api.products.create({ ean: capture.ean, ...capture.product });
    return product.id;
  } catch (error) {
    // Somebody else entered the same EAN between the lookup and the create.
    if (isApiError(error) && error.status === 409 && typeof error.details?.productId === 'string') {
      return error.details.productId;
    }
    throw error;
  }
}

/**
 * The rating on the server, if it is newer than the one that was captured.
 *
 * This is the conflict: the same account rated the same product somewhere else
 * after this capture was written down. Neither verdict is obviously right —
 * the one at the shelf may be the fresher impression, the one at home may be
 * the considered correction — so the answer is not "last write wins" but a
 * question to the person who gave both.
 */
async function findRatingConflict(
  capture: Capture,
  productId: string,
): Promise<CaptureConflict | null> {
  if (capture.rating === null) return null;

  const { product } = await api.products.get(productId);
  const own = product.ownRating;
  if (own === null) return null;

  const serverMoment = Date.parse(own.updatedAt);
  if (Number.isNaN(serverMoment) || serverMoment <= capture.rating.capturedAt) return null;

  return {
    serverStars: own.stars,
    serverComment: own.comment,
    serverUpdatedAt: own.updatedAt,
  };
}

/** Pushes one capture as far as it gets. Returns the state it ended in. */
async function syncCapture(capture: Capture): Promise<Capture['state']> {
  let current = capture;

  const advance = async (progress: Partial<Capture['progress']>): Promise<void> => {
    current = await saveCapture({
      ...current,
      progress: { ...current.progress, ...progress },
    });
  };

  const productId = await resolveProduct(current);
  if (current.progress.productId !== productId) await advance({ productId });

  if (current.price !== null && !current.progress.price) {
    await api.prices.add(productId, {
      cents: current.price.cents,
      shop: current.price.shop,
      note: current.price.note,
      purchasedAt: current.price.purchasedAt,
    });
    await advance({ price: true });
  }

  // Photos in order, counting up as each one lands: an upload that dies
  // halfway through the third picture must not re-send the first two.
  while (current.progress.photos < current.photos.length) {
    const photo = current.photos[current.progress.photos];
    if (photo === undefined) break;

    await api.photos.upload(productId, photo.blob, { filename: photo.filename });
    await advance({ photos: current.progress.photos + 1 });
  }

  if (current.rating !== null && !current.progress.rating) {
    const conflict = await findRatingConflict(current, productId);
    if (conflict !== null) {
      await saveCapture({ ...current, state: 'conflict', conflict, lastError: null });
      return 'conflict';
    }

    await api.ratings.upsert(productId, {
      stars: current.rating.stars,
      comment: current.rating.comment,
    });
    await advance({ rating: true });
  }

  await removeCapture(current.id);
  return 'pending';
}

/**
 * Works through the queue once, oldest capture first.
 *
 * Order matters between captures as well: two captures of the same EAN — the
 * product from the shelf, the photo from the till — have to arrive in the order
 * they were made, or the second one creates what the first one already did.
 *
 * A capture waiting for a decision is skipped rather than retried; so is one
 * the server refused, until somebody presses the button.
 */
export async function syncCaptures(): Promise<SyncResult> {
  let captures: Capture[];
  try {
    captures = await listCaptures();
  } catch {
    // No IndexedDB — a private window, or storage switched off. Nothing was
    // ever queued in that case either.
    return EMPTY_RESULT;
  }

  const result: SyncResult = { ...EMPTY_RESULT };

  for (const capture of captures) {
    if (capture.state !== 'pending') {
      if (capture.state === 'conflict') result.conflicts += 1;
      else result.failed += 1;
      continue;
    }

    try {
      const state = await syncCapture(capture);
      if (state === 'conflict') result.conflicts += 1;
      else result.synced += 1;
    } catch (error) {
      const transient = isTransient(error);

      await saveCapture({
        ...capture,
        state: transient ? 'pending' : 'failed',
        attempts: capture.attempts + 1,
        lastError: messageOf(error),
      });

      if (transient) {
        result.pending += 1;
        // The connection is gone; the rest of the queue would only produce the
        // same failure and burn attempts on it.
        break;
      }

      result.failed += 1;
    }
  }

  return result;
}

/* --------------------------------------------------------- conflicts */

/**
 * Keeps what was captured offline: the queued rating is pushed over the newer
 * one on the server.
 *
 * The capture is stamped with the current moment, so the comparison that found
 * the conflict cannot find it a second time — the decision has been made.
 */
export async function keepCapturedRating(capture: Capture): Promise<void> {
  if (capture.rating === null) return;

  await saveCapture({
    ...capture,
    state: 'pending',
    conflict: null,
    lastError: null,
    rating: { ...capture.rating, capturedAt: Date.now() },
  });
}

/**
 * Keeps the rating that is on the server and drops the captured one. Whatever
 * else the capture carries still goes up; if there is nothing else, it leaves
 * the queue.
 */
export async function discardCapturedRating(capture: Capture): Promise<void> {
  const rest =
    capture.product !== null ||
    capture.price !== null ||
    capture.photos.length > capture.progress.photos;

  if (!rest) {
    await removeCapture(capture.id);
    return;
  }

  await saveCapture({
    ...capture,
    state: 'pending',
    conflict: null,
    lastError: null,
    rating: null,
    progress: { ...capture.progress, rating: true },
  });
}

/** Puts a refused capture back in line, for when the cause has been dealt with. */
export async function retryCapture(capture: Capture): Promise<void> {
  await saveCapture({ ...capture, state: 'pending', lastError: null });
}
