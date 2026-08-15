import { vi } from 'vitest';

/**
 * A stand-in for `XMLHttpRequest`, which the photo upload uses because `fetch`
 * cannot report how far a request body has got.
 *
 * The fake records what was sent and lets the test drive it: `emitProgress()`
 * moves the bar, `respond()` finishes the request, `fail()` breaks the
 * connection. Nothing happens on its own, so a test can assert on the state
 * halfway through — which is the whole reason the upload has a progress bar.
 */

type Listener = (event: Event) => void;

export class FakeUpload {
  status = 0;
  response = '';
  responseType = '';

  method = '';
  url = '';
  body: FormData | null = null;
  readonly headers: Record<string, string> = {};
  aborted = false;

  private readonly listeners = new Map<string, Listener[]>();
  private readonly uploadListeners = new Map<string, Listener[]>();

  /** The `xhr.upload` object the client attaches its progress listener to. */
  readonly upload = {
    addEventListener: (type: string, listener: Listener): void => {
      this.add(this.uploadListeners, type, listener);
    },
  };

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  addEventListener(type: string, listener: Listener): void {
    this.add(this.listeners, type, listener);
  }

  send(body: FormData | null): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.emit(this.listeners, 'abort');
  }

  /* --- the side a test drives ------------------------------------------- */

  emitProgress(loaded: number, total: number): void {
    for (const listener of this.uploadListeners.get('progress') ?? []) {
      listener(new ProgressEvent('progress', { lengthComputable: true, loaded, total }));
    }
  }

  respond(status: number, body: unknown): void {
    this.status = status;
    this.response = typeof body === 'string' ? body : JSON.stringify(body);
    this.emit(this.listeners, 'load');
  }

  fail(): void {
    this.emit(this.listeners, 'error');
  }

  private add(map: Map<string, Listener[]>, type: string, listener: Listener): void {
    map.set(type, [...(map.get(type) ?? []), listener]);
  }

  private emit(map: Map<string, Listener[]>, type: string): void {
    for (const listener of map.get(type) ?? []) listener(new Event(type));
  }
}

/**
 * Replaces `XMLHttpRequest` for the duration of a test. The returned function
 * yields the request that was started last; asking before anything was sent is
 * a test that does not do what it thinks it does, so it throws.
 */
export function mockUpload(): () => FakeUpload {
  let current: FakeUpload | null = null;

  // A function declaration rather than an arrow: the client says
  // `new XMLHttpRequest()`, and only a constructible value survives that.
  // Returning an object from a constructor call makes it the result.
  vi.stubGlobal('XMLHttpRequest', function createFakeUpload(): FakeUpload {
    current = new FakeUpload();
    return current;
  });

  return () => {
    if (current === null) throw new Error('no upload was started');
    return current;
  };
}
