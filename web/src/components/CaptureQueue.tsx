import { useState } from 'react';
import type { Capture } from '@/lib/offlineQueue';
import { EmptyState, ErrorNotice } from '@/components/Feedback';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { formatAmount } from '@/lib/money';
import { useCaptures, useResolveCapture, useSyncCaptures } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * What was recorded without a connection, and what is to become of it.
 *
 * The list is not a log: everything in it is still owed to somebody, so every
 * entry says what it carries, what state it is in and — for the two states that
 * need a decision — offers the decision rather than a retry loop that never
 * ends.
 *
 * A conflict is the interesting one. It only arises for a rating, because that
 * is the only part of a capture somebody can have changed elsewhere in the
 * meantime, and it is put as a plain question: the verdict from the shelf, or
 * the one that is on the server.
 */

const STATE_LABEL: Record<Capture['state'], string> = {
  pending: strings.offlineCapture.statePending,
  conflict: strings.offlineCapture.stateConflict,
  failed: strings.offlineCapture.stateFailed,
};

/** Names the parts of a capture, so nobody has to guess what is queued. */
function contentsOf(capture: Capture): string[] {
  const parts: string[] = [];

  if (capture.product !== null) parts.push(strings.offlineCapture.partProduct);
  if (capture.rating !== null) parts.push(strings.offlineCapture.partRating(capture.rating.stars));
  if (capture.price !== null) {
    parts.push(strings.offlineCapture.partPrice(formatAmount(capture.price.cents, 'EUR')));
  }
  if (capture.photos.length > 0) {
    parts.push(strings.offlineCapture.partPhotos(capture.photos.length));
  }

  return parts;
}

export function CaptureQueue() {
  const captures = useCaptures();
  const sync = useSyncCaptures();
  const resolve = useResolveCapture();

  /** The capture whose discard is waiting for a second tap. */
  const [discarding, setDiscarding] = useState<string | null>(null);

  const entries = captures.data ?? [];

  return (
    <section className="section">
      <h2 className="section__title">{strings.offlineCapture.title}</h2>
      <p className="section__intro">{strings.offlineCapture.intro}</p>

      {captures.error !== null && <ErrorNotice message={errorMessage(captures.error)} />}
      {sync.error !== null && <ErrorNotice message={errorMessage(sync.error)} />}
      {resolve.error !== null && <ErrorNotice message={errorMessage(resolve.error)} />}

      {entries.length === 0 ? (
        <EmptyState text={strings.offlineCapture.empty} />
      ) : (
        <>
          <div className="form__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                sync.mutate();
              }}
              disabled={sync.isPending}
            >
              {sync.isPending ? strings.offlineCapture.syncing : strings.offlineCapture.sync}
            </button>
          </div>

          {sync.isSuccess && (
            <p className="field__hint" role="status">
              {strings.offlineCapture.syncResult(sync.data.synced)}
            </p>
          )}

          <ul className="admin-list">
            {entries.map((capture) => (
              <li className="admin-row" key={capture.id}>
                <div className="admin-row__body">
                  <span className="admin-row__name">
                    {capture.label}
                    <span
                      className={`badge badge--${capture.state === 'pending' ? 'open' : 'expired'}`}
                    >
                      {STATE_LABEL[capture.state]}
                    </span>
                  </span>
                  <span className="admin-row__meta">
                    {strings.offlineCapture.capturedAt(
                      formatDateTime(new Date(capture.createdAt).toISOString()),
                    )}
                    {' · '}
                    {strings.offlineCapture.contains}: {contentsOf(capture).join(', ')}
                  </span>
                  <span className="admin-row__note admin-row__code">{capture.ean}</span>

                  {capture.lastError !== null && (
                    <span className="admin-row__note">{capture.lastError}</span>
                  )}

                  {capture.conflict !== null && capture.rating !== null && (
                    <div className="notice" role="alert">
                      <p>
                        <strong>{strings.offlineCapture.conflictTitle}</strong>
                      </p>
                      <p>
                        {strings.offlineCapture.conflictText(
                          capture.rating.stars,
                          capture.conflict.serverStars,
                          formatDateTime(capture.conflict.serverUpdatedAt),
                        )}
                      </p>
                      <div className="form__actions">
                        <button
                          type="button"
                          className="button button--quiet"
                          onClick={() => {
                            resolve.mutate({ capture, decision: 'mine' });
                          }}
                          disabled={resolve.isPending}
                        >
                          {strings.offlineCapture.keepMine}
                        </button>
                        <button
                          type="button"
                          className="button button--quiet"
                          onClick={() => {
                            resolve.mutate({ capture, decision: 'server' });
                          }}
                          disabled={resolve.isPending}
                        >
                          {strings.offlineCapture.keepServer}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="admin-row__actions">
                  {capture.state === 'failed' && (
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => {
                        resolve.mutate({ capture, decision: 'retry' });
                      }}
                      disabled={resolve.isPending}
                    >
                      {strings.offlineCapture.retry}
                    </button>
                  )}

                  {/* Two taps: what is in here exists nowhere else. */}
                  <button
                    type="button"
                    className="button button--quiet button--danger"
                    onClick={() => {
                      if (discarding === capture.id) {
                        resolve.mutate(
                          { capture, decision: 'discard' },
                          {
                            onSettled: () => {
                              setDiscarding(null);
                            },
                          },
                        );
                      } else {
                        setDiscarding(capture.id);
                      }
                    }}
                    disabled={resolve.isPending}
                  >
                    {discarding === capture.id
                      ? strings.offlineCapture.discardConfirm
                      : strings.offlineCapture.discard}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
