import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { updateProductSchema } from '@product-rating/shared';
import { ErrorNotice, ErrorScreen, SkeletonBlock } from '@/components/Feedback';
import { PhotoManager } from '@/components/PhotoManager';
import { PriceHistory } from '@/components/PriceHistory';
import { ProductForm, type ProductFormValues } from '@/components/ProductForm';
import { RatingEditor } from '@/components/RatingEditor';
import { StarDisplay } from '@/components/StarRating';
import { api, errorMessage } from '@/lib/api';
import { formatAverage, formatDate } from '@/lib/format';
import { emptyToNull, fieldErrors, type FieldErrors } from '@/lib/forms';
import { useDeleteProduct, useProduct, useSession, useUpdateProduct } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * One product: picture, verdicts, and the two ways to change it.
 *
 * The screen shows four different things that all look like "the rating": the
 * caller's own stars, the household average, how many people voted, and what
 * each of them thought. Keeping them apart visually matters more here than
 * anywhere else in the app — the average is the answer to "should we buy this
 * again", the list underneath says why, and the own rating is the only thing
 * this device may change.
 *
 * Correcting the product data is open to everyone, because the catalogue is
 * shared and a typo at the shelf should not need an administrator. Deleting is
 * not: it takes other people's ratings and photos with it.
 */
export function ProductPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const session = useSession();
  const product = useProduct(id);
  const update = useUpdateProduct(id);
  const remove = useDeleteProduct();

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  if (product.isPending) return <SkeletonBlock />;

  if (product.error !== null) {
    return (
      <ErrorScreen
        message={errorMessage(product.error)}
        onRetry={() => {
          void product.refetch();
        }}
      />
    );
  }

  const detail = product.data;
  const user = session.data;
  const isAdmin = user?.role === 'admin';

  const onSave = (values: ProductFormValues): void => {
    const parsed = updateProductSchema.safeParse({
      name: values.name,
      brand: emptyToNull(values.brand),
      category: emptyToNull(values.category),
      notes: emptyToNull(values.notes),
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    update.mutate(parsed.data, {
      onSuccess: () => {
        setEditing(false);
      },
    });
  };

  const onDelete = (): void => {
    remove.mutate(detail.id, {
      onSuccess: () => {
        void navigate('/', { replace: true });
      },
    });
  };

  if (editing) {
    return (
      <section>
        <h1 className="page__title">{strings.product.editTitle}</h1>

        <ProductForm
          initial={{
            name: detail.name,
            brand: detail.brand ?? '',
            category: detail.category ?? '',
            notes: detail.notes ?? '',
          }}
          onSubmit={onSave}
          submitLabel={strings.common.save}
          pendingLabel={strings.common.saving}
          pending={update.isPending}
          errors={errors}
          error={update.error === null ? null : errorMessage(update.error)}
          secondaryAction={
            <button
              type="button"
              className="button"
              onClick={() => {
                setEditing(false);
              }}
            >
              {strings.common.cancel}
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section>
      <h1 className="page__title">{detail.name}</h1>
      <p className="page__intro">
        {detail.brand ?? strings.product.noBrand} · {detail.category ?? strings.product.noCategory}
      </p>

      {detail.primaryPhotoId !== null ? (
        <img
          className="product__photo"
          src={api.photos.url(detail.primaryPhotoId, 'full')}
          alt={strings.catalogue.photoAlt(detail.name)}
        />
      ) : (
        <div className="product__photo product__photo--empty">{strings.catalogue.noPhoto}</div>
      )}

      <dl className="product__facts">
        <div className="product__fact">
          <dt>{strings.rating.average}</dt>
          <dd>
            {detail.ratings.count === 0 ? (
              strings.rating.averageNone
            ) : (
              <>
                <StarDisplay stars={Math.round(detail.ratings.average ?? 0)} labelled={false} />{' '}
                {formatAverage(detail.ratings.average)} ·{' '}
                {strings.rating.count(detail.ratings.count)}
              </>
            )}
          </dd>
        </div>

        <div className="product__fact">
          <dt>{strings.product.eanLabel}</dt>
          <dd>{detail.ean}</dd>
        </div>
      </dl>

      {detail.notes !== null && (
        <section className="section">
          <h2 className="section__title">{strings.product.notes}</h2>
          <p className="product__notes">{detail.notes}</p>
        </section>
      )}

      <RatingEditor
        // Keyed on the product, not on the rating: this route stays mounted
        // when the identifier changes, so without it the next product would
        // open with the stars of the previous one. Keying it on the rating
        // instead would remount the editor on every save — and take its own
        // "saved" confirmation down with it.
        key={detail.id}
        productId={detail.id}
        rating={detail.ownRating}
      />

      <section className="section">
        <h2 className="section__title">{strings.rating.householdTitle}</h2>

        {detail.allRatings.length === 0 ? (
          <p className="section__intro">{strings.rating.householdEmpty}</p>
        ) : (
          <>
            {detail.allRatings.length === 1 && detail.allRatings[0]?.userId === user?.id && (
              <p className="section__intro">{strings.rating.householdOnlyYours}</p>
            )}

            <ul className="verdict-list">
              {detail.allRatings.map((entry) => (
                <li className="verdict" key={`${entry.userId}-${entry.updatedAt}`}>
                  <div className="verdict__head">
                    <span className="verdict__name">
                      {entry.username ?? strings.rating.householdUnknownUser}
                      {entry.userId === user?.id && (
                        <span className="badge">{strings.rating.householdYou}</span>
                      )}
                    </span>
                    <StarDisplay stars={entry.stars} />
                  </div>

                  {entry.comment !== null && <p className="verdict__comment">{entry.comment}</p>}

                  <p className="verdict__meta">
                    {strings.rating.householdRatedAt(formatDate(entry.updatedAt))}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {user !== null && user !== undefined && (
        <PriceHistory productId={detail.id} prices={detail.prices} user={user} />
      )}

      {user !== null && user !== undefined && (
        <PhotoManager productId={detail.id} photos={detail.photos} user={user} />
      )}

      <section className="section">
        <p className="product__meta">{strings.product.updatedAt(formatDate(detail.updatedAt))}</p>

        <div className="form__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setEditing(true);
            }}
          >
            {strings.common.edit}
          </button>

          <Link className="button button--quiet" to="/">
            {strings.common.toCatalogue}
          </Link>
        </div>

        {isAdmin && (
          <div className="danger-zone">
            <h2 className="section__title">{strings.product.deleteTitle}</h2>
            <p className="section__intro">{strings.product.deleteWarning}</p>

            {remove.error !== null && <ErrorNotice message={errorMessage(remove.error)} />}

            {confirmingDelete ? (
              <div className="form__actions">
                <button
                  type="button"
                  className="button button--danger"
                  onClick={onDelete}
                  disabled={remove.isPending}
                >
                  {remove.isPending ? strings.common.deleting : strings.product.deleteConfirm}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                  disabled={remove.isPending}
                >
                  {strings.common.cancel}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  setConfirmingDelete(true);
                }}
              >
                {strings.common.delete}
              </button>
            )}
          </div>
        )}
      </section>
    </section>
  );
}
