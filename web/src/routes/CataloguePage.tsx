import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  PRODUCT_SEARCH_MAX_LENGTH,
  RATING_MAX_STARS,
  type ProductSortField,
  type SortOrder,
} from '@product-rating/shared';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { LoadMore } from '@/components/LoadMore';
import { ProductCard } from '@/components/ProductCard';
import { SelectField } from '@/components/Field';
import { CameraIcon } from '@/components/icons';
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

/** Ties the camera button to the panel it opens, for assistive technology. */
const SCANNER_PANEL_ID = 'catalogue-barcode-scanner';

/**
 * The choices of the "at least this many stars" filter: every star of the
 * scale except zero, which is not a filter — it lets everything through.
 */
const MIN_STARS_OPTIONS = Array.from({ length: RATING_MAX_STARS }, (_entry, index) => index + 1);

const SORT_LABELS: Record<ProductSortField, string> = {
  name: strings.catalogue.sortName,
  created: strings.catalogue.sortCreated,
  updated: strings.catalogue.sortUpdated,
  rating: strings.catalogue.sortRating,
};

export function CataloguePage() {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
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

  const handleDetectedEan = useCallback((ean: string): void => {
    // A scan is already a complete search term, so do not make it wait for the
    // typing debounce. Keeping `search` in sync also leaves the EAN visible and
    // editable in the regular search field after the camera closes.
    setSearch(ean);
    setTerm(ean);
    setScannerOpen(false);
  }, []);

  const resetFilters = (): void => {
    setSearch('');
    setTerm('');
    setScannerOpen(false);
    setCategory('');
    setMinStars('');
    setRatedByMe(false);
  };

  return (
    <section>
      <h1 className="page__title">{strings.catalogue.title}</h1>

      <div className="filters">
        <div className="field">
          <label className="field__label" htmlFor="catalogue-search">
            {strings.catalogue.search}
          </label>
          <div className="filters__search">
            <input
              id="catalogue-search"
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
            <button
              type="button"
              className="button filters__scan"
              onClick={() => {
                setScannerOpen((open) => !open);
              }}
              aria-label={strings.catalogue.scanSearch}
              title={strings.catalogue.scanSearch}
              aria-expanded={scannerOpen}
              // Only while the panel exists: a reference to an id that is not
              // in the document is an error, not an empty relation.
              aria-controls={scannerOpen ? SCANNER_PANEL_ID : undefined}
            >
              <CameraIcon className="button__icon" />
            </button>
          </div>
        </div>

        {scannerOpen && (
          <div id={SCANNER_PANEL_ID} className="filters__scanner">
            <div className="filters__scanner-header">
              <h2 className="section__title">{strings.catalogue.scanSearch}</h2>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  setScannerOpen(false);
                }}
              >
                {strings.common.close}
              </button>
            </div>
            <p className="section__intro">{strings.scan.intro}</p>
            <BarcodeScanner onDetected={handleDetectedEan} autoStart />
          </div>
        )}

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
            {MIN_STARS_OPTIONS.map((stars) => (
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
