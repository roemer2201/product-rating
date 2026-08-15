import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { strings } from '@/lib/strings';

/**
 * Registers the service worker and asks before a new version takes over.
 *
 * The prompt is not politeness, it is what makes updates arrive at all on an
 * iOS home screen app: such an app is never really closed, so a new worker
 * would sit in `waiting` for days while the user keeps looking at the old
 * bundle. Two things prevent that — the check below, which asks the server for
 * a new worker whenever the app comes back to the foreground, and this prompt,
 * which turns the waiting worker into a visible offer.
 *
 * Taking over is deliberately the user's decision: `updateServiceWorker()`
 * reloads the page, and doing that unannounced would throw away a half filled
 * product form.
 */

/**
 * How often to ask for a new worker while the app stays open. A phone on the
 * home screen can be in the foreground for hours without a single navigation,
 * which is the only moment the browser would check by itself.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_swUrl, swRegistration) => {
      setRegistration(swRegistration ?? null);
    },
  });

  useEffect(() => {
    if (registration === null) {
      return;
    }

    const check = (): void => {
      // Offline the request would only fail; the next foreground moment or the
      // next hour will do just as well.
      if (navigator.onLine) {
        void registration.update();
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };

    const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [registration]);

  if (!needRefresh) {
    return null;
  }

  return (
    <div className="toast" role="status">
      <p className="toast__title">{strings.update.title}</p>
      <p>{strings.update.text}</p>
      <div className="toast__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void updateServiceWorker();
          }}
        >
          {strings.update.reload}
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            // Only dismisses the offer. The worker keeps waiting and the offer
            // comes back with the next start of the app.
            setNeedRefresh(false);
          }}
        >
          {strings.update.later}
        </button>
      </div>
    </div>
  );
}
