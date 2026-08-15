import { strings } from '@/lib/strings';

/**
 * The three shapes every screen needs while it waits, fails or has nothing to
 * show. Collected here so a spinner looks the same everywhere and no screen
 * invents its own wording for "please try again".
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

interface PagePlaceholderProps {
  title: string;
  text: string;
}

/**
 * A screen whose function follows in M8. Having them now keeps every entry of
 * the navigation on a real route instead of a dead link.
 */
export function PagePlaceholder({ title, text }: PagePlaceholderProps) {
  return (
    <section>
      <h1 className="page__title">{title}</h1>
      <div className="placeholder">
        <p>{text}</p>
        <p className="placeholder__note">{strings.placeholder.note}</p>
      </div>
    </section>
  );
}
