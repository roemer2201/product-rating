import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorScreen, LoadingScreen } from '@/components/Feedback';
import { OfflineScreen } from '@/components/OfflineNotice';
import { errorMessage } from '@/lib/api';
import { useOnlineStatus } from '@/lib/online';
import { useSession } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The gate in front of every screen that needs an account.
 *
 * Three cases have to stay apart. While the session is being looked up nothing
 * is decided yet, so the screen waits — sending the user to the login form
 * first and pulling them back a moment later would be the worst of the three.
 * If the lookup itself failed the server is unreachable, which is not the same
 * as being logged out and must not throw away the session. Only a definite
 * "nobody is logged in" leads to the login form, with the address the user
 * wanted so they land there after signing in.
 *
 * The failed lookup has a second reading since the service worker exists: with
 * the app shell cached, the app now also starts with no network at all, and
 * this is the screen that gets there first. A phone that knows it is offline is
 * told so instead of being handed "the server reports an error".
 */

/** Passed to the login screen so it knows where to return to. */
export interface RedirectState {
  from: string;
}

export function RequireAuth() {
  const session = useSession();
  const location = useLocation();
  const online = useOnlineStatus();

  if (session.isPending) {
    return <LoadingScreen text={strings.session.checking} />;
  }

  if (session.isError && !online) {
    return (
      <OfflineScreen
        onRetry={() => {
          void session.refetch();
        }}
      />
    );
  }

  if (session.isError) {
    return (
      <ErrorScreen
        message={errorMessage(session.error)}
        onRetry={() => {
          void session.refetch();
        }}
      />
    );
  }

  if (session.data === null) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from } satisfies RedirectState} />;
  }

  return <Outlet />;
}
