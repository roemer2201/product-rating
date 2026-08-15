import { Link } from 'react-router';
import { strings } from '@/lib/strings';

/**
 * An address that belongs to no screen. It stays outside the login gate: a
 * mistyped URL is not a reason to ask for a password.
 */
export function NotFoundPage() {
  return (
    <div className="centre-screen">
      <h1 className="page__title">{strings.notFound.title}</h1>
      <p>{strings.notFound.text}</p>
      <Link to="/">{strings.common.toCatalogue}</Link>
    </div>
  );
}
