import { useState } from 'react';
import { passwordSchema, type PasswordResetLink, type User } from '@product-rating/shared';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { useClipboard } from '@/lib/clipboard';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  useCreateResetLink,
  useLockUser,
  useResetPassword,
  useSession,
  useUpdateUser,
  useUsers,
} from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The accounts of the instance: roles, disabling, and passwords.
 *
 * A password link is shown exactly once, right after it is issued: the server
 * stores only its hash, so this is the single moment it can be copied. That is
 * also why it is on screen and not only in the clipboard — without a secure
 * context there is no clipboard, and the link still has to get out.
 */
export function AdminUsersPage() {
  const session = useSession();
  const users = useUsers();
  const updateUser = useUpdateUser();
  const createResetLink = useCreateResetLink();
  const lockUser = useLockUser();
  const resetPassword = useResetPassword();
  const clipboard = useClipboard();

  /** The account whose password is being set, and the value typed for it. */
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  /** The freshly issued password link; the only moment it can be read. */
  const [link, setLink] = useState<PasswordResetLink | null>(null);
  /** The account whose password removal is waiting for a second tap. */
  const [locking, setLocking] = useState<string | null>(null);

  // `AdminLayout` only lets an administrator this far, so there is a session.
  const selfId = session.data?.id;

  const toggleRole = (entry: User): void => {
    updateUser.mutate({
      id: entry.id,
      input: { role: entry.role === 'admin' ? 'user' : 'admin' },
    });
  };

  const toggleDisabled = (entry: User): void => {
    updateUser.mutate({ id: entry.id, input: { disabled: entry.disabledAt === null } });
  };

  const submitReset = (id: string): void => {
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) return;

    resetPassword.mutate(
      { id, input: { newPassword: parsed.data } },
      {
        onSuccess: () => {
          setResetting(null);
          setNewPassword('');
        },
      },
    );
  };

  return (
    <section>
      <h1 className="page__title">{strings.admin.usersTitle}</h1>
      <p className="page__intro">{strings.admin.userResetLinkHint}</p>

      {updateUser.error !== null && <ErrorNotice message={errorMessage(updateUser.error)} />}
      {createResetLink.error !== null && (
        <ErrorNotice message={errorMessage(createResetLink.error)} />
      )}
      {lockUser.error !== null && <ErrorNotice message={errorMessage(lockUser.error)} />}
      {clipboard.failed && <p className="field__hint">{strings.common.copyFailed}</p>}

      {link !== null && (
        <div className="notice" role="status">
          <p>
            <strong>{strings.admin.userResetLinkFor(link.username)}</strong>{' '}
            {strings.admin.userResetLinkExpires(formatDateTime(link.expiresAt))}
          </p>
          {/* On screen as well as in the clipboard: without a secure context
              there is no clipboard, and the link still has to get out. */}
          <p className="admin-row__note admin-row__code">{link.url}</p>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void clipboard.copy(link.token, link.url)}
          >
            {clipboard.copied === link.token
              ? strings.common.copied
              : strings.admin.userResetLinkCopy}
          </button>
        </div>
      )}

      {users.isPending ? (
        <SkeletonList rows={2} />
      ) : users.error !== null ? (
        <ErrorNotice
          message={errorMessage(users.error)}
          onRetry={() => {
            void users.refetch();
          }}
        />
      ) : users.data.length === 0 ? (
        <EmptyState text={strings.admin.usersEmpty} />
      ) : (
        <ul className="admin-list">
          {resetPassword.isSuccess && resetting === null && (
            <li className="notice" role="status">
              {strings.admin.userResetDone}
            </li>
          )}
          {users.data.map((entry) => {
            const self = entry.id === selfId;

            return (
              <li className="admin-row" key={entry.id}>
                <div className="admin-row__body">
                  <span className="admin-row__name">
                    {entry.displayName ?? entry.username}
                    {self && <span className="badge">{strings.admin.userSelf}</span>}
                    {entry.disabledAt !== null && (
                      <span className="badge badge--expired">{strings.admin.userDisabled}</span>
                    )}
                    {entry.passwordResetRequired && (
                      <span className="badge badge--expired">
                        {strings.admin.userNeedsPassword}
                      </span>
                    )}
                  </span>
                  <span className="admin-row__meta">
                    {/* The username stays visible: it is what the CLI, the
                        logs and a reset link talk about, and a display name
                        is not unique. */}
                    {entry.displayName === null ? null : `${entry.username} · `}
                    {entry.role === 'admin'
                      ? strings.settings.roleAdmin
                      : strings.settings.roleUser}{' '}
                    · {strings.settings.memberSince(formatDate(entry.createdAt))}
                  </span>
                </div>

                {/* Locking yourself out of your own instance is not a feature. */}
                {!self && (
                  <div className="admin-row__actions">
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => {
                        toggleRole(entry);
                      }}
                      disabled={updateUser.isPending}
                    >
                      {entry.role === 'admin'
                        ? strings.admin.userMakeUser
                        : strings.admin.userMakeAdmin}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => {
                        setLink(null);
                        createResetLink.mutate(entry.id, {
                          onSuccess: (issued) => {
                            setLink(issued);
                          },
                        });
                      }}
                      disabled={createResetLink.isPending}
                    >
                      {createResetLink.isPending
                        ? strings.admin.userResetLinkPending
                        : strings.admin.userResetLink}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => {
                        setResetting(resetting === entry.id ? null : entry.id);
                        setNewPassword('');
                      }}
                      aria-expanded={resetting === entry.id}
                    >
                      {strings.admin.userResetPassword}
                    </button>
                    {/* Two taps: it ends every session of that account. */}
                    <button
                      type="button"
                      className="button button--quiet button--danger"
                      onClick={() => {
                        if (locking === entry.id) {
                          lockUser.mutate(entry.id, {
                            onSettled: () => {
                              setLocking(null);
                            },
                          });
                        } else {
                          setLocking(entry.id);
                        }
                      }}
                      disabled={lockUser.isPending || entry.passwordResetRequired}
                    >
                      {locking === entry.id
                        ? strings.admin.userLockConfirm
                        : strings.admin.userLock}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet button--danger"
                      onClick={() => {
                        toggleDisabled(entry);
                      }}
                      disabled={updateUser.isPending}
                    >
                      {entry.disabledAt === null
                        ? strings.admin.userDisable
                        : strings.admin.userEnable}
                    </button>
                  </div>
                )}

                {resetting === entry.id && (
                  <div className="admin-row__form">
                    {resetPassword.error !== null && (
                      <ErrorNotice message={errorMessage(resetPassword.error)} />
                    )}

                    <Field
                      label={strings.fields.newPassword}
                      name="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(event) => {
                        setNewPassword(event.target.value);
                      }}
                      autoComplete="new-password"
                      required
                    />

                    <div className="form__actions">
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={() => {
                          submitReset(entry.id);
                        }}
                        disabled={resetPassword.isPending || newPassword === ''}
                      >
                        {resetPassword.isPending
                          ? strings.common.saving
                          : strings.admin.userResetSubmit}
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setResetting(null);
                        }}
                        disabled={resetPassword.isPending}
                      >
                        {strings.common.cancel}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
