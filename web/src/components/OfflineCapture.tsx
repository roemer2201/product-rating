import { isApiError } from '@/lib/api';
import { strings } from '@/lib/strings';

/**
 * The offer that appears when a save did not leave the device.
 *
 * It is deliberately an offer and not an automatism. Recording something for
 * later is a different act from saving it: what is captured will be applied
 * minutes or hours later, possibly against a catalogue that has moved on, and
 * silently turning a failed save into a queued one would hide exactly that.
 * One tap is a small price for knowing.
 *
 * Shown only for a failure that never reached the server. A rejected value is
 * going to be rejected again in an hour, and queueing it would only postpone
 * the same message.
 */

interface OfflineCaptureProps {
  /** The failure that just happened, whatever kind it is. */
  error: unknown;
  /** Records what the screen has in hand; the screen knows what that is. */
  onKeep: () => void;
  /** True once it is in the queue, so the offer becomes a confirmation. */
  kept: boolean;
  pending?: boolean;
}

export function OfflineCapture({ error, onKeep, kept, pending = false }: OfflineCaptureProps) {
  if (kept) {
    return (
      <p className="field__hint" role="status">
        {strings.offlineCapture.kept}
      </p>
    );
  }

  if (!isApiError(error) || !error.isNetworkError) return null;

  return (
    <div className="notice" role="status">
      <p>{strings.offlineCapture.offer}</p>
      <button type="button" className="button button--quiet" onClick={onKeep} disabled={pending}>
        {pending ? strings.offlineCapture.keeping : strings.offlineCapture.keep}
      </button>
    </div>
  );
}
