import { useEffect, useRef } from 'react';
import { strings } from '@/lib/strings';

/**
 * The end of a paged list: loads the next page when it comes into view, and
 * offers a button for when it does not.
 *
 * The button is not a fallback for old browsers, it is the accessible way to
 * page: scrolling into view is a mouse-and-thumb gesture, and someone tabbing
 * through the list needs something to press. Both do the same thing, so the
 * list behaves identically either way.
 */

interface LoadMoreProps {
  hasNext: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
}

export function LoadMore({ hasNext, isFetching, onLoadMore }: LoadMoreProps) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinel.current;
    if (element === null || !hasNext || isFetching) return;
    if (typeof IntersectionObserver !== 'function') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      // Start fetching before the end is actually reached, so the next rows are
      // usually there by the time the thumb arrives.
      { rootMargin: '300px' },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasNext, isFetching, onLoadMore]);

  if (!hasNext) return null;

  return (
    <div className="load-more" ref={sentinel}>
      <button type="button" className="button" onClick={onLoadMore} disabled={isFetching}>
        {isFetching ? strings.common.loadingMore : strings.common.loadMore}
      </button>
    </div>
  );
}
