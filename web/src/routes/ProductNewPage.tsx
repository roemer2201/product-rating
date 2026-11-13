import { useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { createProductSchema, normaliseEan, type ProductKind } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { OfflineCapture } from '@/components/OfflineCapture';
import { PhotoPreview, PhotoSources, usePhotoPick } from '@/components/PhotoPicker';
import { useProductDraft } from '@/components/ProductDrafts';
import { ProductForm, type ProductFormValues } from '@/components/ProductForm';
import { errorMessage, isApiError } from '@/lib/api';
import { emptyToNull, fieldErrors, type FieldErrors } from '@/lib/forms';
import { useCreateProduct, useEnqueueCapture, useUploadPhoto } from '@/lib/queries';
import { scrollToBottomEdge } from '@/lib/scroll';
import { strings } from '@/lib/strings';

/**
 * Adding a product, reached from a scan of an EAN the catalogue does not know —
 * or from "Ohne Barcode erfassen" on the scan screen, for a dish or for goods
 * that never had a barcode.
 *
 * What is being added comes in through the address (`?ean=…`, or `?kind=dish`
 * and `?kind=product` without one) so the screen survives a reload and can be
 * shared as a link. Anything else sends the visitor back to the scanner rather
 * than into a form that could not be saved.
 *
 * The photo is part of this screen and not only of the product page, because
 * this is the one moment the product is in hand: somebody is standing at the
 * shelf with the packet, and sending them to a second screen afterwards is
 * exactly when the picture does not get taken. It is optional, it is picked the
 * same way as everywhere else, and it stands directly above "Produkt anlegen" —
 * which is also what the page scrolls to once the picture has a height, so the
 * button that decides about it is within reach of the thumb.
 *
 * The order is forced by the server: a photo belongs to a product, so the
 * product is created first and the picture goes up straight afterwards. That
 * middle state is visible rather than hidden, because it can fail on its own —
 * the product is then there and only the photo is missing, and this screen says
 * so and offers the retry.
 *
 * The catalogue is shared, so between the lookup and the save someone else may
 * have entered the same product. That is what the `409` is: the answer names
 * the product that got there first, and the screen offers the way to it instead
 * of an error to argue with.
 *
 * A save that never leaves the device is the other case, and the one this
 * screen is most often reached in: somebody is standing in a shop. What was
 * typed is then kept as a capture and resolved later against the EAN — as a new
 * product, or as an addition to the one that turns out to exist. The picture
 * goes into the queue with it; that is what it is for. Without an EAN there is
 * nothing to resolve against, so that offer is replaced by an explanation.
 *
 * Without an EAN the database cannot refuse a duplicate either. The form shows
 * entries with a similar name instead, so the second "Gulasch" is a decision
 * and not an accident.
 */
export function ProductNewPage() {
  const [params] = useSearchParams();
  const { key } = useLocation();
  const given = params.get('ean');
  const asked = params.get('kind');
  const ean = given === null ? null : normaliseEan(given);
  const kind: ProductKind | null =
    given !== null ? 'product' : asked === 'dish' || asked === 'product' ? asked : null;
  if (kind === null || (given !== null && ean === null)) return <Navigate to="/scan" replace />;

  return <NewProductForm key={key} kind={kind} ean={ean} />;
}

function NewProductForm({ kind, ean }: { kind: ProductKind; ean: string | null }) {
  const { draft, update } = useProductDraft();
  const create = useCreateProduct();
  const upload = useUploadPhoto();
  const capture = useEnqueueCapture();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [progress, setProgress] = useState<number | null>(null);
  // The button row the picture is meant to stand above.
  const actionsRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the next loaded picture should bring the buttons into view. Set
   * for a fresh pick and for the switch to the upload step, not for a draft
   * restored on the way back, which should open where the reader left it.
   */
  const revealPhoto = useRef(false);

  const pick = usePhotoPick({
    initial: draft?.photo ?? null,
    onStart: () => {
      revealPhoto.current = true;
    },
    onChange: (photo) => update({ photo }),
  });
  // As constants, because the narrowing has to survive into the callbacks.
  const { picked, preview } = pick;
  const {
    created = null,
    createError = null,
    uploadError = null,
    pending = false,
    destination,
  } = draft ?? {};
  if (destination !== undefined) return <Navigate to={destination} replace />;

  const dish = kind === 'dish';
  const title =
    ean !== null
      ? strings.product.newTitle
      : dish
        ? strings.product.newDishTitle
        : strings.product.newLooseTitle;
  const intro =
    ean !== null
      ? strings.product.newIntro
      : dish
        ? strings.product.newDishIntro
        : strings.product.newLooseIntro;

  /** The picture in the shape the offline queue stores it in. */
  const capturedPhotos = picked === null ? [] : [{ blob: picked.blob, filename: picked.filename }];

  const toProduct = (productId: string): void => {
    update({ destination: `/products/${productId}` });
  };

  /**
   * Sends the picked photo to a product that now exists. Without a picture
   * there is nothing to wait for and the product page comes at once.
   */
  const uploadPhoto = (productId: string): void => {
    if (picked === null) {
      toProduct(productId);
      return;
    }

    setProgress(0);
    update({ created: productId, pending: true, uploadError: null });
    void upload
      .mutateAsync({
        productId,
        file: picked.blob,
        options: {
          filename: picked.filename,
          onProgress: (fraction) => {
            setProgress(fraction);
          },
        },
      })
      .then(
        () => toProduct(productId),
        // The prepared picture stays; the retry button uses it again.
        (error: Error) => {
          setProgress(null);
          update({ pending: false, uploadError: error });
        },
      );
  };

  const onSubmit = (values: ProductFormValues): void => {
    if (pending || pick.preparing) return;
    const parsed = createProductSchema.safeParse({
      kind,
      ean,
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
    update({ submitted: values, pending: true, createError: null });
    // Not `mutate` with callbacks: those are dropped once the screen is left,
    // and the save has to go on and leave its outcome in the draft.
    void create.mutateAsync(parsed.data).then(
      (product) => {
        // The upload step shows the picture anew; its buttons come into view.
        revealPhoto.current = true;
        uploadPhoto(product.id);
      },
      (error: Error) => update({ pending: false, createError: error }),
    );
  };

  /**
   * Waited for the picture, not called with the pick: only a loaded image has
   * a height, and before that the buttons are not yet where they will end up.
   */
  const revealActions = (): void => {
    if (!revealPhoto.current || actionsRef.current === null) return;
    revealPhoto.current = false;
    scrollToBottomEdge(actionsRef.current);
  };

  /** The product someone else created in the meantime, if that is what failed. */
  const conflictId =
    isApiError(createError) && createError.status === 409
      ? typeof createError.details?.productId === 'string'
        ? createError.details.productId
        : null
      : null;

  return (
    <section>
      <h1 className="page__title">{title}</h1>
      <p className="page__intro">{intro}</p>

      {ean !== null && (
        <p className="product__ean">
          <span className="product__ean-label">{strings.product.eanLabel}</span> {ean}
        </p>
      )}

      {conflictId !== null && (
        <div className="notice" role="alert">
          <p>{strings.product.existsAlready}</p>
          <Link className="button button--quiet" to={`/products/${conflictId}`}>
            {strings.product.toExisting}
          </Link>
        </div>
      )}

      {created === null ? (
        <>
          <OfflineCapture
            error={createError}
            onKeep={
              ean === null
                ? null
                : () => {
                    const values = draft?.submitted;
                    if (values === undefined || pick.preparing) return;
                    update({ pending: true });
                    void capture
                      .mutateAsync({
                        ean,
                        label: values.name,
                        product: {
                          name: values.name,
                          variant: emptyToNull(values.variant),
                          brand: emptyToNull(values.brand),
                          categoryIds: values.categoryIds,
                          notes: emptyToNull(values.notes),
                          priceWatch: values.priceWatch,
                        },
                        photos: capturedPhotos,
                      })
                      .then(
                        // There is no product to go to yet; the catalogue is
                        // where the notice about the queue lives.
                        () => update({ destination: '/' }),
                        () => update({ pending: false }),
                      );
                  }
            }
            kept={capture.isSuccess}
            pending={pending || pick.preparing}
          />

          <ProductForm
            kind={kind}
            showSimilar={ean === null}
            initial={draft?.values ?? {}}
            onChange={(values) => update({ values })}
            onSubmit={onSubmit}
            submitLabel={dish ? strings.product.createDish : strings.product.create}
            pendingLabel={strings.product.creating}
            pending={pending || pick.preparing}
            errors={errors}
            error={createError === null || conflictId !== null ? null : errorMessage(createError)}
            secondaryAction={
              !pending && (
                <Link className="button" to="/scan" onClick={() => update(null)}>
                  {strings.common.cancel}
                </Link>
              )
            }
            actionsRef={actionsRef}
          >
            <div className="photo-upload">
              <h2 className="section__title">{strings.photo.newTitle}</h2>
              <p className="section__intro">{strings.photo.newHint}</p>

              {!pending && <PhotoSources pick={pick} />}

              {pick.preparing && <p role="status">{strings.photo.preparing}</p>}

              {preview !== null && picked !== null && (
                <PhotoPreview src={preview} onShown={revealActions}>
                  {/* Its own row, so the button keeps the width it needs
                      instead of stretching across the preview. */}
                  <div className="form__actions">
                    <button
                      type="button"
                      className="button"
                      onClick={pick.clear}
                      disabled={pending}
                    >
                      {strings.photo.discard}
                    </button>
                  </div>
                </PhotoPreview>
              )}
            </div>
          </ProductForm>
        </>
      ) : (
        <section className="section">
          <h2 className="section__title">{strings.photo.newTitle}</h2>
          <p className="notice" role="status">
            {strings.product.created}
          </p>

          {preview !== null && (
            <PhotoPreview src={preview} onShown={revealActions}>
              {progress !== null && (
                <progress
                  className="photo-upload__progress"
                  value={progress}
                  max={1}
                  aria-label={strings.photo.uploading}
                >
                  {strings.photo.progress(Math.round(progress * 100))}
                </progress>
              )}
            </PhotoPreview>
          )}

          {uploadError !== null && <ErrorNotice message={errorMessage(uploadError)} />}

          {/* The product is on the server, only the picture is not. The queue
              finds it again by its EAN and adds the photo to it. */}
          <OfflineCapture
            error={uploadError}
            onKeep={
              ean === null
                ? null
                : () => {
                    update({ pending: true });
                    void capture
                      .mutateAsync({
                        ean,
                        label: draft?.submitted?.name ?? ean,
                        photos: capturedPhotos,
                      })
                      .then(
                        () => toProduct(created),
                        () => update({ pending: false }),
                      );
                  }
            }
            kept={capture.isSuccess}
            pending={pending}
          />

          <div className="form__actions" ref={actionsRef}>
            <button
              type="button"
              className="button button--primary"
              onClick={() => uploadPhoto(created)}
              disabled={pending}
            >
              {pending ? strings.photo.uploading : strings.photo.retry}
            </button>

            <Link
              className="button"
              to={`/products/${created}`}
              replace
              onClick={() => update(null)}
            >
              {strings.product.toCreated}
            </Link>
          </div>
        </section>
      )}
    </section>
  );
}
