/**
 * What was recorded while the phone had no connection, until it reaches the
 * server.
 *
 * The unit is a **capture**, not an API call: "I stood in front of this article
 * and this is what I have to say about it" — the EAN, optionally the product
 * data, a rating, a price and photos. The catalogue is not readable offline
 * (the service worker deliberately caches the app, not the data), so a device
 * without a connection cannot know whether an EAN already exists. Recording the
 * intention instead of the request is what makes that question answerable
 * later: at sync time the EAN is looked up, and only then does it turn into
 * "create a product" or "add to the one that is there".
 *
 * IndexedDB rather than `localStorage`, for one reason above all: photos.
 * A `Blob` survives here as bytes, while `localStorage` would need base64 in a
 * few megabytes of string quota.
 */

const DATABASE_NAME = 'product-rating-offline';
const DATABASE_VERSION = 1;
const STORE = 'captures';

/**
 * `pending` waits for the next sync, `conflict` waits for a person to decide,
 * `failed` waits for one to look at it — a rejected capture is never dropped
 * silently, because it is somebody's work.
 */
export type CaptureState = 'pending' | 'conflict' | 'failed';

export interface CapturedProduct {
  name: string;
  brand: string | null;
  category: string | null;
  notes: string | null;
}

export interface CapturedRating {
  stars: number;
  comment: string | null;
  /** When the verdict was given; the yardstick for the conflict check. */
  capturedAt: number;
}

export interface CapturedPrice {
  cents: number;
  shop: string | null;
  note: string | null;
  purchasedAt: string;
}

export interface CapturedPhoto {
  blob: Blob;
  filename: string;
}

/** The rating that was on the server when a conflict was found. */
export interface CaptureConflict {
  serverStars: number;
  serverComment: string | null;
  serverUpdatedAt: string;
}

/**
 * What has already reached the server.
 *
 * A capture can be half applied — the product created, the photo still to
 * come — and the next attempt has to pick up where the last one stopped. Ratings
 * and products are idempotent anyway, prices and photos are not: without this,
 * a retry would record the same price twice.
 */
export interface CaptureProgress {
  productId: string | null;
  rating: boolean;
  price: boolean;
  /** How many of the photos are up; they are uploaded in order. */
  photos: number;
}

export interface Capture {
  id: string;
  /** Normalised EAN-13 — the one thing every capture has. */
  ean: string;
  /** What to call it in a list before a product exists. */
  label: string;
  createdAt: number;
  updatedAt: number;
  state: CaptureState;
  attempts: number;
  lastError: string | null;
  product: CapturedProduct | null;
  rating: CapturedRating | null;
  price: CapturedPrice | null;
  photos: CapturedPhoto[];
  progress: CaptureProgress;
  conflict: CaptureConflict | null;
}

export interface NewCapture {
  ean: string;
  label: string;
  product?: CapturedProduct | null;
  rating?: CapturedRating | null;
  price?: CapturedPrice | null;
  photos?: CapturedPhoto[];
}

/* ------------------------------------------------------------- storage */

let connection: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      // A browser in private mode, or one where storage is switched off. The
      // caller turns this into "it could not be saved" rather than crashing.
      reject(request.error ?? new Error('IndexedDB is not available'));
    };
  });

  return connection;
}

/** Runs one transaction and resolves with what the request produced. */
async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('the offline queue could not be read'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('the offline queue could not be written'));
    };
  });
}

/** True when this browser can hold a queue at all. */
export function offlineQueueAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Puts a capture into the queue, oldest first when it comes back out.
 *
 * The identifier is generated here rather than by the store, so the caller can
 * refer to what it just wrote without a second read.
 */
export async function enqueueCapture(input: NewCapture): Promise<Capture> {
  const now = Date.now();

  const capture: Capture = {
    id: crypto.randomUUID(),
    ean: input.ean,
    label: input.label,
    createdAt: now,
    updatedAt: now,
    state: 'pending',
    attempts: 0,
    lastError: null,
    product: input.product ?? null,
    rating: input.rating ?? null,
    price: input.price ?? null,
    photos: input.photos ?? [],
    progress: { productId: null, rating: false, price: false, photos: 0 },
    conflict: null,
  };

  await withStore('readwrite', (store) => store.put(capture));
  return capture;
}

/** Everything in the queue, oldest capture first. */
export async function listCaptures(): Promise<Capture[]> {
  const all = await withStore<Capture[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<Capture[]>,
  );
  return all.sort((left, right) => left.createdAt - right.createdAt);
}

export async function getCapture(id: string): Promise<Capture | undefined> {
  return withStore<Capture | undefined>(
    'readonly',
    (store) => store.get(id) as IDBRequest<Capture | undefined>,
  );
}

/** Writes a capture back, stamping the time it last changed. */
export async function saveCapture(capture: Capture): Promise<Capture> {
  const updated: Capture = { ...capture, updatedAt: Date.now() };
  await withStore('readwrite', (store) => store.put(updated));
  return updated;
}

export async function removeCapture(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

/** Number of captures waiting, for the badge in the interface. */
export async function countCaptures(): Promise<number> {
  return withStore<number>('readonly', (store) => store.count());
}

/** Only used by the tests, which want a store with nothing in it. */
export async function clearCaptures(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
}
