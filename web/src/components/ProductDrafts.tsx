import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { ProductFormValues } from '@/components/ProductForm';
import type { PreparedPhoto } from '@/lib/image';

interface ProductDraft {
  values?: ProductFormValues;
  submitted?: ProductFormValues;
  photo?: PreparedPhoto | null;
  created?: string;
  destination?: string;
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
