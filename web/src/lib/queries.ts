import {
  MutationCache,
  QueryCache,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ChangePasswordInput,
  CreateInviteInput,
  CreateProductInput,
  Invite,
  LoginInput,
  Photo,
  Product,
  ProductDetail,
  ProductListPage,
  Rating,
  RatingListPage,
  RatingSummary,
  RegisterInput,
  ResetPasswordInput,
  SessionInfo,
  TrashEntry,
  UpdateProductInput,
  UpdateUserInput,
  UpsertRatingInput,
  User,
} from '@product-rating/shared';
import {
  ApiError,
  api,
  type MyRatingsParams,
  type ProductListParams,
  type UploadOptions,
} from '@/lib/api';

/**
 * Server state: query keys, cache times and the hooks around the session.
 *
 * TanStack Query holds everything that comes from the server; React state is
 * left for what only the screen knows (a half filled form, an open dialog).
 * The keys live here rather than next to the screens so that a mutation in one
 * corner of the app can invalidate a list in another without importing it.
 *
 * Invalidation is coarse on purpose: a changed rating drops every product list
 * and every rating list rather than the entries that provably moved. A rating
 * changes an average, an average changes a sort order and two filters, and the
 * whole catalogue is a few hundred rows on a home server — the bookkeeping to
 * be precise about it would cost more than the requests it saves.
 */

/**
 * Cache times in milliseconds.
 *
 * The instance serves a handful of people on a home network, so the question is
 * not load but how stale a screen may look: the catalogue is shared and should
 * pick up someone else's change within seconds, own ratings only ever change on
 * this device, and who is logged in hardly changes at all.
 */
export const CACHE_TIMES = {
  /** Asked for by every screen, changes on login and logout only. */
  session: 5 * 60 * 1000,
  /** Shared catalogue: another household member may have just added something. */
  catalogue: 30 * 1000,
  /** Own ratings and own sessions: changed here, so a longer window is fine. */
  own: 60 * 1000,
  /** Administration lists are opened rarely and read once. */
  admin: 30 * 1000,
  /** How long unused data stays in memory before it is dropped. */
  unused: 10 * 60 * 1000,
} as const;

export const queryKeys = {
  session: ['session'] as const,
  ownSessions: ['sessions'] as const,
  products: {
    all: ['products'] as const,
    list: (params: ProductListParams) => ['products', 'list', params] as const,
    byId: (id: string) => ['products', 'detail', id] as const,
    byEan: (ean: string) => ['products', 'ean', ean] as const,
    categories: ['products', 'categories'] as const,
  },
  ratings: {
    all: ['ratings'] as const,
    mine: (params: MyRatingsParams) => ['ratings', 'mine', params] as const,
  },
  trash: ['trash'] as const,
  invites: ['invites'] as const,
  users: ['users'] as const,
};

/**
 * Builds the client with the defaults every query inherits.
 *
 * Two of them matter: a request that failed because the input was wrong is not
 * retried — repeating it would only produce the same `400` — and a `401`
 * anywhere in the app is written straight into the session query, which is what
 * makes `RequireAuth` send the user to the login screen instead of leaving a
 * screen full of failing requests behind.
 */
export function createQueryClient(): QueryClient {
  // Runs no earlier than the first failed request, by which time the client
  // below exists — the caches want the handler before they can be built.
  const onError = (error: unknown): void => {
    if (error instanceof ApiError && error.isUnauthorized) {
      client.setQueryData(queryKeys.session, null);
    }
  };

  const client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: CACHE_TIMES.catalogue,
        gcTime: CACHE_TIMES.unused,
        retry: (failureCount, error) => {
          // A refused input stays refused; a broken connection may recover.
          if (error instanceof ApiError && !error.isNetworkError && error.status < 500)
            return false;
          return failureCount < 2;
        },
        // The PWA is opened and put away all day; coming back should show
        // current data, and `staleTime` keeps that from meaning a request
        // every time the phone is unlocked.
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return client;
}

/**
 * The logged in account, or `null` when nobody is logged in.
 *
 * A missing session is a normal answer here, not an error: `401` becomes
 * `null`, so screens branch on data instead of picking a status out of an
 * error object.
 */
export function useSession(): UseQueryResult<User | null, Error> {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: async ({ signal }) => {
      try {
        const { user } = await api.auth.me(signal);
        return user;
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) return null;
        throw error;
      }
    },
    staleTime: CACHE_TIMES.session,
    gcTime: CACHE_TIMES.session,
    retry: false,
  });
}

export function useLogin(): UseMutationResult<User, Error, LoginInput> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: LoginInput) => (await api.auth.login(input)).user,
    onSuccess: (user) => {
      // Whatever is cached belongs to whoever was logged in before.
      client.clear();
      client.setQueryData(queryKeys.session, user);
    },
  });
}

export function useRegister(): UseMutationResult<User, Error, RegisterInput> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: RegisterInput) => (await api.auth.register(input)).user,
    onSuccess: (user) => {
      client.clear();
      client.setQueryData(queryKeys.session, user);
    },
  });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.auth.logout();
    },
    // Even a failed logout ends the session locally: the cookie may already be
    // gone, and leaving someone in front of a session they wanted rid of is
    // the worse outcome.
    onSettled: () => {
      client.clear();
      client.setQueryData(queryKeys.session, null);
    },
  });
}

/* ------------------------------------------------------------- catalogue */

/**
 * One page of the catalogue after another.
 *
 * The cursor comes from the previous page rather than from a counter: a product
 * someone else adds while the list is being scrolled cannot then push a row
 * onto the next page and make it appear twice.
 */
export function useProductList(
  params: ProductListParams,
): UseInfiniteQueryResult<{ pages: ProductListPage[] }, Error> {
  return useInfiniteQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: ({ pageParam, signal }) =>
      api.products.list(
        { ...params, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: CACHE_TIMES.catalogue,
  });
}

export function useProduct(id: string): UseQueryResult<ProductDetail, Error> {
  return useQuery({
    queryKey: queryKeys.products.byId(id),
    queryFn: async () => (await api.products.get(id)).product,
    staleTime: CACHE_TIMES.catalogue,
  });
}

/** The categories in use, for the suggestion list of the product form. */
export function useCategories(): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: queryKeys.products.categories,
    queryFn: async () => (await api.products.categories()).categories,
    // Suggestions may lag a little; a category added elsewhere is not urgent.
    staleTime: CACHE_TIMES.own,
  });
}

/**
 * Looks up a scanned EAN: the product, or `null` if the catalogue does not have
 * it yet.
 *
 * A mutation rather than a query, although it only reads. The scanner asks
 * exactly once, at a moment it chooses, and wants the answer in its hand to
 * decide where to go next — a query would answer through a re-render and leave
 * the screen to work out which of several states it is in. `404` is a normal
 * answer here: "not in the catalogue" is the question being asked.
 */
export function useEanLookup(): UseMutationResult<ProductDetail | null, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (ean: string) => {
      try {
        return (await api.products.byEan(ean)).product;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    onSuccess: (product) => {
      // The detail screen is the next stop; give it its data straight away.
      if (product !== null) client.setQueryData(queryKeys.products.byId(product.id), product);
    },
  });
}

export function useCreateProduct(): UseMutationResult<Product, Error, CreateProductInput> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateProductInput) => (await api.products.create(input)).product,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}

export function useUpdateProduct(
  id: string,
): UseMutationResult<Product, Error, UpdateProductInput> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateProductInput) => (await api.products.update(id, input)).product,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
    },
  });
}

/** Moves a product to the trash; an administrator can bring it back from there. */
export function useDeleteProduct(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.products.remove(id);
    },
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: queryKeys.products.byId(id) });
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
      void client.invalidateQueries({ queryKey: queryKeys.trash });
    },
  });
}

/* ----------------------------------------------------------------- trash */

export function useTrash(): UseQueryResult<TrashEntry[], Error> {
  return useQuery({
    queryKey: queryKeys.trash,
    queryFn: async () => (await api.trash.list()).entries,
    staleTime: CACHE_TIMES.admin,
  });
}

export function useRestoreProduct(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.trash.restore(id);
    },
    onSuccess: () => {
      // The product is part of the catalogue again, with everything on it.
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
      void client.invalidateQueries({ queryKey: queryKeys.trash });
    },
  });
}

export function usePurgeProduct(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.trash.purge(id);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.trash });
    },
  });
}

/* --------------------------------------------------------------- ratings */

export interface UpsertRatingVariables {
  productId: string;
  input: UpsertRatingInput;
}

export function useUpsertRating(): UseMutationResult<
  { rating: Rating; ratings: RatingSummary },
  Error,
  UpsertRatingVariables
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ productId, input }: UpsertRatingVariables) =>
      api.ratings.upsert(productId, input),
    onSuccess: (result, { productId }) => {
      // The open detail screen gets the new state without a round trip; the
      // lists behind it are refetched because an average moves sort and filter.
      client.setQueryData<ProductDetail>(queryKeys.products.byId(productId), (current) =>
        current === undefined
          ? current
          : { ...current, ownRating: result.rating, ratings: result.ratings },
      );
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
    },
  });
}

export function useDeleteRating(): UseMutationResult<{ ratings: RatingSummary }, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (productId: string) => api.ratings.remove(productId),
    onSuccess: (result, productId) => {
      client.setQueryData<ProductDetail>(queryKeys.products.byId(productId), (current) =>
        current === undefined ? current : { ...current, ownRating: null, ratings: result.ratings },
      );
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
    },
  });
}

/** The caller's own ratings, paged like the catalogue. */
export function useMyRatings(
  params: MyRatingsParams,
): UseInfiniteQueryResult<{ pages: RatingListPage[] }, Error> {
  return useInfiniteQuery({
    queryKey: queryKeys.ratings.mine(params),
    queryFn: ({ pageParam, signal }) =>
      api.ratings.mine(
        { ...params, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: CACHE_TIMES.own,
  });
}

/* ----------------------------------------------------------------- photos */

export interface UploadPhotoVariables {
  productId: string;
  file: Blob;
  options?: UploadOptions;
}

export function useUploadPhoto(): UseMutationResult<Photo, Error, UploadPhotoVariables> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ productId, file, options }: UploadPhotoVariables) =>
      (await api.photos.upload(productId, file, options ?? {})).photo,
    onSuccess: (_photo, { productId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.products.byId(productId) });
      // The card in the list shows the primary photo, which may have just
      // appeared for the first time.
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
    },
  });
}

export interface PhotoVariables {
  photoId: string;
  productId: string;
}

export function useDeletePhoto(): UseMutationResult<void, Error, PhotoVariables> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ photoId }: PhotoVariables) => {
      await api.photos.remove(photoId);
    },
    onSuccess: (_result, { productId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.products.byId(productId) });
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
    },
  });
}

export interface MovePhotoVariables extends PhotoVariables {
  position: number;
}

/**
 * Moves a photo inside the gallery. The answer is the whole new order, but the
 * detail query is refetched rather than patched: the gallery is small, and a
 * second device may have added a photo in the meantime.
 */
export function useMovePhoto(): UseMutationResult<Photo[], Error, MovePhotoVariables> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ photoId, position }: MovePhotoVariables) =>
      (await api.photos.move(photoId, position)).photos,
    onSuccess: (_photos, { productId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.products.byId(productId) });
      // Position zero is the picture on the card, so the lists move with it.
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
    },
  });
}

export function useSetPrimaryPhoto(): UseMutationResult<Photo, Error, PhotoVariables> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ photoId }: PhotoVariables) => (await api.photos.setPrimary(photoId)).photo,
    onSuccess: (_photo, { productId }) => {
      void client.invalidateQueries({ queryKey: queryKeys.products.byId(productId) });
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
      void client.invalidateQueries({ queryKey: queryKeys.ratings.all });
    },
  });
}

/* ---------------------------------------------------------------- account */

export function useOwnSessions(): UseQueryResult<SessionInfo[], Error> {
  return useQuery({
    queryKey: queryKeys.ownSessions,
    queryFn: async () => (await api.auth.sessions()).sessions,
    staleTime: CACHE_TIMES.own,
  });
}

export function useRevokeSession(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.auth.revokeSession(id);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.ownSessions });
    },
  });
}

export function useChangePassword(): UseMutationResult<
  { revokedSessions: number },
  Error,
  ChangePasswordInput
> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.auth.changePassword(input),
    onSuccess: () => {
      // Changing the password ends every other session; the list has changed.
      void client.invalidateQueries({ queryKey: queryKeys.ownSessions });
    },
  });
}

/* ----------------------------------------------------------- administration */

export function useInvites(): UseQueryResult<Invite[], Error> {
  return useQuery({
    queryKey: queryKeys.invites,
    queryFn: async () => (await api.invites.list()).invites,
    staleTime: CACHE_TIMES.admin,
  });
}

export function useCreateInvite(): UseMutationResult<Invite, Error, CreateInviteInput> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateInviteInput) => (await api.invites.create(input)).invite,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.invites });
    },
  });
}

export function useRevokeInvite(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (code: string) => {
      await api.invites.revoke(code);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.invites });
    },
  });
}

export function useUsers(): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: async () => (await api.users.list()).users,
    staleTime: CACHE_TIMES.admin,
  });
}

export interface UpdateUserVariables {
  id: string;
  input: UpdateUserInput;
}

export function useUpdateUser(): UseMutationResult<User, Error, UpdateUserVariables> {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: UpdateUserVariables) =>
      (await api.users.update(id, input)).user,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export interface ResetPasswordVariables {
  id: string;
  input: ResetPasswordInput;
}

export function useResetPassword(): UseMutationResult<
  { revokedSessions: number },
  Error,
  ResetPasswordVariables
> {
  return useMutation({
    mutationFn: ({ id, input }: ResetPasswordVariables) => api.users.resetPassword(id, input),
  });
}
