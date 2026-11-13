import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { ProductFormValues } from '@/components/ProductForm';
import type { PreparedPhoto } from '@/lib/image';

/**
 * What one product entry holds while it is not on screen. Kept in memory only:
 * a reload or a sign-out ends it, which is also where the picture would go.
 */
interface ProductDraft {
  /** The form as it stands. */
  values?: ProductFormValues;
  /** The form as it was sent, for the offer to keep it offline. */
  submitted?: ProductFormValues;
  photo?: PreparedPhoto | null;
  /** Set once the product exists; from then on only the photo is left. */
  created?: string;
  /** Where the entry is done and hands over; replaces everything else. */
  destination?: string;
  /** A save, upload or offline capture still running. */
  pending?: boolean;
  createError?: Error | null;
  uploadError?: Error | null;
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
