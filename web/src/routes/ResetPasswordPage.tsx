import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { redeemResetSchema } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { useRedeemReset, useResetTarget } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * Setting a password from a link an administrator handed over.
 *
 * The screen sits outside the login, because the person opening it cannot log
 * in — that is the whole reason they were given a link. What takes the place of
 * a password is the token in the address: short lived, single use, and stored
 * on the server only as a hash.
 *
 * The account is asked for before anything is typed, so a link that is spent
 * or expired says so on arrival instead of after a password has been thought
 * up. Setting the password signs the account in straight away.
 */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const target = useResetTarget(token);
  const redeem = useRedeemReset();
  const navigate = useNavigate();

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const parsed = redeemResetSchema.safeParse({ token, newPassword: password });
    if (!parsed.success) {
      setError(strings.validation.password);
      return;
    }

    setError(undefined);
    redeem.mutate(parsed.data, {
      onSuccess: () => {
        void navigate('/', { replace: true });
      },
    });
  };

  const body = (): ReactNode => {
    if (token === '') return <ErrorNotice message={strings.reset.missing} />;
    if (target.isPending) return <p role="status">{strings.reset.checking}</p>;
    if (target.error !== null) return <ErrorNotice message={strings.reset.invalid} />;

    return (
      <>
        <p className="auth-card__intro">{strings.reset.forUser(target.data)}</p>

        <form className="form" onSubmit={onSubmit} noValidate>
          {redeem.error !== null && <ErrorNotice message={errorMessage(redeem.error)} />}

          <Field
            label={strings.reset.password}
            name="newPassword"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="new-password"
            hint={strings.reset.passwordHint}
            error={error}
            required
          />

          <button type="submit" className="button button--primary" disabled={redeem.isPending}>
            {redeem.isPending ? strings.reset.submitting : strings.reset.submit}
          </button>
        </form>
      </>
    );
  };

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <h1 className="auth-card__title">{strings.reset.title}</h1>
        <p className="auth-card__intro">{strings.reset.intro}</p>

        {body()}

        <p className="auth-card__footer">
          <Link to="/login">{strings.reset.toLogin}</Link>
        </p>
      </div>
    </div>
  );
}
