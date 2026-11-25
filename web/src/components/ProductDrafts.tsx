import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { CreateProductInput } from '@product-rating/shared';
import type { PriceFieldValues } from '@/components/PriceFields';
import type { ProductFormValues } from '@/components/ProductForm';
import type { RatingDraft } from '@/components/RatingEditor';
import type { PreparedPhoto } from '@/lib/image';

/**
 * What a product screen holds while it is not on screen: the form for a new
 * entry, or on the page of an existing one what was typed and not saved yet.
 * Kept in memory only: a reload or a sign-out ends it, which is also where the
 * picture would go.
 */
interface ProductDraft {
  /* The screen for a new entry. */
  /** The form as it stands. */
  values?: ProductFormValues;
  /** The form as it was sent, for the offer to keep it offline. */
  submitted?: CreateProductInput;
  photo?: PreparedPhoto | null;
  /** Whether the panel for the first price is open. */
  priceOpen?: boolean;
  /** Set once the product exists; from then on only the photo is left. */
  created?: string;
  /** Where the entry is done and hands over; replaces everything else. */
  destination?: string;
  /** A save, upload or offline capture still running. */
  pending?: boolean;
  createError?: Error | null;
  uploadError?: Error | null;

  /* The page of an existing entry. */
  /** The correction as typed; set while the form is open. */
  edit?: ProductFormValues | undefined;
  editPending?: boolean;
  editError?: Error | undefined;
  /** The own rating as changed on screen and not saved yet. */
  rating?: RatingDraft | undefined;
  ratingPending?: 'save' | 'remove' | 'queue' | undefined;
  ratingError?: Error | undefined;
  /** A price being entered into the list. */
  price?: PriceFieldValues | undefined;
  pricePending?: 'save' | 'queue' | undefined;
  priceError?: Error | undefined;
}

type UpdateDraft = (key: string, update: ProductDraft | null) => void;
const DraftContext = createContext<{
  drafts: ReadonlyMap<string, ProductDraft>;
  update: UpdateDraft;
} | null>(null);

/** Drafts live with the signed-in app and follow their browser history entries. */
export function ProductDrafts({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ProductDraft>>(() => new Map());
  const update: UpdateDraft = (key, patch) => {
    setDrafts((current) => {
      const next = new Map(current);
      if (patch === null) next.delete(key);
      else if (patch.destination !== undefined) next.set(key, { destination: patch.destination });
      else next.set(key, { ...current.get(key), ...patch });
      return next;
    });
  };
  return <DraftContext.Provider value={{ drafts, update }}>{children}</DraftContext.Provider>;
}

export function useProductDraft() {
  const { key } = useLocation();
  const context = useContext(DraftContext);
  if (context === null) throw new Error('ProductDrafts provider is missing');
  return {
    draft: context.drafts.get(key),
    update: (patch: ProductDraft | null) => context.update(key, patch),
  };
}
