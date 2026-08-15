import { vi, type Mock } from 'vitest';

/**
 * A `fetch` that answers from a table instead of from the network.
 *
 * Screens are tested through the real API client and the real query cache — the
 * only thing replaced is the transport. That way a test also covers the pieces
 * in between: the JSON envelope, the error translation and the cache defaults.
 *
 * An unexpected request is an error rather than a `404`, because it almost
 * always means the screen asks for something the test did not intend.
 */

export interface FetchRoute {
  /** Matched as a substring of the URL, e.g. `/auth/me`. */
  path: string;
  /** Defaults to `GET`. */
  method?: string;
  /** Defaults to `200`. */
  status?: number;
  body?: unknown;
  /** Set to let the request fail the way a broken connection does. */
  networkError?: boolean;
}

export function mockFetch(routes: readonly FetchRoute[]): Mock {
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    const route = routes.find(
      (entry) => url.includes(entry.path) && (entry.method ?? 'GET').toUpperCase() === method,
    );

    if (route === undefined) {
      return Promise.reject(new Error(`unexpected request in test: ${method} ${url}`));
    }
    if (route.networkError === true) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }

    const status = route.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(route.body ?? {}),
    } as Response);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A logged in account, as `GET /api/v1/auth/me` would answer it. */
export const testUser = {
  id: 'user-1',
  username: 'anna',
  email: null,
  role: 'user',
  createdAt: '2026-08-01T10:00:00.000Z',
  disabledAt: null,
} as const;
