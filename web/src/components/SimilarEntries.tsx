import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ProductKind } from '@product-rating/shared';
import { api } from '@/lib/api';
import { strings } from '@/lib/strings';

/**
 * Entries of the catalogue whose name resembles what is being typed.
 *
 * A scanned product cannot be entered twice: the EAN is unique, and the server
 * answers a second attempt with the one that is there. An entry without an EAN
 * has nothing like that. "Gulasch" and "Rindergulasch nach Oma" are two rows as
 * far as the database is concerned, and only a person can tell whether they
 * are the same dish. So the form asks while the name is typed, using the same
 * search as the catalogue, and leaves the decision where it belongs.
 *
 * Quiet by design: nothing is shown until there is a hit, and a failed search
 * shows nothing either — this is a hint, not a step of the form.
 */

/** Same pause as the catalogue search: long enough to not search per letter. */
const SIMILAR_DEBOUNCE_MS = 300;

/** The full text index works on trigrams; shorter words find too much. */
const SIMILAR_MIN_LENGTH = 3;

/** A hint, not a list: three are enough to recognise the one that is meant. */
const SIMILAR_LIMIT = 3;

interface SimilarEntriesProps {
  name: string;
  kind: ProductKind;
}

export function SimilarEntries({ name, kind }: SimilarEntriesProps) {
  const [term, setTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(name.trim());
    }, SIMILAR_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [name]);

  const enabled = term.length >= SIMILAR_MIN_LENGTH;
  const similar = useQuery({
    // A key of its own: the catalogue keys hold infinite lists of pages, and
    // a plain page under the same key would confuse both.
    queryKey: ['products', 'similar', kind, term],
    queryFn: ({ signal }) =>
      api.products.list({ q: term, kind, sort: 'name', limit: SIMILAR_LIMIT }, signal),
    enabled,
  });

  const hits = enabled ? (similar.data?.products ?? []) : [];
  if (hits.length === 0) return null;

  return (
    <div className="notice" role="status">
      <p>
        <strong>{strings.product.similarTitle}</strong> {strings.product.similarIntro}
      </p>
      <ul className="similar-list">
        {hits.map((entry) => (
          <li key={entry.id}>
            <Link to={`/products/${entry.id}`}>
              {[entry.name, entry.variant, entry.brand].filter((part) => part !== null).join(' · ')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
