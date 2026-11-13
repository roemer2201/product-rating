import { Outlet } from 'react-router';
import { AppearanceSync } from '@/components/AppearanceSync';
import { BottomNav } from '@/components/BottomNav';
import { OfflineBanner } from '@/components/OfflineNotice';
import { ProductDrafts } from '@/components/ProductDrafts';
import { SyncGate } from '@/components/SyncGate';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { useSession } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The frame around every screen behind the login: a slim header, the screen
 * itself, and the bottom navigation.
 *
 * The header only names the account. Logging out lives on the settings page
 * alone, which the bottom navigation reaches from every screen.
 *
 * The three notices sit here rather than around the whole router: they are all
 * about the app someone is using, and all need the room above the navigation
 * that only this layout knows about. On the login screen an offline phone
 * announces itself through the failing request anyway.
 *
 * `AppearanceSync` sits here for a related reason: the appearance belongs to
 * the account, and this is the first place that is sure to have one.
 */

export function AppLayout() {
  const session = useSession();

  return (
    <div className="app-shell">
      <AppearanceSync />

      <header className="app-header">
        <span className="app-header__title">{strings.app.name}</span>

        <div className="app-header__user">
          {session.data != null && (
            <span className="app-header__session">
              <span className="app-header__session-label">{strings.session.loggedInAsLabel}</span>{' '}
              <span className="app-header__username">
                {session.data.displayName ?? session.data.username}
              </span>
            </span>
          )}
        </div>
      </header>

      <main className="app-main">
        <ProductDrafts key={session.data?.id}>
          <Outlet />
        </ProductDrafts>
      </main>

      <div className="toast-stack">
        <OfflineBanner />
        <SyncGate />
        <UpdatePrompt />
      </div>

      <BottomNav />
    </div>
  );
}
