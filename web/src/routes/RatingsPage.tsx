import { useState } from 'react';
import { Link } from 'react-router';
import type { RatingSortField, SortOrder } from '@product-rating/shared';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { LoadMore } from '@/components/LoadMore';
import { ProductCard } from '@/components/ProductCard';
import { SelectField } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { useMyRatings } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * What this account has rated.
 *
 * The same rows as the catalogue, but showing the own verdict instead of the
 * household average: this list answers "what did I think of it", and the
 * average is one tap away on the product itself.
 */

const SORT_LABELS: Record<RatingSortField, string> = {
  rated: strings.myRatings.sortRated,
  stars: strings.myRatings.sortStars,
  name: strings.myRatings.sortName,
};

export function RatingsPage() {
  const [sort, setSort] = useState<RatingSortField>('rated');
  const [order, setOrder] = useState<SortOrder>('desc');

  const list = useMyRatings({ sort, order });

  const ratings = list.data?.pages.flatMap((page) => page.ratings) ?? [];

  return (
    <section>
      <h1 className="page__title">{strings.myRatings.title}</h1>

      <div className="filters filters__row">
        <SelectField
          label={strings.catalogue.sort}
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as RatingSortField);
          }}
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>

        <SelectField
          label={strings.catalogue.order}
          value={order}
          onChange={(event) => {
            setOrder(event.target.value as SortOrder);
          }}
        >
          <option value="asc">{strings.catalogue.orderAsc}</option>
          <option value="desc">{strings.catalogue.orderDesc}</option>
        </SelectField>
      </div>

      {list.error !== null && (
        <ErrorNotice
          message={errorMessage(list.error)}
          onRetry={() => {
            void list.refetch();
          }}
        />
      )}

      {list.isPending ? (
        <SkeletonList rows={3} />
      ) : ratings.length === 0 ? (
        <EmptyState
          text={strings.myRatings.empty}
          action={
            <Link className="button button--primary" to="/">
              {strings.common.toCatalogue}
            </Link>
          }
        />
      ) : (
        <>
          <ul className="product-list">
            {ratings.map((product) => (
              <ProductCard key={product.id} product={product} showOwnRating />
            ))}
          </ul>

          <LoadMore
            hasNext={list.hasNextPage}
            isFetching={list.isFetchingNextPage}
            onLoadMore={() => {
              void list.fetchNextPage();
            }}
          />
        </>
      )}
    </section>
  );
}
