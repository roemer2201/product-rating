import { useState } from 'react';
import type { Invite } from '@product-rating/shared';
import { EmptyState, ErrorNotice, SkeletonList } from '@/components/Feedback';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { useClipboard } from '@/lib/clipboard';
import { formatDate } from '@/lib/format';
import { useCreateInvite, useInvites, useRevokeInvite } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * Invite codes: one registration each, handed out by an administrator.
 *
 * What is copied is a link rather than the bare code, so an invite can be sent
 * as one tap instead of twelve characters to type.
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

export function AdminInvitesPage() {
  const invites = useInvites();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const clipboard = useClipboard();

  const [note, setNote] = useState('');

  return (
    <section>
      <h1 className="page__title">{strings.admin.invitesTitle}</h1>
      <p className="page__intro">{strings.admin.invitesIntro}</p>

      {createInvite.error !== null && <ErrorNotice message={errorMessage(createInvite.error)} />}
      {revokeInvite.error !== null && <ErrorNotice message={errorMessage(revokeInvite.error)} />}
      {clipboard.failed && <p className="field__hint">{strings.common.copyFailed}</p>}

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

      <section className="section">
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
                      onClick={() => void clipboard.copy(invite.code, inviteLink(invite.code))}
                    >
                      {clipboard.copied === invite.code
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
    </section>
  );
}
