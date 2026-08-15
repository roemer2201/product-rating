import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { registerSchema } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { Field } from '@/components/Field';
import { errorMessage, isApiError } from '@/lib/api';
import { emptyToNull, errorField, fieldErrors, type FieldErrors } from '@/lib/forms';
import { useRegister, useSession } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * Registration with an invite code.
 *
 * There is no open registration, so the code is a required field like the
 * password. It can be prefilled from `?invite=…`, which is what makes an invite
 * shareable as a link (M8) instead of a code that has to be typed off a screen.
 *
 * The password rule lives in the server configuration
 * (`auth.min_password_length`), so the client cannot check the length itself —
 * it only insists on something being there and shows what the server says.
 */

export function RegisterPage() {
  const [searchParams] = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState(searchParams.get('invite') ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const session = useSession();
  const register = useRegister();
  const navigate = useNavigate();

  if (session.data != null) return <Navigate to="/" replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const parsed = registerSchema.safeParse({
      username,
      password,
      email: emptyToNull(email),
      invite,
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    register.mutate(parsed.data, {
      onSuccess: () => {
        void navigate('/', { replace: true });
      },
    });
  };

  // A rejected username or invite code belongs next to its field; anything
  // else is shown above the form.
  const serverField = isApiError(register.error) ? errorField(register.error.details) : undefined;
  const serverMessage = register.error === null ? null : errorMessage(register.error);

  const errorFor = (field: string): string | undefined =>
    errors[field] ?? (serverField === field && serverMessage !== null ? serverMessage : undefined);

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <h1 className="auth-card__title">{strings.register.title}</h1>
        <p className="auth-card__intro">{strings.register.intro}</p>

        <form className="form" onSubmit={onSubmit} noValidate>
          {serverMessage !== null && serverField === undefined && (
            <ErrorNotice message={serverMessage} />
          )}

          <Field
            label={strings.register.invite}
            name="invite"
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            hint={strings.register.inviteHint}
            error={errorFor('invite')}
            required
          />

          <Field
            label={strings.register.username}
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            hint={strings.register.usernameHint}
            error={errorFor('username')}
            required
          />

          <Field
            label={strings.register.password}
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            error={errorFor('password')}
            required
          />

          <Field
            label={strings.register.email}
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            optional
            hint={strings.register.emailHint}
            error={errorFor('email')}
          />

          <button type="submit" className="button button--primary" disabled={register.isPending}>
            {register.isPending ? strings.register.submitting : strings.register.submit}
          </button>
        </form>

        <p className="auth-card__footer">
          {strings.register.haveAccount} <Link to="/login">{strings.register.toLogin}</Link>
        </p>
      </div>
    </div>
  );
}
