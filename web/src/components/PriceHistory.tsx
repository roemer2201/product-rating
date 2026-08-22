import { useId, useState } from 'react';
import { createPriceSchema, PRICE_LIST_LIMIT, type Price, type User } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { Field } from '@/components/Field';
import { TrashIcon } from '@/components/icons';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { formatAmount, parseAmount, todayAsInputValue } from '@/lib/money';
import { useAddPrice, useDeletePrice, useShops } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * What a product cost, where and when.
 *
 * The list answers one question — "was it cheaper last time, and where" — so
 * the two numbers that answer it stand above it: the cheapest entry ever
 * recorded and the most recent one. Everything else is the log underneath.
 *
 * Recording is open to every account, because what things cost is a fact about
 * the household. Removing an entry stays with whoever wrote it down, the same
 * rule photos follow.
 */

interface PriceHistoryProps {
  productId: string;
  prices: Price[];
  user: User;
}

export function PriceHistory({ productId, prices, user }: PriceHistoryProps) {
  const shopListId = useId();

  const [amount, setAmount] = useState('');
  const [shop, setShop] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayAsInputValue());
  const [amountError, setAmountError] = useState<string | undefined>(undefined);

  const shops = useShops();
  const add = useAddPrice();
  const remove = useDeletePrice();

  // The list arrives with the newest purchase first, so the first entry is the
  // latest one and the cheapest is a single pass over at most fifty rows.
  const latest = prices[0] ?? null;
  const lowest = prices.reduce<Price | null>(
    (cheapest, entry) => (cheapest === null || entry.cents < cheapest.cents ? entry : cheapest),
    null,
  );

  const mayRemove = (price: Price): boolean => price.userId === user.id || user.role === 'admin';

  const onSubmit = (): void => {
    const cents = parseAmount(amount);
    if (cents === null) {
      setAmountError(strings.price.amountInvalid);
      return;
    }

    const parsed = createPriceSchema.safeParse({
      cents,
      shop,
      note,
      // An empty date field means "today", which is what the server assumes
      // when the field is missing.
      ...(date === '' ? {} : { purchasedAt: date }),
    });
    if (!parsed.success) {
      setAmountError(strings.price.amountInvalid);
      return;
    }

    setAmountError(undefined);
    add.mutate(
      { productId, input: parsed.data },
      {
        onSuccess: () => {
          setAmount('');
          setNote('');
          setDate(todayAsInputValue());
          // The shop stays: the next entry is usually from the same one.
        },
      },
    );
  };

  return (
    <section className="section">
      <h2 className="section__title">{strings.price.title}</h2>

      {prices.length === 0 ? (
        <p className="section__intro">{strings.price.empty}</p>
      ) : (
        <>
          <dl className="product__facts">
            <div className="product__fact">
              <dt>{strings.price.latest}</dt>
              <dd>
                {latest === null
                  ? '–'
                  : `${formatAmount(latest.cents, latest.currency)} · ${
                      latest.shop ?? strings.price.noShop
                    }`}
              </dd>
            </div>

            <div className="product__fact">
              <dt>{strings.price.lowest}</dt>
              <dd>
                {lowest === null
                  ? '–'
                  : `${formatAmount(lowest.cents, lowest.currency)} · ${
                      lowest.shop ?? strings.price.noShop
                    }`}
              </dd>
            </div>
          </dl>

          <ul className="price-list">
            {prices.map((price) => (
              <li className="price" key={price.id}>
                <div className="price__body">
                  <span className="price__amount">
                    {formatAmount(price.cents, price.currency)}
                    {lowest !== null && price.id === lowest.id && prices.length > 1 && (
                      <span className="badge badge--primary">{strings.price.lowest}</span>
                    )}
                  </span>
                  <span className="price__meta">
                    {formatDate(price.purchasedAt)} · {price.shop ?? strings.price.noShop} ·{' '}
                    {strings.price.recordedBy(price.username ?? strings.price.unknownUser)}
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

      <div className="form">
        <Field
          label={strings.price.amount}
          name="amount"
          // `decimal` rather than `numeric`: it is the keyboard with the comma
          // on it, which is the character a German price is typed with.
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
          hint={strings.price.amountHint}
          error={amountError}
          required
        />

        <Field
          label={strings.price.shop}
          name="shop"
          value={shop}
          onChange={(event) => {
            setShop(event.target.value);
          }}
          hint={strings.price.shopHint}
          list={shopListId}
          maxLength={120}
          optional
        />

        <datalist id={shopListId} aria-label={strings.price.shopList}>
          {(shops.data ?? []).map((entry) => (
            <option value={entry} key={entry} />
          ))}
        </datalist>

        <Field
          label={strings.price.date}
          name="purchasedAt"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
          hint={strings.price.dateHint}
          max={todayAsInputValue()}
        />

        <Field
          label={strings.price.note}
          name="note"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          hint={strings.price.noteHint}
          maxLength={200}
          optional
        />

        <button
          type="button"
          className="button button--primary"
          onClick={onSubmit}
          disabled={add.isPending || amount.trim() === ''}
        >
          {add.isPending ? strings.price.adding : strings.price.add}
        </button>
      </div>
    </section>
  );
}
