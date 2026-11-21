import { useId } from 'react';
import type { ProductKind } from '@product-rating/shared';
import { ChevronDownIcon } from '@/components/icons';
import { isPriceStarted, PriceFields, type PriceFieldValues } from '@/components/PriceFields';
import { formatPlainAmount, parseAmount } from '@/lib/money';
import { strings } from '@/lib/strings';

/**
 * The first price of a new entry, folded away until somebody wants it.
 *
 * Most products are entered without one, and the form is long enough already
 * on a phone; so the fields sit behind a toggle, the way the catalogue keeps
 * its rarer filters. Folding only hides: what was typed is saved with the
 * product whether the panel is open or not, and the closed toggle says what it
 * holds, so nothing goes out unseen.
 *
 * The price watch mark is the last thing in the panel. It only keeps the entry
 * out of the catalogue's default view, which is what somebody wants who
 * records an article for its price alone - an option that follows the price
 * rather than a property of the product in its own right.
 */

interface PriceEntryProps {
  kind: ProductKind;
  values: PriceFieldValues;
  onChange: (patch: Partial<PriceFieldValues>) => void;
  priceWatch: boolean;
  onPriceWatchChange: (priceWatch: boolean) => void;
  open: boolean;
  onToggle: (open: boolean) => void;
  amountError?: string | undefined;
  dateError?: string | undefined;
}

export function PriceEntry({
  kind,
  values,
  onChange,
  priceWatch,
  onPriceWatchChange,
  open,
  onToggle,
  amountError,
  dateError,
}: PriceEntryProps) {
  const panelId = useId();
  const dish = kind === 'dish';

  const typed = values.amount.trim();
  const cents = parseAmount(typed);
  /** What the closed toggle shows of the entry, in the order of the fields. */
  const summary = [
    cents === null ? typed : formatPlainAmount(cents),
    dish ? '' : values.shop.trim(),
    !dish && values.special ? strings.price.special : '',
    priceWatch ? strings.product.priceWatch : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');

  return (
    <div className="price-disclosure">
      <button
        type="button"
        className="button price-disclosure__toggle"
        onClick={() => {
          onToggle(!open);
        }}
        aria-expanded={open}
        // Only while the panel exists, as with the catalogue filters.
        aria-controls={open ? panelId : undefined}
      >
        <span className="price-disclosure__label">
          <span>{dish ? strings.price.dishAdd : strings.price.add}</span>
          {/* The space keeps the two lines apart in the name a screen reader
              announces; between flex items it takes no room on screen. */}
          {!open && summary !== '' && (
            <>
              {' '}
              <span className="price-disclosure__summary">{summary}</span>
            </>
          )}
        </span>
        <ChevronDownIcon className="button__icon price-disclosure__icon" />
      </button>

      {open && (
        <div id={panelId} className="price-disclosure__panel">
          <p className="field__hint">
            {dish ? strings.price.dishEntryHint : strings.price.entryHint}
          </p>

          <PriceFields
            kind={kind}
            values={values}
            onChange={onChange}
            amountRequired={isPriceStarted(values)}
            amountError={amountError}
            dateError={dateError}
          />

          <PriceWatchField checked={priceWatch} onChange={onPriceWatchChange} />
        </div>
      )}
    </div>
  );
}

/** The price watch mark with its explanation; also on the form that corrects a product. */
export function PriceWatchField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className="field">
      <label className="checkbox">
        <input
          type="checkbox"
          name="priceWatch"
          checked={checked}
          aria-describedby={hintId}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        {strings.product.priceWatch}
      </label>
      <p className="field__hint" id={hintId}>
        {strings.product.priceWatchHint}
      </p>
    </div>
  );
}
