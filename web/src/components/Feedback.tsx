import type { ReactNode } from 'react';
import { strings } from '@/lib/strings';

/**
 * The shapes every screen needs while it waits, fails or has nothing to show.
 * Collected here so a spinner looks the same everywhere and no screen invents
 * its own wording for "please try again".
 */

interface LoadingScreenProps {
  text?: string;
}

/** Fills the viewport; for the moment before it is known who is logged in. */
export function LoadingScreen({ text = strings.common.loading }: LoadingScreenProps) {
  return (
    <div className="centre-screen" role="status">
      <span className="spinner" />
      <p>{text}</p>
    </div>
  );
}

interface ErrorNoticeProps {
  message: string;
  onRetry?: () => void;
}

/** An error in the flow of a screen, with the retry that usually helps. */
export function ErrorNotice({ message, onRetry }: ErrorNoticeProps) {
  return (
    <div className="notice notice--error" role="alert">
      <p>{message}</p>
      {onRetry !== undefined && (
        <button type="button" className="button button--quiet" onClick={onRetry}>
          {strings.common.retry}
        </button>
      )}
    </div>
  );
}

interface ErrorScreenProps {
  message: string;
  onRetry?: () => void;
}

/** The same, but for a failure that leaves nothing else on the screen. */
export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  return (
    <div className="centre-screen">
      <p role="alert">{message}</p>
      {onRetry !== undefined && (
        <button type="button" className="button" onClick={onRetry}>
          {strings.common.retry}
        </button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  text: string;
  /** The one thing worth doing from here, if there is one. */
  action?: ReactNode;
}

/** A list with nothing in it. Says why, and where to go instead. */
export function EmptyState({ text, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p>{text}</p>
      {action}
    </div>
  );
}

interface SkeletonListProps {
  /** How many rows to draw; match what the real list usually shows. */
  rows?: number;
}

/**
 * The shape of a list before its data arrives.
 *
 * A skeleton rather than a spinner for lists: the page does not jump when the
 * rows appear, which on a phone is the difference between reading and losing
 * your place. It is hidden from assistive technology and accompanied by a
 * status message — an outline of grey boxes has nothing to say out loud.
 */
export function SkeletonList({ rows = 3 }: SkeletonListProps) {
  return (
    <>
      <p className="visually-hidden" role="status">
        {strings.common.loading}
      </p>
      <ul className="skeleton-list" aria-hidden="true">
        {Array.from({ length: rows }, (_entry, index) => (
          <li className="skeleton-card" key={index}>
            <span className="skeleton skeleton--thumb" />
            <span className="skeleton-card__lines">
              <span className="skeleton skeleton--line" />
              <span className="skeleton skeleton--line skeleton--short" />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The same idea for a single block of content, e.g. a detail screen. */
export function SkeletonBlock() {
  return (
    <>
      <p className="visually-hidden" role="status">
        {strings.common.loading}
      </p>
      <div className="skeleton-block" aria-hidden="true">
        <span className="skeleton skeleton--image" />
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line skeleton--short" />
      </div>
    </>
  );
}
