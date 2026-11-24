import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { accountName, updateProductSchema } from '@product-rating/shared';
import { ErrorNotice, ErrorScreen, SkeletonBlock } from '@/components/Feedback';
import { EditIcon } from '@/components/icons';
import { PhotoManager } from '@/components/PhotoManager';
import { emptyPriceFields } from '@/components/PriceFields';
import { PriceHistory } from '@/components/PriceHistory';
import { useProductDraft } from '@/components/ProductDrafts';
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
 *
 * A dish is the same screen with other words: a source instead of a brand, no
 * EAN, and what a portion costs instead of what was paid where. A product
 * bought without a barcode can be given one in the form, once.
 */
export function ProductPage() {
  // One screen per history entry: going back to an entry brings its unsaved
  // input along (`ProductDrafts`), a new visit of the same product starts in
  // the plain view.
  const { key } = useLocation();
  return <ProductScreen key={key} />;
}

function ProductScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const session = useSession();
  const product = useProduct(id);
  const update = useUpdateProduct(id);
  const remove = useDeleteProduct();

  const { draft, update: updateDraft } = useProductDraft();
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
  const dish = detail.kind === 'dish';
  const eanEditable = detail.kind === 'product' && detail.ean === null;
  /** The correction being typed; while there is one, the form is open. */
  const editValues = draft?.edit;

  const startEditing = (): void => {
    updateDraft({
      edit: {
        ean: '',
        name: detail.name,
        variant: detail.variant ?? '',
        brand: detail.brand ?? '',
        categoryIds: detail.categories.map((entry) => entry.id),
        notes: detail.notes ?? '',
        priceWatch: detail.priceWatch,
        price: emptyPriceFields(),
      },
    });
  };

  const stopEditing = (): void => {
    setErrors({});
    updateDraft({ edit: undefined });
  };

  // Accounts are disabled rather than deleted, so a missing name is a corner
  // case; the date alone is still worth showing then.
  const createdOn = formatDate(detail.createdAt);
  const creator = accountName({
    username: detail.createdByUsername,
    displayName: detail.createdByDisplayName,
  });
  const creatorLine =
    detail.createdBy === user?.id
      ? strings.product.createdByYou(createdOn)
      : creator === null
        ? strings.product.createdAt(createdOn)
        : strings.product.createdBy(creator, createdOn);

  const onSave = (values: ProductFormValues): void => {
    const parsed = updateProductSchema.safeParse({
      // Only offered while there is none; an empty field leaves it that way.
      ...(eanEditable && values.ean.trim() !== '' ? { ean: values.ean } : {}),
      name: values.name,
      variant: emptyToNull(values.variant),
      brand: emptyToNull(values.brand),
      categoryIds: values.categoryIds,
      notes: emptyToNull(values.notes),
      priceWatch: values.priceWatch,
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    // Not `mutate` with callbacks: those are dropped once the page is left,
    // and a correction that outlived its save would reopen the form on return.
    update.mutateAsync(parsed.data).then(
      () => updateDraft({ edit: undefined }),
      // The failure is on screen through the mutation's own state.
      () => undefined,
    );
  };

  const onDelete = (): void => {
    remove.mutate(detail.id, {
      onSuccess: () => {
        void navigate('/', { replace: true });
      },
    });
  };

  if (editValues !== undefined) {
    return (
      <section>
        <h1 className="page__title">
          {dish ? strings.product.editDishTitle : strings.product.editTitle}
        </h1>

        <ProductForm
          kind={detail.kind}
          eanEditable={eanEditable}
          initial={editValues}
          onChange={(values) => updateDraft({ edit: values })}
          initialCategories={detail.categories}
          onSubmit={onSave}
          submitLabel={strings.common.save}
          pendingLabel={strings.common.saving}
          pending={update.isPending}
          errors={errors}
          error={update.error === null ? null : errorMessage(update.error)}
          secondaryAction={
            <button type="button" className="button" onClick={stopEditing}>
              {strings.common.cancel}
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section>
      {/* The pencil beside the name is the short way into the form; the
          labelled button at the end of the page stays for whoever has
          scrolled down through ratings and photos. */}
      <div className="page__head">
        <div className="page__head-text">
          <h1 className="page__title">
            {detail.name}
            {dish && <span className="badge">{strings.product.dishBadge}</span>}
          </h1>
          {/* The variant leads: it is what distinguishes this product from the
              others of the same line, and the name above already said the rest. */}
          <p className="page__intro">
            {[
              detail.variant,
              detail.brand ?? (dish ? strings.product.noSource : strings.product.noBrand),
              detail.categories.length === 0
                ? strings.product.noCategory
                : detail.categories.map((entry) => entry.name).join(', '),
            ]
              .filter((entry) => entry !== null)
              .join(' · ')}
          </p>
        </div>

        <button
          type="button"
          className="button button--quiet page__head-action"
          onClick={startEditing}
          aria-label={dish ? strings.product.editDishTitle : strings.product.editTitle}
          title={dish ? strings.product.editDishTitle : strings.product.editTitle}
        >
          <EditIcon className="button__icon" />
        </button>
      </div>

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

        {!dish && (
          <div className="product__fact">
            <dt>{strings.product.eanLabel}</dt>
            <dd>{detail.ean ?? strings.product.noEan}</dd>
          </div>
        )}
      </dl>

      {detail.notes !== null && (
        <section className="section">
          <h2 className="section__title">{strings.product.notes}</h2>
          <p className="product__notes">{detail.notes}</p>
        </section>
      )}

      <RatingEditor
        // Not keyed on the rating: that would remount the editor on every save
        // and take its own "saved" confirmation down with it. A different
        // product is a different history entry, and the whole screen is keyed
        // on that.
        productId={detail.id}
        ean={detail.ean}
        productName={detail.name}
        rating={detail.ownRating}
        draft={draft?.rating}
        onDraftChange={(rating) => updateDraft({ rating })}
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
                      {accountName(entry) ?? strings.rating.householdUnknownUser}
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
        <PriceHistory
          kind={detail.kind}
          productId={detail.id}
          ean={detail.ean}
          productName={detail.name}
          prices={detail.prices}
          user={user}
          entry={draft?.price}
          onEntryChange={(price) => updateDraft({ price })}
        />
      )}

      {user !== null && user !== undefined && (
        <PhotoManager
          productId={detail.id}
          ean={detail.ean}
          productName={detail.name}
          photos={detail.photos}
          user={user}
        />
      )}

      <section className="section">
        <p className="product__meta">
          {creatorLine} · {strings.product.updatedAt(formatDate(detail.updatedAt))}
        </p>

        <div className="form__actions">
          <button type="button" className="button" onClick={startEditing}>
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
