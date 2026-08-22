import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { createProductSchema, normaliseEan } from '@product-rating/shared';
import { OfflineCapture } from '@/components/OfflineCapture';
import { ProductForm, type ProductFormValues } from '@/components/ProductForm';
import { errorMessage, isApiError } from '@/lib/api';
import { emptyToNull, fieldErrors, type FieldErrors } from '@/lib/forms';
import { useCreateProduct, useEnqueueCapture } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * Adding a product, reached from a scan of an EAN the catalogue does not know.
 *
 * The EAN comes in through the address so the screen survives a reload and can
 * be shared as a link. Anything that is not a valid EAN sends the visitor back
 * to the scanner rather than into a form that could not be saved.
 *
 * The catalogue is shared, so between the lookup and the save someone else may
 * have entered the same product. That is what the `409` is: the answer names
 * the product that got there first, and the screen offers the way to it instead
 * of an error to argue with.
 *
 * A save that never leaves the device is the other case, and the one this
 * screen is most often reached in: somebody is standing in a shop. What was
 * typed is then kept as a capture and resolved later against the EAN — as a new
 * product, or as an addition to the one that turns out to exist.
 */
export function ProductNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const create = useCreateProduct();
  const capture = useEnqueueCapture();

  const [errors, setErrors] = useState<FieldErrors>({});
  /** What the form holds, so the offline offer can take it as it stands. */
  const [values, setValues] = useState<ProductFormValues | null>(null);

  const ean = normaliseEan(params.get('ean') ?? '');
  if (ean === null) return <Navigate to="/scan" replace />;

  const onSubmit = (values: ProductFormValues): void => {
    const parsed = createProductSchema.safeParse({
      ean,
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
    setValues(values);
    create.mutate(parsed.data, {
      onSuccess: (product) => {
        // Straight on to the product: the next thing anyone wants is the photo
        // and the stars, and both live there.
        void navigate(`/products/${product.id}`, { replace: true });
      },
    });
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
                brand: emptyToNull(values.brand),
                category: emptyToNull(values.category),
                notes: emptyToNull(values.notes),
              },
            },
            {
              onSuccess: () => {
                // There is no product to go to yet; the catalogue is where the
                // notice about the queue lives.
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
      />
    </section>
  );
}
