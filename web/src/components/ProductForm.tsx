import { useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  PRODUCT_BRAND_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_NOTES_MAX_LENGTH,
  PRODUCT_VARIANT_MAX_LENGTH,
  type CategoryRef,
  type ProductKind,
} from '@product-rating/shared';
import { CategoryPicker } from '@/components/CategoryPicker';
import { Field, TextAreaField } from '@/components/Field';
import { ErrorNotice } from '@/components/Feedback';
import { SimilarEntries } from '@/components/SimilarEntries';
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
 *
 * A dish uses the same fields under other names: the brand is where the recipe
 * comes from ("nach Oma", a cookbook, a kitchen machine), the notes are room
 * for the recipe itself. An entry without an EAN gets no protection from
 * duplicates by the database, so its form shows similar names while the name
 * is typed, and a product bought without a barcode may get one later.
 */

export interface ProductFormValues {
  /** Empty unless the form offers the field (`eanEditable`). */
  ean: string;
  name: string;
  variant: string;
  brand: string;
  /** Identifiers from the category list. */
  categoryIds: string[];
  notes: string;
}

interface ProductFormProps {
  /** Decides the labels and hints; `product` unless given. */
  kind?: ProductKind;
  /** Offers the EAN field: for a product that has none yet. */
  eanEditable?: boolean;
  /** Shows entries with a similar name below the name field. */
  showSimilar?: boolean;
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
  kind = 'product',
  eanEditable = false,
  showSimilar = false,
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
  const [ean, setEan] = useState(initial?.ean ?? '');
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
    onSubmit({ ean: eanEditable ? ean : '', name, variant, brand, categoryIds: chosen, notes });
  };

  const dish = kind === 'dish';

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {error !== null && <ErrorNotice message={error} />}

      <Field
        label={strings.fields.name}
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={PRODUCT_NAME_MAX_LENGTH}
        hint={dish ? strings.product.dishNameHint : strings.product.nameHint}
        error={errors.name}
        autoComplete="off"
        required
      />

      {showSimilar && <SimilarEntries name={name} kind={kind} />}

      <Field
        label={strings.fields.variant}
        name="variant"
        value={variant}
        onChange={(event) => setVariant(event.target.value)}
        maxLength={PRODUCT_VARIANT_MAX_LENGTH}
        hint={dish ? strings.product.dishVariantHint : strings.product.variantHint}
        error={errors.variant}
        autoComplete="off"
        optional
      />

      <Field
        label={dish ? strings.fields.source : strings.fields.brand}
        name="brand"
        value={brand}
        onChange={(event) => setBrand(event.target.value)}
        maxLength={PRODUCT_BRAND_MAX_LENGTH}
        hint={dish ? strings.product.sourceHint : strings.product.brandHint}
        error={errors.brand}
        autoComplete="off"
        optional
      />

      {eanEditable && (
        <Field
          label={strings.fields.ean}
          name="ean"
          value={ean}
          onChange={(event) => setEan(event.target.value)}
          // Same keyboard as the manual entry on the scan screen.
          inputMode="numeric"
          hint={strings.product.eanAddHint}
          error={errors.ean}
          autoComplete="off"
          optional
        />
      )}

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
        hint={dish ? strings.product.dishNotesHint : strings.product.notesHint}
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
