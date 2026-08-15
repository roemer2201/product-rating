import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  PRODUCT_BRAND_MAX_LENGTH,
  PRODUCT_CATEGORY_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_NOTES_MAX_LENGTH,
} from '@product-rating/shared';
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
 * The category is a free text field with a suggestion list rather than a
 * dropdown. A household invents its own categories, but it should not invent
 * "Getränke", "getraenke" and "Getränk" — offering what is already there is
 * enough to keep that from happening, while still letting a new one through.
 */

export interface ProductFormValues {
  name: string;
  brand: string;
  category: string;
  notes: string;
}

interface ProductFormProps {
  initial?: Partial<ProductFormValues>;
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
}

export function ProductForm({
  initial,
  onSubmit,
  submitLabel,
  pendingLabel,
  pending,
  error = null,
  errors = {},
  secondaryAction,
}: ProductFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const categoryListId = useId();
  // A failure here costs the suggestions and nothing else, so it is not shown.
  const categories = useCategories();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit({ name, brand, category, notes });
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
        label={strings.fields.brand}
        name="brand"
        value={brand}
        onChange={(event) => setBrand(event.target.value)}
        maxLength={PRODUCT_BRAND_MAX_LENGTH}
        error={errors.brand}
        autoComplete="off"
        optional
      />

      <Field
        label={strings.fields.category}
        name="category"
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        maxLength={PRODUCT_CATEGORY_MAX_LENGTH}
        hint={strings.product.categoryHint}
        error={errors.category}
        autoComplete="off"
        // `list` gives the native suggestion list: it proposes without
        // restricting, which a `<select>` could not do.
        list={categoryListId}
        optional
      />
      <datalist id={categoryListId} aria-label={strings.product.categoryList}>
        {(categories.data ?? []).map((entry) => (
          <option key={entry} value={entry} />
        ))}
      </datalist>

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

      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {secondaryAction}
      </div>
    </form>
  );
}
