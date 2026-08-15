import { useOnlineStatus } from '@/lib/online';
import { strings } from '@/lib/strings';

/**
 * What the app says when the phone has no connection.
 *
 * Two shapes for two situations. The banner accompanies a screen that already
 * has its content and only warns that nothing can be saved right now. The
 * screen replaces a screen that has no content at all, because the request it
 * needed never left the device.
 *
 * Both exist because of the service worker: it answers a navigation with the
 * cached app shell, so the app starts offline instead of showing the browser's
 * error page. That is an improvement only if the app then explains itself —
 * otherwise the user gets a working interface that mysteriously fails at
 * everything.
 */

/** A strip above the navigation, for a screen that is otherwise usable. */
export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) {
    return null;
  }

  return (
    <div className="toast toast--warning" role="status">
      <p>{strings.offline.banner}</p>
    </div>
  );
}

interface OfflineScreenProps {
  /** Tries the failed request again; the user usually taps it after a while. */
  onRetry?: () => void;
}

/** The whole screen, for the case where nothing could be loaded. */
export function OfflineScreen({ onRetry }: OfflineScreenProps) {
  return (
    <div className="centre-screen">
      <h1 className="page__title">{strings.offline.title}</h1>
      <p role="alert">{strings.offline.text}</p>
      <p>{strings.offline.hint}</p>
      {onRetry !== undefined && (
        <button type="button" className="button" onClick={onRetry}>
          {strings.common.retry}
        </button>
      )}
    </div>
  );
}
