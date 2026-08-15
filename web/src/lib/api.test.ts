import { describe, expect, it, vi } from 'vitest';
import { api, buildQuery, errorMessage, isApiError, type ApiError } from '@/lib/api';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { mockUpload } from '@/testing/xhrMock';

describe('buildQuery', () => {
  it('leaves out what is not set', () => {
    expect(buildQuery({ q: 'milch', category: undefined, minStars: 3, ratedByMe: true })).toBe(
      '?q=milch&minStars=3&ratedByMe=true',
    );
  });

  it('is empty when nothing is set', () => {
    expect(buildQuery({ cursor: undefined })).toBe('');
  });

  it('escapes values', () => {
    expect(buildQuery({ q: 'a&b c' })).toBe('?q=a%26b+c');
  });
});

describe('request', () => {
  it('sends JSON with the session cookie', async () => {
    const fetchMock = mockFetch([
      { path: '/auth/login', method: 'POST', body: { user: testUser } },
    ]);

    const result = await api.auth.login({ username: 'anna', password: 'geheim' });

    expect(result.user.username).toBe('anna');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ username: 'anna', password: 'geheim' }));
  });

  it('puts list parameters into the query string', async () => {
    const fetchMock = mockFetch([
      { path: '/products', body: { products: [], nextCursor: null, total: 0 } },
    ]);

    await api.products.list({ q: 'käse', minStars: 4 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/products?q=k%C3%A4se&minStars=4');
  });

  it('escapes path segments', async () => {
    const fetchMock = mockFetch([{ path: '/products/', body: { product: {} } }]);

    await api.products.get('a/b');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/products/a%2Fb');
  });

  it('does not send a body without one', async () => {
    const fetchMock = mockFetch([{ path: '/auth/logout', method: 'POST', body: { ok: true } }]);

    await api.auth.logout();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });
});

describe('photo upload', () => {
  it('sends multipart without setting the type itself', async () => {
    const upload = mockUpload();

    const pending = api.photos.upload('p1', new Blob(['x'], { type: 'image/jpeg' }), {
      filename: 'IMG_4711.HEIC',
    });
    upload().respond(201, { photo: { id: 'ph1' } });

    await expect(pending).resolves.toEqual({ photo: { id: 'ph1' } });
    expect(upload().method).toBe('POST');
    expect(upload().url).toBe('/api/v1/products/p1/photos');
    expect(upload().body).toBeInstanceOf(FormData);
    // The boundary is the browser's job; a hand written header would break it.
    expect(upload().headers['content-type']).toBeUndefined();
  });

  it('reports progress as a share of the body', async () => {
    const upload = mockUpload();
    const seen: number[] = [];

    const pending = api.photos.upload('p1', new Blob(['x']), {
      onProgress: (fraction) => seen.push(fraction),
    });

    upload().emitProgress(50, 200);
    upload().emitProgress(200, 200);
    upload().respond(201, { photo: {} });
    await pending;

    expect(seen).toEqual([0.25, 1]);
  });

  it('translates a rejected upload like any other failure', async () => {
    const upload = mockUpload();

    const pending = api.photos.upload('p1', new Blob(['x']));
    upload().respond(413, { error: { code: 'payload_too_large', message: 'too big' } });

    const error = await pending.catch((thrown: unknown) => thrown);
    expect((error as ApiError).status).toBe(413);
    expect((error as ApiError).message).toBe(strings.errors.tooLarge);
  });

  it('turns a broken connection during the upload into a network error', async () => {
    const upload = mockUpload();

    const pending = api.photos.upload('p1', new Blob(['x']));
    upload().fail();

    const error = await pending.catch((thrown: unknown) => thrown);
    expect((error as ApiError).isNetworkError).toBe(true);
  });

  it('aborts when the signal is aborted', async () => {
    const upload = mockUpload();
    const controller = new AbortController();

    const pending = api.photos.upload('p1', new Blob(['x']), { signal: controller.signal });
    controller.abort();

    const error = await pending.catch((thrown: unknown) => thrown);
    expect((error as DOMException).name).toBe('AbortError');
    expect(upload().aborted).toBe(true);
  });
});

describe('ApiError', () => {
  it('translates an expired session', async () => {
    mockFetch([
      { path: '/auth/me', status: 401, body: { error: { code: 'unauthorized', message: 'nope' } } },
    ]);

    const error = await api.auth.me().catch((thrown: unknown) => thrown);

    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).isUnauthorized).toBe(true);
    expect((error as ApiError).message).toBe(strings.errors.unauthorized);
    // The English original stays available for the console.
    expect((error as ApiError).serverMessage).toBe('nope');
  });

  it('names the taken username behind a conflict', async () => {
    mockFetch([
      {
        path: '/auth/register',
        method: 'POST',
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'username is already taken',
            details: { field: 'username' },
          },
        },
      },
    ]);

    const error = await api.auth
      .register({ username: 'anna', password: 'x', invite: 'A1B2-C3D4-E5F6' })
      .catch((thrown: unknown) => thrown);

    expect((error as ApiError).message).toBe(strings.errors.usernameTaken);
    expect((error as ApiError).details).toEqual({ field: 'username' });
  });

  it('passes on the minimum password length', async () => {
    mockFetch([
      {
        path: '/auth/register',
        method: 'POST',
        status: 400,
        body: {
          error: {
            code: 'invalid_request',
            message: 'password must be at least 12 characters long',
            details: { field: 'password', minimum: 12 },
          },
        },
      },
    ]);

    const error = await api.auth
      .register({ username: 'anna', password: 'x', invite: 'A1B2-C3D4-E5F6' })
      .catch((thrown: unknown) => thrown);

    expect((error as ApiError).message).toBe(strings.errors.passwordTooShort(12));
  });

  it('says how long the rate limit lasts', async () => {
    mockFetch([
      {
        path: '/auth/login',
        method: 'POST',
        status: 429,
        body: {
          error: {
            code: 'rate_limited',
            message: 'too many attempts',
            details: { retryAfterSeconds: 42 },
          },
        },
      },
    ]);

    const error = await api.auth
      .login({ username: 'anna', password: 'x' })
      .catch((thrown: unknown) => thrown);

    expect((error as ApiError).message).toBe(strings.errors.rateLimited(42));
  });

  it('survives an answer that is not JSON', async () => {
    // A reverse proxy answering with its own HTML error page.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          text: () => Promise.resolve('<html><body>Bad Gateway</body></html>'),
        } as unknown as Response),
      ),
    );

    const error = await api.auth.me().catch((thrown: unknown) => thrown);

    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toBe(strings.errors.server);
  });

  it('turns a broken connection into an error with a message', async () => {
    mockFetch([{ path: '/auth/me', networkError: true }]);

    const error = await api.auth.me().catch((thrown: unknown) => thrown);

    expect((error as ApiError).isNetworkError).toBe(true);
    expect((error as ApiError).message).toBe(strings.errors.network);
  });

  it('lets an aborted request through as an abort', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))),
    );

    const error = await api.auth.me(controller.signal).catch((thrown: unknown) => thrown);

    expect(isApiError(error)).toBe(false);
    expect((error as DOMException).name).toBe('AbortError');
  });
});

describe('errorMessage', () => {
  it('falls back to a general sentence for anything that is not an ApiError', () => {
    expect(errorMessage(new Error('boom'))).toBe(strings.errors.unknown);
  });
});

describe('media URLs', () => {
  it('addresses a size and escapes the id', () => {
    expect(api.photos.url('ph 1', 'thumb')).toBe('/api/v1/media/ph%201?size=thumb');
    expect(api.photos.url('ph1')).toBe('/api/v1/media/ph1?size=full');
  });
});
