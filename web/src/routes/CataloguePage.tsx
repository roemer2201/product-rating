import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  PRODUCT_SEARCH_MAX_LENGTH,
  type ProductSortField,
  type SortOrder,
} from '@product-rating/shared';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { LoadMore } from '@/components/LoadMore';
import { ProductCard } from '@/components/ProductCard';
import { SelectField } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { useCategories, useProductList } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The catalogue: everything the household has entered.
 *
 * Search and filters are state of this screen rather than of the address bar.
 * The list is opened, scrolled and left again; nobody bookmarks "oats, at least
 * four stars", and a URL that changes on every keystroke would fill the back
 * button with search terms instead of screens.
 *
 * The search term is held back for a moment before it becomes a request. On a
 * phone keyboard that is the difference between one query and eight.
 */

/** How long a keystroke waits before it turns into a request. */
const SEARCH_DEBOUNCE_MS = 300;

const SORT_LABELS: Record<ProductSortField, string> = {
  name: strings.catalogue.sortName,
  created: strings.catalogue.sortCreated,
  updated: strings.catalogue.sortUpdated,
  rating: strings.catalogue.sortRating,
};

export function CataloguePage() {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [minStars, setMinStars] = useState('');
  const [ratedByMe, setRatedByMe] = useState(false);
  const [sort, setSort] = useState<ProductSortField>('updated');
  const [order, setOrder] = useState<SortOrder>('desc');

  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const categories = useCategories();

  const list = useProductList({
    ...(term === '' ? {} : { q: term }),
    ...(category === '' ? {} : { category }),
    ...(minStars === '' ? {} : { minStars: Number(minStars) }),
    ...(ratedByMe ? { ratedByMe: true } : {}),
    sort,
    order,
  });

  const products = list.data?.pages.flatMap((page) => page.products) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = term !== '' || category !== '' || minStars !== '' || ratedByMe;

  const resetFilters = (): void => {
    setSearch('');
    setTerm('');
    setCategory('');
    setMinStars('');
    setRatedByMe(false);
  };

  return (
    <section>
      <h1 className="page__title">{strings.catalogue.title}</h1>

      <div className="filters">
        <label className="field">
          <span className="field__label">{strings.catalogue.search}</span>
          <input
            className="field__input"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder={strings.catalogue.searchPlaceholder}
            maxLength={PRODUCT_SEARCH_MAX_LENGTH}
            autoComplete="off"
          />
        </label>

        <div className="filters__row">
          <SelectField
            label={strings.catalogue.category}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
          >
            <option value="">{strings.catalogue.allCategories}</option>
            {(categories.data ?? []).map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </SelectField>

          <SelectField
            label={strings.catalogue.minStars}
            value={minStars}
            onChange={(event) => {
              setMinStars(event.target.value);
            }}
          >
            <option value="">{strings.catalogue.anyStars}</option>
            {[1, 2, 3, 4, 5].map((stars) => (
              <option key={stars} value={stars}>
                {strings.rating.starLabel(stars)}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="filters__row">
          <SelectField
            label={strings.catalogue.sort}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as ProductSortField);
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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={ratedByMe}
            onChange={(event) => {
              setRatedByMe(event.target.checked);
            }}
          />
          {strings.catalogue.ratedByMe}
        </label>

        {filtered && (
          <button type="button" className="button button--quiet" onClick={resetFilters}>
            {strings.catalogue.resetFilters}
          </button>
        )}
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
        <SkeletonList rows={4} />
      ) : products.length === 0 ? (
        <EmptyState
          text={filtered ? strings.catalogue.emptyFiltered : strings.catalogue.empty}
          action={
            filtered ? (
              <button type="button" className="button" onClick={resetFilters}>
                {strings.catalogue.resetFilters}
              </button>
            ) : (
              <Link className="button button--primary" to="/scan">
                {strings.nav.scan}
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="list-total" role="status">
            {strings.catalogue.total(total)}
          </p>

          <ul className="product-list">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
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
