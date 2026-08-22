import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useCaptures, useSyncCaptures } from '@/lib/queries';
import { useOnlineStatus } from '@/lib/online';
import { strings } from '@/lib/strings';

/**
 * Gets the offline queue moving on its own, and says when it cannot.
 *
 * Two moments are worth trying: when the app starts, because the phone may have
 * been put away offline and taken out again somewhere else, and when the
 * browser reports a connection. Neither is a guarantee — `navigator.onLine`
 * only knows whether there is *a* network — so a failed attempt simply leaves
 * everything in the queue and the next moment tries again.
 *
 * What is deliberately not here is a timer. A queue that retries every thirty
 * seconds on a phone in a cellar spends battery to learn what it already knows;
 * the button in the settings is the answer for the case where somebody knows
 * better than the browser.
 */
export function SyncGate() {
  const online = useOnlineStatus();
  const captures = useCaptures();
  const sync = useSyncCaptures();

  const waiting = captures.data ?? [];
  const pending = waiting.filter((capture) => capture.state === 'pending').length;
  const needsAttention = waiting.length - pending;

  // Held in a ref so the effect below depends on the connection and the number
  // of waiting captures alone. `mutate` is stable, but reading it through the
  // mutation object would tie the effect to every render of a running sync —
  // and a sync that starts a sync is the one loop to avoid here.
  const start = useRef(sync.mutate);
  start.current = sync.mutate;

  const running = sync.isPending;

  useEffect(() => {
    if (!online || pending === 0 || running) return;
    start.current();
  }, [online, pending, running]);

  if (waiting.length === 0) return null;

  return (
    <div className="toast" role="status">
      <p>
        {strings.offlineCapture.waiting(waiting.length)}
        {needsAttention > 0 && ` · ${strings.offlineCapture.stateConflict}`}
      </p>
      <Link className="button button--quiet" to="/settings">
        {strings.offlineCapture.title}
      </Link>
    </div>
  );
}
