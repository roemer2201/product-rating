import { useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  PRODUCT_BRAND_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_NOTES_MAX_LENGTH,
  PRODUCT_VARIANT_MAX_LENGTH,
  type CategoryRef,
} from '@product-rating/shared';
import { CategoryPicker } from '@/components/CategoryPicker';
import { Field, TextAreaField } from '@/components/Field';
import { ErrorNotice } from '@/components/Feedback';
import type { FieldErrors } from '@/lib/forms';
import { useCategories } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The product fields, for creating and for correcting.
 *
 * One form for both: the catalogue is shared, and a product entered in a hurry
 * at the shelf is corrected later from the sofa — the two are the same act, so
 * they look the same.
 *
 * Name and variant are two fields rather than one long name: a product line
 * like "5 Minuten Terrine" has a dozen flavours, each with its own EAN, and
 * telling them apart is the whole job of the list. Both halves are searched,
 * so it costs nothing to find a product by either one.
 *
 * Categories come from the list the administrators keep, several per
 * product (`CategoryPicker`). Free text let "Getränke", "getraenke" and
 * "Getränk" grow side by side; a list that is given cannot.
 *
 * Between the fields and the buttons there is room for whatever else belongs
 * to the same save. The screen for a new product puts the photo there.
 */

export interface ProductFormValues {
  name: string;
  variant: string;
  brand: string;
  /** Identifiers from the category list. */
  categoryIds: string[];
  notes: string;
}

interface ProductFormProps {
  initial?: Partial<ProductFormValues>;
  /** The categories the product carries, with names, for when the list is not there. */
  initialCategories?: CategoryRef[];
  onSubmit: (values: ProductFormValues) => void;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  /** A failure of the whole request, already translated. */
  error?: string | null;
  /** Messages belonging to single fields. */
  errors?: FieldErrors;
  /** Rendered next to the submit button, e.g. a cancel link. */
  secondaryAction?: ReactNode;
  /**
   * Rendered between the fields and the buttons. That is where the screen for
   * a new product puts the photo: it belongs to the same save, and it stands
   * directly above the button that carries it out.
   */
  children?: ReactNode;
  /**
   * The button row. A screen that shows a picture above it needs to be able to
   * scroll it into view once the picture has a height.
   */
  actionsRef?: RefObject<HTMLDivElement | null>;
}

export function ProductForm({
  initial,
  initialCategories,
  onSubmit,
  submitLabel,
  pendingLabel,
  pending,
  error = null,
  errors = {},
  secondaryAction,
  children,
  actionsRef,
}: ProductFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [variant, setVariant] = useState(initial?.variant ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [categoryIds, setCategoryIds] = useState(initial?.categoryIds ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  // The same query the picker reads; asked for here to check the choice
  // against the list once more before it goes out.
  const categories = useCategories();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    // A category deleted while the product carried it is gone from the product
    // already — keeping its identifier would only turn the save into a `400`.
    // Without a list there is nothing to check against, and the server decides.
    const list = categories.data;
    const chosen =
      list === undefined
        ? categoryIds
        : categoryIds.filter((id) => list.some((entry) => entry.id === id));
    onSubmit({ name, variant, brand, categoryIds: chosen, notes });
  };

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {error !== null && <ErrorNotice message={error} />}

      <Field
        label={strings.fields.name}
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={PRODUCT_NAME_MAX_LENGTH}
        hint={strings.product.nameHint}
        error={errors.name}
        autoComplete="off"
        required
      />

      <Field
        label={strings.fields.variant}
        name="variant"
        value={variant}
        onChange={(event) => setVariant(event.target.value)}
        maxLength={PRODUCT_VARIANT_MAX_LENGTH}
        hint={strings.product.variantHint}
        error={errors.variant}
        autoComplete="off"
        optional
      />

      <Field
        label={strings.fields.brand}
        name="brand"
        value={brand}
        onChange={(event) => setBrand(event.target.value)}
        maxLength={PRODUCT_BRAND_MAX_LENGTH}
        hint={strings.product.brandHint}
        error={errors.brand}
        autoComplete="off"
        optional
      />

      <CategoryPicker
        value={categoryIds}
        onChange={setCategoryIds}
        known={initialCategories ?? []}
        error={errors.categoryIds}
      />

      <TextAreaField
        label={strings.fields.notes}
        name="notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={PRODUCT_NOTES_MAX_LENGTH}
        hint={strings.product.notesHint}
        error={errors.notes}
        optional
      />

      {children}

      <div className="form__actions" ref={actionsRef}>
        <button type="submit" className="button button--primary" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {secondaryAction}
      </div>
    </form>
  );
}
