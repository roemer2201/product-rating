import {
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { LoginInput, RegisterInput, User } from '@product-rating/shared';
import { ApiError, api, type MyRatingsParams, type ProductListParams } from '@/lib/api';

/**
 * Server state: query keys, cache times and the hooks around the session.
 *
 * TanStack Query holds everything that comes from the server; React state is
 * left for what only the screen knows (a half filled form, an open dialog).
 * The keys live here rather than next to the screens so that a mutation in one
 * corner of the app can invalidate a list in another without importing it.
 *
 * Product, rating and photo hooks follow with the screens in M8 — the keys for
 * them are already defined so both sides agree from the start.
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
  },
  ratings: {
    all: ['ratings'] as const,
    mine: (params: MyRatingsParams) => ['ratings', 'mine', params] as const,
  },
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
