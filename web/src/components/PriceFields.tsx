import { useId } from 'react';
import {
  PRICE_NOTE_MAX_LENGTH,
  PRICE_SHOP_MAX_LENGTH,
  type ProductKind,
} from '@product-rating/shared';
import { Field } from '@/components/Field';
import { emptyToNull } from '@/lib/forms';
import type { CapturedPrice } from '@/lib/offlineQueue';
import { parseAmount, todayAsInputValue } from '@/lib/money';
import { useShops } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The fields of one price entry, as typed.
 *
 * Two screens record prices: the price list of a product, and the screen for a
 * new one, where the first price goes out together with the product. Both show
 * the same fields in the same order with the same keyboard, so they share them
 * here; what happens on saving stays with each screen.
 *
 * For a dish the entry is what a portion costs: no shop, no offer mark, and
 * the date is the day of the calculation.
 */

export interface PriceFieldValues {
  /** As typed, comma or point; `parseAmount()` reads it. */
  amount: string;
  shop: string;
  note: string;
  /** An offer rather than the usual price; never set for a dish. */
  special: boolean;
  /** Untouched shows today's default; an empty field lets the server choose today. */
  date: string | undefined;
}

export function emptyPriceFields(): PriceFieldValues {
  return { amount: '', shop: '', note: '', special: false, date: undefined };
}

/** Whether the user entered any price details, including a different date. */
export function isPriceStarted(values: PriceFieldValues): boolean {
  return (
    values.amount.trim() !== '' ||
    values.shop.trim() !== '' ||
    values.note.trim() !== '' ||
    values.special ||
    (values.date !== undefined && values.date !== '' && values.date !== todayAsInputValue())
  );
}

/** The request body for the API; `null` when the amount is not an amount. */
export function priceRequest(
  values: PriceFieldValues,
  kind: ProductKind,
): { cents: number; shop: string; note: string; special: boolean; purchasedAt?: string } | null {
  const cents = parseAmount(values.amount);
  if (cents === null) return null;
  const date = values.date ?? todayAsInputValue();
  return {
    cents,
    shop: kind === 'dish' ? '' : values.shop,
    note: values.note,
    special: kind !== 'dish' && values.special,
    // An empty date field means "today", which is what the server assumes
    // when the field is missing.
    ...(date === '' ? {} : { purchasedAt: date }),
  };
}

/** The same entry in the shape the offline queue keeps it in. */
export function capturedPrice(values: PriceFieldValues, kind: ProductKind): CapturedPrice | null {
  const request = priceRequest(values, kind);
  if (request === null) return null;
  return {
    cents: request.cents,
    shop: emptyToNull(request.shop),
    note: emptyToNull(request.note),
    special: request.special,
    purchasedAt: request.purchasedAt ?? todayAsInputValue(),
  };
}

interface PriceFieldsProps {
  kind: ProductKind;
  values: PriceFieldValues;
  onChange: (patch: Partial<PriceFieldValues>) => void;
  amountRequired?: boolean;
  amountError?: string | undefined;
  dateError?: string | undefined;
}

export function PriceFields({
  kind,
  values,
  onChange,
  amountRequired = true,
  amountError,
  dateError,
}: PriceFieldsProps) {
  const shopListId = useId();
  const shops = useShops();
  const dish = kind === 'dish';
  const today = todayAsInputValue();

  return (
    <>
      {/* The offer mark sits next to the amount it belongs to; half the width
          is plenty for a price. A dish has no mark, so its field stays whole. */}
      <div className={dish ? undefined : 'price-entry'}>
        <Field
          label={dish ? strings.price.dishAmount : strings.price.amount}
          name="amount"
          // `decimal` rather than `numeric`: it is the keyboard with the comma
          // on it, which is the character a German price is typed with.
          inputMode="decimal"
          value={values.amount}
          onChange={(event) => {
            onChange({ amount: event.target.value });
          }}
          error={amountError}
          required={amountRequired}
        />

        {!dish && (
          <label className="checkbox price-entry__special">
            <input
              type="checkbox"
              name="special"
              checked={values.special}
              onChange={(event) => {
                onChange({ special: event.target.checked });
              }}
            />
            {strings.price.special}
          </label>
        )}
      </div>

      {!dish && (
        <>
          <Field
            label={strings.price.shop}
            name="shop"
            value={values.shop}
            onChange={(event) => {
              onChange({ shop: event.target.value });
            }}
            hint={strings.price.shopHint}
            list={shopListId}
            maxLength={PRICE_SHOP_MAX_LENGTH}
            optional
          />

          <datalist id={shopListId} aria-label={strings.price.shopList}>
            {(shops.data ?? []).map((entry) => (
              <option value={entry} key={entry} />
            ))}
          </datalist>
        </>
      )}

      <Field
        label={dish ? strings.price.dishDate : strings.price.date}
        name="purchasedAt"
        type="date"
        value={values.date ?? today}
        onChange={(event) => {
          onChange({ date: event.target.value });
        }}
        hint={dish ? strings.price.dishDateHint : strings.price.dateHint}
        max={today}
        error={dateError}
      />

      <Field
        label={strings.price.note}
        name="note"
        value={values.note}
        onChange={(event) => {
          onChange({ note: event.target.value });
        }}
        hint={dish ? strings.price.dishNoteHint : strings.price.noteHint}
        maxLength={PRICE_NOTE_MAX_LENGTH}
        optional
      />
    </>
  );
}
