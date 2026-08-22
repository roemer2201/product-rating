import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { changePasswordSchema } from '@product-rating/shared';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { CaptureQueue } from '@/components/CaptureQueue';
import { Field } from '@/components/Field';
import { errorMessage, isApiError } from '@/lib/api';
import { describeUserAgent, formatDate, formatRelative } from '@/lib/format';
import { fieldErrors, type FieldErrors } from '@/lib/forms';
import {
  useChangePassword,
  useLogout,
  useOwnSessions,
  useRevokeSession,
  useSession,
} from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The account: who you are, your password, your devices, and the way out.
 *
 * Logging out is offered here as well as in the header. The header is where it
 * has to work from anywhere; this is where people look for it.
 */
export function SettingsPage() {
  const navigate = useNavigate();

  const session = useSession();
  const sessions = useOwnSessions();
  const changePassword = useChangePassword();
  const revoke = useRevokeSession();
  const logout = useLogout();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const user = session.data;

  const onChangePassword = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }

    setErrors({});
    changePassword.mutate(parsed.data, {
      onSuccess: () => {
        setCurrentPassword('');
        setNewPassword('');
      },
    });
  };

  const onLogout = (): void => {
    logout.mutate(undefined, {
      onSettled: () => {
        void navigate('/login', { replace: true });
      },
    });
  };

  // A wrong current password answers `401`, which everywhere else means "your
  // session is gone". Here it means the one field above it.
  const passwordFailure =
    changePassword.error === null
      ? null
      : isApiError(changePassword.error) && changePassword.error.status === 401
        ? strings.settings.passwordWrong
        : errorMessage(changePassword.error);

  return (
    <section>
      <h1 className="page__title">{strings.settings.title}</h1>

      {user != null && (
        <section className="section">
          <h2 className="section__title">{strings.settings.account}</h2>
          <dl className="product__facts">
            <div className="product__fact">
              <dt>{strings.fields.username}</dt>
              <dd>{user.username}</dd>
            </div>
            <div className="product__fact">
              <dt>{strings.settings.role}</dt>
              <dd>
                {user.role === 'admin' ? strings.settings.roleAdmin : strings.settings.roleUser}
              </dd>
            </div>
            <div className="product__fact">
              <dt>{strings.fields.email}</dt>
              <dd>{user.email ?? '–'}</dd>
            </div>
          </dl>
          <p className="product__meta">
            {strings.settings.memberSince(formatDate(user.createdAt))}
          </p>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">{strings.settings.passwordTitle}</h2>
        <p className="section__intro">{strings.settings.passwordIntro}</p>

        <form className="form" onSubmit={onChangePassword} noValidate>
          {passwordFailure !== null && <ErrorNotice message={passwordFailure} />}

          {changePassword.isSuccess && (
            <p className="notice" role="status">
              {strings.settings.passwordChanged(changePassword.data.revokedSessions)}
            </p>
          )}

          <Field
            label={strings.fields.currentPassword}
            name="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
            autoComplete="current-password"
            error={errors.currentPassword}
            required
          />

          <Field
            label={strings.fields.newPassword}
            name="newPassword"
            type="password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
            }}
            autoComplete="new-password"
            error={errors.newPassword}
            required
          />

          <button
            type="submit"
            className="button button--primary"
            disabled={changePassword.isPending}
          >
            {changePassword.isPending ? strings.common.saving : strings.settings.passwordSubmit}
          </button>
        </form>
      </section>

      <section className="section">
        <h2 className="section__title">{strings.settings.sessionsTitle}</h2>
        <p className="section__intro">{strings.settings.sessionsIntro}</p>

        {revoke.error !== null && <ErrorNotice message={errorMessage(revoke.error)} />}

        {sessions.isPending ? (
          <SkeletonList rows={2} />
        ) : sessions.error !== null ? (
          <ErrorNotice
            message={errorMessage(sessions.error)}
            onRetry={() => {
              void sessions.refetch();
            }}
          />
        ) : sessions.data.length === 0 ? (
          <EmptyState text={strings.settings.sessionsEmpty} />
        ) : (
          <ul className="session-list">
            {sessions.data.map((entry) => {
              const device = describeUserAgent(entry.userAgent);

              return (
                <li className="session" key={entry.id}>
                  <div className="session__body">
                    <span className="session__device">
                      {device}
                      {entry.current && (
                        <span className="badge">{strings.settings.sessionCurrent}</span>
                      )}
                    </span>
                    <span className="session__meta">
                      {strings.settings.sessionLastSeen(formatRelative(entry.lastSeenAt))} ·{' '}
                      {strings.settings.sessionExpires(formatDate(entry.expiresAt))}
                    </span>
                  </div>

                  {!entry.current && (
                    <button
                      type="button"
                      className="button button--quiet button--danger"
                      onClick={() => {
                        revoke.mutate(entry.id);
                      }}
                      disabled={revoke.isPending}
                      aria-label={strings.settings.sessionRevokeFor(device)}
                    >
                      {strings.settings.sessionRevoke}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {user?.role === 'admin' && (
        <section className="section">
          <h2 className="section__title">{strings.settings.adminTitle}</h2>
          <p className="section__intro">{strings.settings.adminIntro}</p>
          <Link className="button" to="/admin">
            {strings.settings.toAdmin}
          </Link>
        </section>
      )}

      <CaptureQueue />

      <section className="section">
        <h2 className="section__title">{strings.settings.logoutTitle}</h2>
        <p className="section__intro">{strings.settings.logoutIntro}</p>
        <button
          type="button"
          className="button button--danger"
          onClick={onLogout}
          disabled={logout.isPending}
        >
          {strings.common.logout}
        </button>
      </section>
    </section>
  );
}
