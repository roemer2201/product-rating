import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { ProductKind, ProductSortField, SortOrder } from '@product-rating/shared';

export type PriceWatchChoice = 'search' | 'include' | 'only';

interface CatalogueView {
  search: string;
  category: string;
  kind: ProductKind | '';
  minStars: string;
  createdByMe: boolean;
  ratedByMe: boolean;
  hasPrice: boolean;
  priceWatch: PriceWatchChoice;
  sort: ProductSortField;
  order: SortOrder;
  moreFiltersOpen: boolean;
}

export const DEFAULT_VIEW: CatalogueView = {
  search: '',
  category: '',
  kind: '',
  minStars: '',
  createdByMe: false,
  ratedByMe: false,
  hasPrice: false,
  priceWatch: 'search',
  sort: 'updated',
  order: 'desc',
  moreFiltersOpen: false,
};

// The signed-in layout owns the views. Back and Forward revisit a key, while
// opening the catalogue from the navigation creates a fresh entry.
const VisitsContext = createContext<Map<string, CatalogueView> | null>(null);

export function CatalogueVisits({ children }: { children: ReactNode }) {
  const [visits] = useState(() => new Map<string, CatalogueView>());
  return <VisitsContext.Provider value={visits}>{children}</VisitsContext.Provider>;
}

/** The consuming screen is keyed by its history entry. Only edits are retained. */
export function useCatalogueVisit() {
  const { key } = useLocation();
  const visits = useContext(VisitsContext);
  if (visits === null) throw new Error('CatalogueVisits provider is missing');
  const [view, setView] = useState(() => visits.get(key) ?? DEFAULT_VIEW);
  const update = useCallback(
    (patch: Partial<CatalogueView>) => {
      const next = { ...(visits.get(key) ?? DEFAULT_VIEW), ...patch };
      visits.set(key, next);
      setView(next);
    },
    [visits, key],
  );
  return { view, update };
}
