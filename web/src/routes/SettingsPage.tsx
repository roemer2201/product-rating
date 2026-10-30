import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { changePasswordSchema, updateProfileSchema } from '@product-rating/shared';
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
  useServerVersion,
  useSession,
  useUpdateProfile,
} from '@/lib/queries';
import { strings } from '@/lib/strings';
import { APP_VERSION, compareVersions } from '@/lib/version';

/**
 * The account: who you are, your password, your devices, and the way out.
 *
 * For an administrator the way into the administration follows right after
 * the account, ahead of everything that is only changed now and then.
 *
 * Logging out lives here alone. The bottom navigation reaches this screen
 * from anywhere in the app; the header only names the account.
 *
 * The display name is the one thing about the account that changes here
 * without an administrator: it is what the others in the household see at a
 * rating, so whoever wears the name decides what it is.
 *
 * Top right stands the version of the app on this device. Where the server
 * reports another one, it is named below - a newer server means the update
 * prompt is due, and the app here is still the old one.
 */
export function SettingsPage() {
  const navigate = useNavigate();

  const session = useSession();
  const sessions = useOwnSessions();
  const serverVersion = useServerVersion();
  const changePassword = useChangePassword();
  const updateProfile = useUpdateProfile();
  const revoke = useRevokeSession();
  const logout = useLogout();

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const user = session.data;

  // The field follows the account until it is typed in for the first time:
  // `null` means "not touched yet", so a name saved on another device still
  // shows up here after a refetch.
  const displayNameValue = displayName ?? user?.displayName ?? '';

  const onSaveDisplayName = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    // An empty field is not an error but the way to give the name up again,
    // so it skips the schema and goes to the server as `null`.
    const wanted = displayNameValue.trim();
    if (wanted !== '') {
      const parsed = updateProfileSchema.safeParse({ displayName: wanted });
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error.issues));
        return;
      }
    }

    setErrors({});
    updateProfile.mutate({ displayName: wanted === '' ? null : wanted });
  };

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

  const server = serverVersion.data ?? null;
  const serverHint =
    server === null || compareVersions(server, APP_VERSION) === 0
      ? null
      : compareVersions(server, APP_VERSION) > 0
        ? strings.settings.serverVersionNewer(server)
        : strings.settings.serverVersion(server);

  return (
    <section>
      <div className="page__head">
        <h1 className="page__title">{strings.settings.title}</h1>
        <p className="app-version">
          <span>{strings.settings.version(APP_VERSION)}</span>
          {serverHint !== null && <span className="app-version__server">{serverHint}</span>}
        </p>
      </div>

      {user != null && (
        <section className="section">
          <h2 className="section__title">{strings.settings.account}</h2>
          <dl className="product__facts">
            <div className="product__fact">
              <dt>{strings.fields.username}</dt>
              <dd>{user.username}</dd>
            </div>
            <div className="product__fact">
              <dt>{strings.fields.displayName}</dt>
              <dd>{user.displayName ?? strings.settings.displayNameNone}</dd>
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

      {user?.role === 'admin' && (
        <section className="section">
          <h2 className="section__title">{strings.settings.adminTitle}</h2>
          <p className="section__intro">{strings.settings.adminIntro}</p>
          <Link className="button" to="/admin">
            {strings.settings.toAdmin}
          </Link>
        </section>
      )}

      {user != null && (
        <section className="section">
          <h2 className="section__title">{strings.settings.displayNameTitle}</h2>
          <p className="section__intro">{strings.settings.displayNameIntro}</p>

          <form className="form" onSubmit={onSaveDisplayName} noValidate>
            {updateProfile.error !== null && (
              <ErrorNotice message={errorMessage(updateProfile.error)} />
            )}

            {updateProfile.isSuccess && (
              <p className="notice" role="status">
                {strings.settings.displayNameSaved(updateProfile.data.displayName)}
              </p>
            )}

            <Field
              label={strings.settings.displayNameLabel}
              name="displayName"
              value={displayNameValue}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
              autoComplete="nickname"
              optional
              hint={strings.settings.displayNameHint}
              error={errors.displayName}
            />

            <button
              type="submit"
              className="button button--primary"
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending ? strings.common.saving : strings.settings.displayNameSubmit}
            </button>
          </form>
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
