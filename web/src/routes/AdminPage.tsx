import { useState } from 'react';
import { Navigate } from 'react-router';
import { passwordSchema, type Invite, type User } from '@product-rating/shared';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { PasswordResetLink } from '@product-rating/shared';
import {
  useCreateInvite,
  useCreateResetLink,
  useInvites,
  useLockUser,
  usePurgeProduct,
  useResetPassword,
  useRestoreProduct,
  useRevokeInvite,
  useSession,
  useTrash,
  useUpdateUser,
  useUsers,
} from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * Users, invites and the trash, for administrators.
 *
 * Reached from the settings rather than from the bottom navigation: it is used
 * when someone joins the household or leaves it, which is a handful of times in
 * the life of an instance. The navigation belongs to what is used daily.
 *
 * The trash sits here for the same reason deleting is an administrator's job:
 * what is in it belongs to everybody, and bringing a product back brings other
 * people's ratings and photos with it.
 *
 * A password link is shown exactly once, right after it is issued: the server
 * stores only its hash, so this is the single moment it can be copied. That is
 * also why it is on screen and not only in the clipboard — without a secure
 * context there is no clipboard, and the link still has to get out.
 */

/** The share link, so an invite can be sent as one tap instead of a code to type. */
function inviteLink(code: string): string {
  return `${window.location.origin}/register?invite=${encodeURIComponent(code)}`;
}

const INVITE_STATUS: Record<Invite['status'], string> = {
  open: strings.admin.inviteStatusOpen,
  used: strings.admin.inviteStatusUsed,
  expired: strings.admin.inviteStatusExpired,
};

export function AdminPage() {
  const session = useSession();
  const user = session.data;

  const users = useUsers();
  const invites = useInvites();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const updateUser = useUpdateUser();
  const trash = useTrash();
  const createResetLink = useCreateResetLink();
  const lockUser = useLockUser();
  const restoreProduct = useRestoreProduct();
  const purgeProduct = usePurgeProduct();

  const resetPassword = useResetPassword();

  const [note, setNote] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  /** The account whose password is being set, and the value typed for it. */
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  /** The product whose final deletion is waiting for a second tap. */
  const [purging, setPurging] = useState<string | null>(null);
  /** The freshly issued password link; the only moment it can be read. */
  const [link, setLink] = useState<PasswordResetLink | null>(null);
  /** The account whose password removal is waiting for a second tap. */
  const [locking, setLocking] = useState<string | null>(null);

  // Nothing here is readable without the role anyway — the server refuses every
  // one of these routes — but a screen full of 403s is a poor way to say so.
  if (session.isPending) return <SkeletonList rows={3} />;
  if (user == null || user.role !== 'admin') return <Navigate to="/settings" replace />;

  /** Copies a text and remembers which entry it belonged to. */
  const copy = async (key: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setCopyFailed(false);
    } catch {
      // No clipboard permission, or an insecure context: the link is on screen
      // and can be selected by hand.
      setCopyFailed(true);
    }
  };

  const onCopy = (code: string): Promise<void> => copy(code, inviteLink(code));

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
      <h1 className="page__title">{strings.admin.title}</h1>

      <section className="section">
        <h2 className="section__title">{strings.admin.invitesTitle}</h2>
        <p className="section__intro">{strings.admin.invitesIntro}</p>

        {createInvite.error !== null && <ErrorNotice message={errorMessage(createInvite.error)} />}
        {revokeInvite.error !== null && <ErrorNotice message={errorMessage(revokeInvite.error)} />}
        {copyFailed && <p className="field__hint">{strings.common.copyFailed}</p>}

        <div className="form">
          <Field
            label={strings.admin.inviteNote}
            name="note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            hint={strings.admin.inviteNoteHint}
            maxLength={200}
            optional
          />

          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              createInvite.mutate(note.trim() === '' ? {} : { note: note.trim() }, {
                onSuccess: () => {
                  setNote('');
                },
              });
            }}
            disabled={createInvite.isPending}
          >
            {createInvite.isPending ? strings.admin.inviteCreating : strings.admin.inviteCreate}
          </button>
        </div>

        {invites.isPending ? (
          <SkeletonList rows={2} />
        ) : invites.error !== null ? (
          <ErrorNotice
            message={errorMessage(invites.error)}
            onRetry={() => {
              void invites.refetch();
            }}
          />
        ) : invites.data.length === 0 ? (
          <EmptyState text={strings.admin.invitesEmpty} />
        ) : (
          <ul className="admin-list">
            {invites.data.map((invite) => (
              <li className="admin-row" key={invite.code}>
                <div className="admin-row__body">
                  <code className="admin-row__code">{invite.code}</code>
                  <span className="admin-row__meta">
                    <span className={`badge badge--${invite.status}`}>
                      {INVITE_STATUS[invite.status]}
                    </span>{' '}
                    {strings.admin.inviteExpires(formatDate(invite.expiresAt))}
                    {invite.usedBy !== null && ` · ${strings.admin.inviteUsedBy(invite.usedBy)}`}
                  </span>
                  {invite.note !== null && <span className="admin-row__note">{invite.note}</span>}
                </div>

                {invite.status === 'open' && (
                  <div className="admin-row__actions">
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => void onCopy(invite.code)}
                    >
                      {copied === invite.code
                        ? strings.common.copied
                        : strings.admin.inviteCopyLink}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet button--danger"
                      onClick={() => {
                        revokeInvite.mutate(invite.code);
                      }}
                      disabled={revokeInvite.isPending}
                    >
                      {strings.admin.inviteRevoke}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">{strings.admin.usersTitle}</h2>
        <p className="section__intro">{strings.admin.userResetLinkHint}</p>

        {updateUser.error !== null && <ErrorNotice message={errorMessage(updateUser.error)} />}
        {createResetLink.error !== null && (
          <ErrorNotice message={errorMessage(createResetLink.error)} />
        )}
        {lockUser.error !== null && <ErrorNotice message={errorMessage(lockUser.error)} />}

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
              onClick={() => void copy(link.token, link.url)}
            >
              {copied === link.token ? strings.common.copied : strings.admin.userResetLinkCopy}
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
              const self = entry.id === user.id;

              return (
                <li className="admin-row" key={entry.id}>
                  <div className="admin-row__body">
                    <span className="admin-row__name">
                      {entry.username}
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

      <section className="section">
        <h2 className="section__title">{strings.admin.trashTitle}</h2>
        <p className="section__intro">{strings.admin.trashIntro}</p>

        {restoreProduct.error !== null && (
          <ErrorNotice message={errorMessage(restoreProduct.error)} />
        )}
        {purgeProduct.error !== null && <ErrorNotice message={errorMessage(purgeProduct.error)} />}

        {trash.isPending ? (
          <SkeletonList rows={2} />
        ) : trash.error !== null ? (
          <ErrorNotice
            message={errorMessage(trash.error)}
            onRetry={() => {
              void trash.refetch();
            }}
          />
        ) : trash.data.length === 0 ? (
          <EmptyState text={strings.admin.trashEmpty} />
        ) : (
          <ul className="admin-list">
            {trash.data.map((entry) => (
              <li className="admin-row" key={entry.product.id}>
                <div className="admin-row__body">
                  <span className="admin-row__name">{entry.product.name}</span>
                  <span className="admin-row__meta">
                    {strings.admin.trashDeletedAt(formatDate(entry.deletedAt))}
                    {entry.deletedByUsername !== null &&
                      ` ${strings.admin.trashDeletedBy(entry.deletedByUsername)}`}{' '}
                    · {strings.admin.trashContents(entry.ratings, entry.photos)}
                  </span>
                  <span className="admin-row__note">{entry.product.ean}</span>
                </div>

                <div className="admin-row__actions">
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => {
                      restoreProduct.mutate(entry.product.id);
                    }}
                    disabled={restoreProduct.isPending}
                  >
                    {strings.admin.trashRestore}
                  </button>

                  {/* Two taps, because this is the one deletion without a way back. */}
                  <button
                    type="button"
                    className="button button--quiet button--danger"
                    onClick={() => {
                      if (purging === entry.product.id) {
                        purgeProduct.mutate(entry.product.id, {
                          onSettled: () => {
                            setPurging(null);
                          },
                        });
                      } else {
                        setPurging(entry.product.id);
                      }
                    }}
                    disabled={purgeProduct.isPending}
                  >
                    {purging === entry.product.id
                      ? strings.admin.trashPurgeConfirm
                      : strings.admin.trashPurge}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
