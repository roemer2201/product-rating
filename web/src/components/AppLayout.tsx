import { Outlet, useNavigate } from 'react-router';
import { BottomNav } from '@/components/BottomNav';
import { useLogout, useSession } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The frame around every screen behind the login: a slim header, the screen
 * itself, and the bottom navigation.
 *
 * Logging out lives in the header rather than only on the settings page — it is
 * the one action that has to work from anywhere, and until the settings page
 * exists (M8) it would otherwise have no home at all.
 */

export function AppLayout() {
  const session = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

  const onLogout = (): void => {
    logout.mutate(undefined, {
      // `onSettled` of the mutation has cleared the session either way, so the
      // login screen is the right destination even if the request failed.
      onSettled: () => {
        void navigate('/login', { replace: true });
      },
    });
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">{strings.app.name}</span>

        <div className="app-header__user">
          {session.data != null && (
            <span className="app-header__username">
              {strings.session.loggedInAs(session.data.username)}
            </span>
          )}
          <button
            type="button"
            className="button button--quiet"
            onClick={onLogout}
            disabled={logout.isPending}
          >
            {strings.common.logout}
          </button>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
