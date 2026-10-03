import { useId } from 'react';
import type { CategoryRef } from '@product-rating/shared';
import { CloseIcon } from '@/components/icons';
import { useCategories } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The categories of a product, picked from the list the administrators keep.
 *
 * Two ways in, because the list has two kinds of entries. The ones marked as
 * frequent stand as checkboxes, always visible: they are what most products
 * get, and a tick is quicker than a menu. Everything else waits in a dropdown;
 * what is picked there shows up as a chip with a button to take it off again.
 * The dropdown is a native `<select>`, which on the iPhone opens the picker
 * wheel instead of a list that has to fit the screen.
 *
 * Nothing here is typed: a category that is missing from the list is a job
 * for the administration, not for the product form.
 */

interface CategoryPickerProps {
  /** Identifiers of the chosen categories. */
  value: string[];
  onChange: (ids: string[]) => void;
  /**
   * The categories the product carried when the form opened. They give the
   * chips a name while the list is not there - offline, or still loading.
   */
  known?: CategoryRef[];
  error?: string | undefined;
}

export function CategoryPicker({ value, onChange, known = [], error }: CategoryPickerProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const categories = useCategories();

  const list = categories.data;
  const frequent = (list ?? []).filter((entry) => entry.frequent);
  const others = (list ?? []).filter((entry) => !entry.frequent);

  // The chips: every chosen category that has no checkbox, in the order of the
  // list, and - while there is no list - named after what the product carried.
  const chips: CategoryRef[] =
    list === undefined
      ? known.filter((entry) => value.includes(entry.id))
      : others.filter((entry) => value.includes(entry.id));
  const addable = others.filter((entry) => !value.includes(entry.id));

  const toggle = (categoryId: string, checked: boolean): void => {
    onChange(checked ? [...value, categoryId] : value.filter((entry) => entry !== categoryId));
  };

  const describedBy = [hintId, error === undefined ? null : errorId]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return (
    <fieldset className="field category-picker" aria-describedby={describedBy}>
      <legend className="field__label">
        {strings.fields.categories}
        <span className="field__optional"> ({strings.common.optional})</span>
      </legend>

      {frequent.length > 0 && (
        <div
          className="category-picker__frequent"
          role="group"
          aria-label={strings.product.categoriesFrequent}
        >
          {frequent.map((entry) => (
            <label className="checkbox" key={entry.id}>
              <input
                type="checkbox"
                checked={value.includes(entry.id)}
                onChange={(event) => {
                  toggle(entry.id, event.target.checked);
                }}
              />
              {entry.name}
            </label>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <ul className="chip-list">
          {chips.map((entry) => (
            <li className="chip" key={entry.id}>
              <span className="chip__label">{entry.name}</span>
              <button
                type="button"
                className="chip__remove"
                onClick={() => {
                  toggle(entry.id, false);
                }}
                aria-label={strings.product.categoryRemove(entry.name)}
                title={strings.product.categoryRemove(entry.name)}
              >
                <CloseIcon className="chip__icon" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {addable.length > 0 && (
        <select
          className="field__input field__input--select"
          aria-label={strings.product.categoryAdd}
          // Always back on the prompt: the dropdown adds, it does not hold a
          // value of its own - what was picked is a chip now.
          value=""
          onChange={(event) => {
            if (event.target.value !== '') toggle(event.target.value, true);
          }}
        >
          <option value="">{strings.product.categoryAddPlaceholder}</option>
          {addable.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      )}

      <p className="field__hint" id={hintId} role={categories.isPending ? 'status' : undefined}>
        {categories.isPending
          ? strings.product.categoriesLoading
          : list === undefined
            ? strings.product.categoriesUnavailable
            : list.length === 0
              ? strings.product.categoriesNone
              : strings.product.categoriesHint}
      </p>

      {error !== undefined && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
