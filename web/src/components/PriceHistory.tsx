import { useState } from 'react';
import {
  accountName,
  createPriceSchema,
  PRICE_LIST_LIMIT,
  type Price,
  type ProductKind,
  type User,
} from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { OfflineCapture } from '@/components/OfflineCapture';
import {
  capturedPrice,
  emptyPriceFields,
  PriceFields,
  priceRequest,
  type PriceFieldValues,
} from '@/components/PriceFields';
import { TrashIcon } from '@/components/icons';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { formatAmount } from '@/lib/money';
import { useAddPrice, useDeletePrice, useEnqueueCapture } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * What a product cost, where and when.
 *
 * The list answers one question — "was it cheaper last time, and where" — so
 * the two numbers that answer it stand above it: the cheapest entry ever
 * recorded and the most recent one. Everything else is the log underneath.
 *
 * An offer is marked as such and stays out of the cheapest price: one sale
 * would otherwise stand there for good as what the product costs. The
 * cheapest offer gets a line of its own instead.
 *
 * Recording is open to every account, because what things cost is a fact about
 * the household. Removing an entry stays with whoever wrote it down, the same
 * rule photos follow.
 *
 * For a dish the same list holds what a portion costs. Nothing is bought in a
 * shop there, so the shop field, the shop in each row and the offer mark are
 * left out, and the date is the day of the calculation rather than of a
 * purchase.
 *
 * A price being typed is reported as a draft, so that coming back to the page
 * through the browser history finds it again. Once it is saved, or kept for
 * the offline queue, the form starts over, and so does the draft: a price that
 * came back after it was recorded would be recorded twice.
 */

interface PriceHistoryProps {
  /** `dish` turns the purchases into the cost of a portion. */
  kind: ProductKind;
  productId: string;
  /**
   * Identifies the product for a price that is written down offline; `null`
   * for an entry without one, which the queue cannot take.
   */
  ean: string | null;
  productName: string;
  prices: Price[];
  user: User;
  /** A price typed on an earlier visit of the same history entry. */
  entry?: PriceFieldValues | undefined;
  onEntryChange?: (entry: PriceFieldValues) => void;
}

export function PriceHistory({
  kind,
  productId,
  ean,
  productName,
  prices,
  user,
  entry: draft,
  onEntryChange,
}: PriceHistoryProps) {
  const dish = kind === 'dish';
  /** What a row says after the amount: the shop, or nothing for a dish. */
  const whereOf = (price: Price): string[] => (dish ? [] : [price.shop ?? strings.price.noShop]);

  const [entry, setEntry] = useState<PriceFieldValues>(() => draft ?? emptyPriceFields());
  const [amountError, setAmountError] = useState<string | undefined>(undefined);
  const change = (patch: Partial<PriceFieldValues>): void => {
    const next = { ...entry, ...patch };
    setEntry(next);
    onEntryChange?.(next);
  };

  const add = useAddPrice();
  const remove = useDeletePrice();
  const capture = useEnqueueCapture();

  // The list arrives with the newest purchase first, so the first entry is the
  // latest one and the cheapest is a single pass over at most fifty rows.
  const latest = prices[0] ?? null;
  const cheapestOf = (entries: Price[]): Price | null =>
    entries.reduce<Price | null>(
      (cheapest, entry) => (cheapest === null || entry.cents < cheapest.cents ? entry : cheapest),
      null,
    );
  const lowest = cheapestOf(prices.filter((entry) => !entry.special));
  const lowestSpecial = cheapestOf(prices.filter((entry) => entry.special));

  /** Amount, shop and - for an offer - the mark, as one line of the summary. */
  const summaryOf = (price: Price | null): string =>
    price === null
      ? '–'
      : [
          formatAmount(price.cents, price.currency),
          ...whereOf(price),
          ...(price.special ? [strings.price.special] : []),
        ].join(' · ');

  const mayRemove = (price: Price): boolean => price.userId === user.id || user.role === 'admin';

  const onSubmit = (): void => {
    const request = priceRequest(entry, kind);
    if (request === null) {
      setAmountError(strings.price.amountInvalid);
      return;
    }

    const parsed = createPriceSchema.safeParse(request);
    if (!parsed.success) {
      setAmountError(strings.price.amountInvalid);
      return;
    }

    setAmountError(undefined);
    // Not `mutate` with callbacks: those are dropped once the page is left,
    // and the draft has to start over all the same.
    add.mutateAsync({ productId, input: parsed.data }).then(
      () => startOver(entry.shop),
      // The failure is on screen through the mutation's own state.
      () => undefined,
    );
  };

  /** Empties the form after a recorded price. The shop stays: the next entry is usually from the same one. */
  const startOver = (shop: string): void => {
    const next = { ...emptyPriceFields(), shop };
    setEntry(next);
    onEntryChange?.(next);
  };

  return (
    <section className="section">
      <h2 className="section__title">{dish ? strings.price.dishTitle : strings.price.title}</h2>

      {prices.length === 0 ? (
        <p className="section__intro">{dish ? strings.price.dishEmpty : strings.price.empty}</p>
      ) : (
        <>
          <dl className="product__facts">
            <div className="product__fact">
              <dt>{dish ? strings.price.dishLatest : strings.price.latest}</dt>
              <dd>{summaryOf(latest)}</dd>
            </div>

            <div className="product__fact">
              <dt>{dish ? strings.price.dishLowest : strings.price.lowest}</dt>
              <dd>{summaryOf(lowest)}</dd>
            </div>

            {lowestSpecial !== null && (
              <div className="product__fact">
                <dt>{strings.price.lowestSpecial}</dt>
                <dd>{summaryOf(lowestSpecial)}</dd>
              </div>
            )}
          </dl>

          <ul className="price-list">
            {prices.map((price) => (
              <li className="price" key={price.id}>
                <div className="price__body">
                  <span className="price__amount">
                    {formatAmount(price.cents, price.currency)}
                    {lowest !== null && price.id === lowest.id && prices.length > 1 && (
                      <span className="badge badge--primary">
                        {dish ? strings.price.dishLowest : strings.price.lowest}
                      </span>
                    )}
                    {price.special && <span className="badge">{strings.price.special}</span>}
                  </span>
                  <span className="price__meta">
                    {[
                      formatDate(price.purchasedAt),
                      ...whereOf(price),
                      strings.price.recordedBy(accountName(price) ?? strings.price.unknownUser),
                    ].join(' · ')}
                  </span>
                  {price.note !== null && <span className="price__note">{price.note}</span>}
                </div>

                {mayRemove(price) && (
                  <button
                    type="button"
                    className="button button--quiet button--danger"
                    onClick={() => {
                      remove.mutate({ priceId: price.id, productId });
                    }}
                    disabled={remove.isPending}
                    aria-label={strings.price.removeFor(formatAmount(price.cents, price.currency))}
                  >
                    <TrashIcon className="button__icon" />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {prices.length >= PRICE_LIST_LIMIT && (
            <p className="section__intro">{strings.price.capped}</p>
          )}
        </>
      )}

      {remove.error !== null && <ErrorNotice message={errorMessage(remove.error)} />}
      {add.error !== null && <ErrorNotice message={errorMessage(add.error)} />}

      <OfflineCapture
        error={add.error}
        onKeep={
          ean === null
            ? null
            : () => {
                const price = capturedPrice(entry, kind);
                if (price === null) return;
                capture.mutateAsync({ ean, label: productName, price }).then(
                  () => startOver(entry.shop),
                  () => undefined,
                );
              }
        }
        kept={capture.isSuccess}
        pending={capture.isPending}
      />

      <div className="form">
        <PriceFields kind={kind} values={entry} onChange={change} amountError={amountError} />

        <button
          type="button"
          className="button button--primary"
          onClick={onSubmit}
          disabled={add.isPending || entry.amount.trim() === ''}
        >
          {add.isPending ? strings.price.adding : dish ? strings.price.dishAdd : strings.price.add}
        </button>
      </div>
    </section>
  );
}
