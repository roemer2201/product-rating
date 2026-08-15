import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactElement, ReactNode } from 'react';

/**
 * Renders a screen with the two providers it always has around it.
 *
 * The client is built fresh per test and without retries: a test that expects a
 * failure should see it at once, not after the two attempts the app makes for
 * real. `MemoryRouter` replaces the browser history, so a test can start on any
 * address without touching the URL bar.
 */

interface RenderOptions {
  /** Address to start on, e.g. `/register?invite=A1B2-C3D4-E5F6`. */
  route?: string;
  /** History state, as `RequireAuth` passes it to the login screen. */
  state?: unknown;
  client?: QueryClient;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

// The return type is inferred: Testing Library ships the query helpers as a
// generated type that cannot be named without repeating all fifty of them.
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const client = options.client ?? createTestQueryClient();
  const route = options.route ?? '/';

  const [pathname = '/', search] = route.split('?');
  const entry =
    options.state === undefined
      ? route
      : { pathname, search: search === undefined ? '' : `?${search}`, state: options.state };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );

  return { ...render(ui, { wrapper }), client };
}
