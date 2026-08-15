import { PHOTO_FIELD } from '@product-rating/shared';
import type {
  ChangePasswordInput,
  CreateInviteInput,
  CreateProductInput,
  CreateUserInput,
  Invite,
  LoginInput,
  Photo,
  PhotoSize,
  Product,
  ProductDetail,
  ProductListPage,
  ProductSortField,
  Rating,
  RatingListPage,
  RatingSortField,
  RatingSummary,
  RegisterInput,
  ResetPasswordInput,
  SessionInfo,
  SortOrder,
  UpdateProductInput,
  UpdateUserInput,
  UpsertRatingInput,
  User,
} from '@product-rating/shared';
import { apiErrorText } from '@/lib/strings';

/**
 * The typed client for `/api/v1`.
 *
 * Everything that talks to the server goes through `request()`: it is the one
 * place that knows about credentials, the JSON envelope and — most of all —
 * how a failure becomes an `ApiError` with a German sentence in it. Screens
 * therefore never inspect a status code, they render `error.message`.
 *
 * The client is deliberately a thin mapping of the routes rather than a layer
 * with its own opinions: caching belongs to TanStack Query (`queries.ts`),
 * validation to the shared zod schemas.
 */

/** Same origin as the app; the Vite dev server proxies it to the API. */
export const API_BASE = '/api/v1';

/** The error envelope every failing route answers with. */
interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

interface ApiErrorInit {
  status: number;
  code: string;
  details?: Record<string, unknown> | undefined;
  /** The server's own English wording — for the console, never for the screen. */
  serverMessage?: string | undefined;
  cause?: unknown;
}

/**
 * A failed request, with a message that can be shown to a user.
 *
 * A request that never reached the server is one of these too, with `status: 0`
 * and the code `network_error` — a screen should not have to tell a refused
 * connection from a rejected one.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly serverMessage: string | undefined;

  constructor(init: ApiErrorInit) {
    super(apiErrorText(init.status, init.code, init.details), { cause: init.cause });
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.serverMessage = init.serverMessage;
  }

  /** True for anything the client itself could not send off. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** True while the session is missing or no longer valid. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  static network(cause: unknown): ApiError {
    return new ApiError({ status: 0, code: 'network_error', cause });
  }

  /**
   * Reads the error envelope out of a response. A proxy answering with HTML
   * has no envelope, which is why the parse failure is swallowed: the status
   * alone is enough for a usable message.
   */
  static async fromResponse(response: Response): Promise<ApiError> {
    let code = 'unknown_error';
    let serverMessage: string | undefined;
    let details: Record<string, unknown> | undefined;

    try {
      const body = (await response.json()) as ErrorBody;
      if (body.error !== undefined) {
        code = body.error.code ?? code;
        serverMessage = body.error.message;
        details = body.error.details;
      }
    } catch {
      // Not JSON — keep the status and move on.
    }

    return new ApiError({ status: response.status, code, details, serverMessage });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** The sentence to show for any thrown value, error or not. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  return apiErrorText(0, 'unknown_error');
}

type QueryValue = string | number | boolean | undefined;

/** Builds a query string, leaving out everything that is not set. */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as a JSON body; mutually exclusive with `body`. */
  json?: unknown;
  /** Sent as is — `FormData` for the photo upload, which sets its own type. */
  body?: BodyInit;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', json, body, signal } = options;

  const headers: Record<string, string> = { accept: 'application/json' };
  let payload = body;

  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(json);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      // The session lives in a cookie of this very origin; nothing is ever
      // sent to a third party, so `same-origin` is the honest setting.
      credentials: 'same-origin',
      ...(payload === undefined ? {} : { body: payload }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    // An aborted request is a decision of the caller, not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw ApiError.network(error);
  }

  if (!response.ok) throw await ApiError.fromResponse(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

const path = (...segments: string[]): string =>
  segments.map((segment) => encodeURIComponent(segment)).join('/');

/** Query of `GET /api/v1/products`; every parameter may be left out. */
export type ProductListParams = {
  q?: string | undefined;
  category?: string | undefined;
  minStars?: number | undefined;
  ratedByMe?: boolean | undefined;
  sort?: ProductSortField | undefined;
  order?: SortOrder | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
};

/** Query of `GET /api/v1/ratings/mine`. */
export type MyRatingsParams = {
  sort?: RatingSortField | undefined;
  order?: SortOrder | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
};

export const api = {
  auth: {
    me: (signal?: AbortSignal) =>
      request<{ user: User }>('/auth/me', signal === undefined ? {} : { signal }),

    login: (input: LoginInput) =>
      request<{ user: User }>('/auth/login', { method: 'POST', json: input }),

    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

    register: (input: RegisterInput) =>
      request<{ user: User }>('/auth/register', { method: 'POST', json: input }),

    changePassword: (input: ChangePasswordInput) =>
      request<{ ok: true; revokedSessions: number }>('/auth/password', {
        method: 'POST',
        json: input,
      }),

    sessions: () => request<{ sessions: SessionInfo[] }>('/auth/sessions'),

    revokeSession: (id: string) =>
      request<{ ok: true }>(`/${path('auth', 'sessions', id)}`, { method: 'DELETE' }),

    /** Revokes every session except the one making the request. */
    revokeOtherSessions: () => request<{ revoked: number }>('/auth/sessions', { method: 'DELETE' }),
  },

  products: {
    list: (params: ProductListParams = {}) =>
      request<ProductListPage>(`/products${buildQuery(params)}`),

    get: (id: string) => request<{ product: ProductDetail }>(`/${path('products', id)}`),

    /** Lookup after a scan; answers `404` for an EAN nobody has entered yet. */
    byEan: (ean: string) =>
      request<{ product: ProductDetail }>(`/${path('products', 'by-ean', ean)}`),

    create: (input: CreateProductInput) =>
      request<{ product: Product }>('/products', { method: 'POST', json: input }),

    update: (id: string, input: UpdateProductInput) =>
      request<{ product: Product }>(`/${path('products', id)}`, { method: 'PATCH', json: input }),

    /** Administrators only; takes ratings, photos and their files with it. */
    remove: (id: string) =>
      request<{ ok: true; removedRatings: number; removedPhotos: number }>(
        `/${path('products', id)}`,
        { method: 'DELETE' },
      ),
  },

  ratings: {
    /** Creates or replaces the caller's own rating of a product. */
    upsert: (productId: string, input: UpsertRatingInput) =>
      request<{ rating: Rating; ratings: RatingSummary }>(
        `/${path('products', productId, 'rating')}`,
        { method: 'PUT', json: input },
      ),

    remove: (productId: string) =>
      request<{ ok: true; ratings: RatingSummary }>(`/${path('products', productId, 'rating')}`, {
        method: 'DELETE',
      }),

    mine: (params: MyRatingsParams = {}) =>
      request<RatingListPage>(`/ratings/mine${buildQuery(params)}`),
  },

  photos: {
    /**
     * Uploads one image. Progress reporting needs `XMLHttpRequest` and arrives
     * with the upload screen in M8; `fetch` cannot report it.
     */
    upload: (productId: string, file: Blob, filename?: string) => {
      const form = new FormData();
      if (filename === undefined) form.append(PHOTO_FIELD, file);
      else form.append(PHOTO_FIELD, file, filename);

      return request<{ photo: Photo }>(`/${path('products', productId, 'photos')}`, {
        method: 'POST',
        body: form,
      });
    },

    remove: (id: string) => request<{ ok: true }>(`/${path('photos', id)}`, { method: 'DELETE' }),

    setPrimary: (id: string) =>
      request<{ photo: Photo }>(`/${path('photos', id, 'primary')}`, { method: 'PUT' }),

    /**
     * Source for an `<img>`. The route wants a session, which the browser
     * attaches by itself because the URL is same origin.
     */
    url: (id: string, size: PhotoSize = 'full') =>
      `${API_BASE}/${path('media', id)}${buildQuery({ size })}`,
  },

  invites: {
    list: () => request<{ invites: Invite[] }>('/invites'),

    create: (input: CreateInviteInput = {}) =>
      request<{ invite: Invite }>('/invites', { method: 'POST', json: input }),

    revoke: (code: string) =>
      request<{ ok: true }>(`/${path('invites', code)}`, { method: 'DELETE' }),
  },

  users: {
    list: () => request<{ users: User[] }>('/users'),

    create: (input: CreateUserInput) =>
      request<{ user: User }>('/users', { method: 'POST', json: input }),

    update: (id: string, input: UpdateUserInput) =>
      request<{ user: User }>(`/${path('users', id)}`, { method: 'PATCH', json: input }),

    resetPassword: (id: string, input: ResetPasswordInput) =>
      request<{ ok: true; revokedSessions: number }>(`/${path('users', id, 'password')}`, {
        method: 'POST',
        json: input,
      }),
  },
};
