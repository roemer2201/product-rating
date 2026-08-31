import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { createProductSchema, normaliseEan } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { OfflineCapture } from '@/components/OfflineCapture';
import { PhotoPreview, PhotoSources, usePhotoPick } from '@/components/PhotoPicker';
import { ProductForm, type ProductFormValues } from '@/components/ProductForm';
import { errorMessage, isApiError } from '@/lib/api';
import { emptyToNull, fieldErrors, type FieldErrors } from '@/lib/forms';
import { useCreateProduct, useEnqueueCapture, useUploadPhoto } from '@/lib/queries';
import { scrollToBottomEdge } from '@/lib/scroll';
import { strings } from '@/lib/strings';

/**
 * Adding a product, reached from a scan of an EAN the catalogue does not know.
 *
 * The EAN comes in through the address so the screen survives a reload and can
 * be shared as a link. Anything that is not a valid EAN sends the visitor back
 * to the scanner rather than into a form that could not be saved.
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
 * goes into the queue with it; that is what it is for.
 */
export function ProductNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const create = useCreateProduct();
  const upload = useUploadPhoto();
  const capture = useEnqueueCapture();

  const [errors, setErrors] = useState<FieldErrors>({});
  /** What the form holds, so the offline offer can take it as it stands. */
  const [values, setValues] = useState<ProductFormValues | null>(null);
  /** Set once the product exists; from then on only the photo is left. */
  const [created, setCreated] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  // The button row the picture is meant to stand above.
  const actionsRef = useRef<HTMLDivElement>(null);

  const pick = usePhotoPick({ onStart: () => upload.reset() });
  // As constants, because the narrowing has to survive into the callbacks.
  const { picked, preview } = pick;

  const ean = normaliseEan(params.get('ean') ?? '');
  if (ean === null) return <Navigate to="/scan" replace />;

  /** The picture in the shape the offline queue stores it in. */
  const capturedPhotos = picked === null ? [] : [{ blob: picked.blob, filename: picked.filename }];

  const toProduct = (productId: string): void => {
    void navigate(`/products/${productId}`, { replace: true });
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
    upload.mutate(
      {
        productId,
        file: picked.blob,
        options: {
          filename: picked.filename,
          onProgress: (fraction) => {
            setProgress(fraction);
          },
        },
      },
      {
        onSuccess: () => {
          toProduct(productId);
        },
        // The prepared picture stays; the retry button uses it again.
        onError: () => {
          setProgress(null);
        },
      },
    );
  };

  const onSubmit = (values: ProductFormValues): void => {
    const parsed = createProductSchema.safeParse({
      ean,
      name: values.name,
      variant: emptyToNull(values.variant),
      brand: emptyToNull(values.brand),
      category: emptyToNull(values.category),
      notes: emptyToNull(values.notes),
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    setValues(values);
    create.mutate(parsed.data, {
      onSuccess: (product) => {
        // Without a picture the screen is done and hands over; the state in
        // between would only flash by.
        if (picked !== null) setCreated(product.id);
        uploadPhoto(product.id);
      },
    });
  };

  /**
   * Waited for the picture, not called with the pick: only a loaded image has
   * a height, and before that the buttons are not yet where they will end up.
   */
  const revealActions = (): void => {
    if (actionsRef.current === null) return;
    scrollToBottomEdge(actionsRef.current);
  };

  /** The product someone else created in the meantime, if that is what failed. */
  const conflictId =
    isApiError(create.error) && create.error.status === 409
      ? typeof create.error.details?.productId === 'string'
        ? create.error.details.productId
        : null
      : null;

  return (
    <section>
      <h1 className="page__title">{strings.product.newTitle}</h1>
      <p className="page__intro">{strings.product.newIntro}</p>

      <p className="product__ean">
        <span className="product__ean-label">{strings.product.eanLabel}</span> {ean}
      </p>

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
            error={create.error}
            onKeep={() => {
              if (values === null) return;
              capture.mutate(
                {
                  ean,
                  label: values.name,
                  product: {
                    name: values.name,
                    variant: emptyToNull(values.variant),
                    brand: emptyToNull(values.brand),
                    category: emptyToNull(values.category),
                    notes: emptyToNull(values.notes),
                  },
                  photos: capturedPhotos,
                },
                {
                  onSuccess: () => {
                    // There is no product to go to yet; the catalogue is where
                    // the notice about the queue lives.
                    void navigate('/', { replace: true });
                  },
                },
              );
            }}
            kept={capture.isSuccess}
            pending={capture.isPending}
          />

          <ProductForm
            onSubmit={onSubmit}
            submitLabel={strings.product.create}
            pendingLabel={strings.product.creating}
            pending={create.isPending}
            errors={errors}
            error={create.error === null || conflictId !== null ? null : errorMessage(create.error)}
            secondaryAction={
              <Link className="button" to="/scan">
                {strings.common.cancel}
              </Link>
            }
            actionsRef={actionsRef}
          >
            <div className="photo-upload">
              <h2 className="section__title">{strings.photo.newTitle}</h2>
              <p className="section__intro">{strings.photo.newHint}</p>

              <PhotoSources pick={pick} />

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
                      disabled={create.isPending}
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

          {upload.error !== null && <ErrorNotice message={errorMessage(upload.error)} />}

          {/* The product is on the server, only the picture is not. The queue
              finds it again by its EAN and adds the photo to it. */}
          <OfflineCapture
            error={upload.error}
            onKeep={() => {
              capture.mutate(
                { ean, label: values?.name ?? ean, photos: capturedPhotos },
                { onSuccess: () => toProduct(created) },
              );
            }}
            kept={capture.isSuccess}
            pending={capture.isPending}
          />

          <div className="form__actions" ref={actionsRef}>
            <button
              type="button"
              className="button button--primary"
              onClick={() => uploadPhoto(created)}
              disabled={upload.isPending}
            >
              {upload.isPending ? strings.photo.uploading : strings.photo.retry}
            </button>

            <Link className="button" to={`/products/${created}`} replace>
              {strings.product.toCreated}
            </Link>
          </div>
        </section>
      )}
    </section>
  );
}
