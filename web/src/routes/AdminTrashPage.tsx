import { useState } from 'react';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { usePurgeProduct, useRestoreProduct, useTrash } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The trash, for administrators.
 *
 * It sits in the administration for the same reason deleting is an
 * administrator's job: what is in it belongs to everybody, and bringing a
 * product back brings other people's ratings and photos with it.
 */
export function AdminTrashPage() {
  const trash = useTrash();
  const restoreProduct = useRestoreProduct();
  const purgeProduct = usePurgeProduct();

  /** The product whose final deletion is waiting for a second tap. */
  const [purging, setPurging] = useState<string | null>(null);

  return (
    <section>
      <h1 className="page__title">{strings.admin.trashTitle}</h1>
      <p className="page__intro">{strings.admin.trashIntro}</p>

      {restoreProduct.error !== null && (
        <ErrorNotice message={errorMessage(restoreProduct.error)} />
      )}
      {purgeProduct.error !== null && <ErrorNotice message={errorMessage(purgeProduct.error)} />}

      {trash.isPending ? (
        <SkeletonList rows={2} />
      ) : trash.error !== null ? (
        <ErrorNotice
          message={errorMessage(trash.error)}
          onRetry={() => {
            void trash.refetch();
          }}
        />
      ) : trash.data.length === 0 ? (
        <EmptyState text={strings.admin.trashEmpty} />
      ) : (
        <ul className="admin-list">
          {trash.data.map((entry) => (
            <li className="admin-row" key={entry.product.id}>
              <div className="admin-row__body">
                <span className="admin-row__name">{entry.product.name}</span>
                <span className="admin-row__meta">
                  {strings.admin.trashDeletedAt(formatDate(entry.deletedAt))}
                  {entry.deletedByUsername !== null &&
                    ` ${strings.admin.trashDeletedBy(
                      entry.deletedByDisplayName ?? entry.deletedByUsername,
                    )}`}{' '}
                  · {strings.admin.trashContents(entry.ratings, entry.photos)}
                </span>
                <span className="admin-row__note">
                  {entry.product.ean ??
                    (entry.product.kind === 'dish'
                      ? strings.product.dishBadge
                      : strings.product.noEan)}
                </span>
              </div>

              <div className="admin-row__actions">
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => {
                    restoreProduct.mutate(entry.product.id);
                  }}
                  disabled={restoreProduct.isPending}
                >
                  {strings.admin.trashRestore}
                </button>

                {/* Two taps, because this is the one deletion without a way back. */}
                <button
                  type="button"
                  className="button button--quiet button--danger"
                  onClick={() => {
                    if (purging === entry.product.id) {
                      purgeProduct.mutate(entry.product.id, {
                        onSettled: () => {
                          setPurging(null);
                        },
                      });
                    } else {
                      setPurging(entry.product.id);
                    }
                  }}
                  disabled={purgeProduct.isPending}
                >
                  {purging === entry.product.id
                    ? strings.admin.trashPurgeConfirm
                    : strings.admin.trashPurge}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
