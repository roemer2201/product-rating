import { captureOwner } from '@/lib/captureIdentity';

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
 *
 * Everything below treats "it is saved" as a statement about the disk, not
 * about the object store: a write resolves when its transaction has committed
 * (`withStore`) and the storage is marked as persistent (below), because the
 * queue is read again after the app has been killed, which on iOS happens the
 * moment somebody swipes it out of the app switcher.
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
  variant: string | null;
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
  /** Missing on legacy captures; never inferred when syncing. */
  ownerId?: string | null;
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

/**
 * Runs one transaction and resolves once it has **committed**.
 *
 * The distinction matters more than it looks. `request.onsuccess` fires as soon
 * as the store has taken the value, which is well before the transaction is on
 * disk; resolving there reports "saved" for something that is still only in
 * memory. On an iOS home screen app that is not a theoretical window: swiping
 * the app out of the switcher kills the process outright, and everything that
 * had not committed yet is gone — while the interface had already counted it.
 * So the result of the request is put aside and handed out by `oncomplete`.
 *
 * `durability: 'strict'` for writes on top of that, because the default
 * (`relaxed`) lets the browser report a commit before the bytes have reached
 * the file system. That costs a moment per capture and buys the one property
 * this queue exists for: what it says it kept, it kept. Older engines ignore
 * the options argument, which is the same behaviour as before.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction =
      mode === 'readwrite'
        ? db.transaction(STORE, mode, { durability: 'strict' })
        : db.transaction(STORE, mode);

    let result: T;
    const request = work(transaction.objectStore(STORE));

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      reject(request.error ?? new Error('the offline queue could not be read'));
    };

    transaction.oncomplete = () => {
      resolve(result);
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('the offline queue could not be written'));
    };
  });
}

/**
 * Asks the browser to treat this storage as worth keeping.
 *
 * Without it the queue is "best effort": WebKit may throw the storage of a site
 * away when the device runs short of space, and clears it altogether after
 * seven days without a visit. A capture is somebody standing in a shop with no
 * signal, so it is exactly the kind of data that must not be evicted to make
 * room for a cache. A home screen app is usually granted this without asking;
 * a browser tab may refuse, and there is nothing to do about that but carry on.
 *
 * Asked once per session, on the first write — before that there is nothing to
 * protect.
 */
let persistence: Promise<boolean> | null = null;

export function requestPersistentStorage(): Promise<boolean> {
  persistence ??= (async () => {
    if (typeof navigator === 'undefined' || navigator.storage === undefined) return false;

    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      // Storage is switched off, or the engine has the API but not the
      // permission behind it. The queue works either way.
      return false;
    }
  })();

  return persistence;
}

/** True when this browser can hold a queue at all. */
export function offlineQueueAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * The stamp handed out last.
 *
 * Two captures written within the same millisecond would otherwise share their
 * `createdAt`. The sort in `listCaptures` is stable, so equal stamps keep the
 * order the store hands the records over in - and that is the order of the
 * identifiers, which are random. Scanning two articles in one go was enough to
 * hit it. A strictly increasing stamp makes "oldest first" a promise instead of
 * a likelihood.
 */
let lastCreatedAt = 0;

/** The current time, but never the same value twice, and never going backwards. */
function nextCreatedAt(): number {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return lastCreatedAt;
}

/**
 * Puts a capture into the queue, oldest first when it comes back out.
 *
 * The identifier is generated here rather than by the store, so the caller can
 * refer to what it just wrote without a second read.
 */
export async function enqueueCapture(input: NewCapture): Promise<Capture> {
  const now = nextCreatedAt();

  const capture: Capture = {
    id: crypto.randomUUID(),
    ownerId: captureOwner(),
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

  // Not awaited: whether the browser grants persistence changes nothing about
  // this write, and on a cold start the permission prompt of some engines would
  // otherwise sit in front of the capture the person is trying to save.
  void requestPersistentStorage();

  await withStore('readwrite', (store) => store.put(capture));
  return capture;
}

/** Everything in the queue, oldest capture first. */
export async function listCaptures(ownerId: string | null = captureOwner()): Promise<Capture[]> {
  const all = await withStore<Capture[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<Capture[]>,
  );
  return all
    .filter((capture) => (capture.ownerId ?? null) === ownerId)
    .sort((left, right) => left.createdAt - right.createdAt);
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
  return (await listCaptures()).length;
}

/** Only used by the tests, which want a store with nothing in it. */
export async function clearCaptures(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
}

/** Explicitly adopts a legacy/unassigned capture after the user confirms it. */
export async function assignCapture(id: string, ownerId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
    const store = tx.objectStore(STORE);
    const request = store.get(id) as IDBRequest<Capture | undefined>;
    request.onsuccess = () => {
      const capture = request.result;
      if (capture !== undefined && capture.ownerId == null) store.put({ ...capture, ownerId });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
