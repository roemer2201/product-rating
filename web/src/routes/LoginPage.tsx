import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { loginSchema } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { Field } from '@/components/Field';
import type { RedirectState } from '@/components/RequireAuth';
import { errorMessage, isApiError } from '@/lib/api';
import { fieldErrors, type FieldErrors } from '@/lib/forms';
import { useLogin, useSession } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The login form.
 *
 * A wrong password answers `401`, which everywhere else in the app means "your
 * session has expired". Here it means the opposite of that, so the status is
 * translated on this screen instead of centrally: nowhere else can tell the two
 * apart.
 */

/** Where to go after signing in: back where the user was, or to the catalogue. */
function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const { from } = state as Partial<RedirectState>;
    // Only in-app paths, so a crafted link cannot bounce someone off-site.
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from;
  }
  return '/';
}

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const session = useSession();
  const login = useLogin();
  const location = useLocation();
  const navigate = useNavigate();

  const target = redirectTarget(location.state);

  // Whoever is already logged in has no business on this screen.
  if (session.data != null) return <Navigate to={target} replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    login.mutate(parsed.data, {
      onSuccess: () => {
        void navigate(target, { replace: true });
      },
    });
  };

  const failure =
    login.error === null
      ? null
      : isApiError(login.error) && login.error.status === 401
        ? strings.login.wrongCredentials
        : errorMessage(login.error);

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <h1 className="auth-card__title">{strings.login.title}</h1>
        <p className="auth-card__intro">{strings.login.intro}</p>

        <form className="form" onSubmit={onSubmit} noValidate>
          {failure !== null && <ErrorNotice message={failure} />}

          <Field
            label={strings.login.username}
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            error={errors.username}
            required
          />

          <Field
            label={strings.login.password}
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            error={errors.password}
            required
          />

          <button type="submit" className="button button--primary" disabled={login.isPending}>
            {login.isPending ? strings.login.submitting : strings.login.submit}
          </button>
        </form>

        <p className="auth-card__footer">
          {strings.login.noAccount} <Link to="/register">{strings.login.toRegister}</Link>
        </p>
      </div>
    </div>
  );
}
