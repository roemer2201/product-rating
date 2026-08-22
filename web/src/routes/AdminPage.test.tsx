import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { AdminPage } from '@/routes/AdminPage';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';

/** Users and invites. Everything here is behind the administrator role. */

const ADMIN = { ...testUser, id: 'admin-1', username: 'chef', role: 'admin' as const };

const INVITES = {
  path: '/invites',
  body: {
    invites: [
      {
        code: 'A1B2-C3D4-E5F6',
        note: 'Für Bert',
        createdBy: ADMIN.id,
        createdAt: '2026-08-14T10:00:00.000Z',
        expiresAt: '2026-08-21T10:00:00.000Z',
        usedBy: null,
        usedAt: null,
        status: 'open',
      },
      {
        code: 'Z9Y8-X7W6-V5U4',
        note: null,
        createdBy: ADMIN.id,
        createdAt: '2026-07-01T10:00:00.000Z',
        expiresAt: '2026-07-08T10:00:00.000Z',
        usedBy: 'anna',
        usedAt: '2026-07-02T10:00:00.000Z',
        status: 'used',
      },
    ],
  },
};

const USERS = {
  path: '/users',
  body: { users: [ADMIN, { ...testUser, username: 'anna' }] },
};

const TRASH = {
  path: '/trash',
  body: {
    entries: [
      {
        product: {
          id: 'prod-9',
          ean: '4260000000011',
          name: 'Apfelsaft',
          brand: 'Bio Hof',
          category: 'Getränke',
          notes: null,
          createdBy: ADMIN.id,
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-10T10:00:00.000Z',
        },
        deletedAt: '2026-08-14T10:00:00.000Z',
        deletedBy: ADMIN.id,
        deletedByUsername: 'chef',
        ratings: 2,
        photos: 1,
      },
    ],
  },
};

function renderAdmin() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/settings" element={<p>Einstellungen</p>} />
    </Routes>,
    { route: '/admin' },
  );
}

describe('AdminPage', () => {
  it('sends anyone without the role back to the settings', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderAdmin();

    expect(await screen.findByText('Einstellungen')).toBeInTheDocument();
  });

  it('lists invites with their state', async () => {
    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS, TRASH]);

    renderAdmin();

    expect(await screen.findByText('A1B2-C3D4-E5F6')).toBeInTheDocument();
    expect(screen.getByText(strings.admin.inviteStatusOpen)).toBeInTheDocument();
    expect(screen.getByText(strings.admin.inviteStatusUsed)).toBeInTheDocument();
    expect(screen.getByText(/Für Bert/)).toBeInTheDocument();
    // A code that has been used cannot be withdrawn or shared any more.
    expect(screen.getAllByRole('button', { name: strings.admin.inviteRevoke })).toHaveLength(1);
  });

  it('creates an invite with the note that was typed', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/invites', method: 'POST', body: { invite: INVITES.body.invites[0] } },
      INVITES,
      USERS,
      TRASH,
    ]);

    renderAdmin();
    await screen.findByText('A1B2-C3D4-E5F6');

    await user.type(screen.getByLabelText(new RegExp(strings.admin.inviteNote)), 'Für Clara');
    await user.click(screen.getByRole('button', { name: strings.admin.inviteCreate }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/invites') && (init as RequestInit)?.method === 'POST',
      );
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ note: 'Für Clara' });
    });
  });

  it('lists the trash with what a restore would bring back', async () => {
    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS, TRASH]);

    renderAdmin();

    expect(await screen.findByText('Apfelsaft')).toBeInTheDocument();
    expect(screen.getByText(/2 Bewertungen, 1 Foto/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.admin.trashRestore })).toBeInTheDocument();
  });

  it('asks a second time before a product is gone for good', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/trash/prod-9', method: 'DELETE', body: { ok: true } },
      INVITES,
      USERS,
      TRASH,
    ]);

    renderAdmin();
    await screen.findByText('Apfelsaft');

    await user.click(screen.getByRole('button', { name: strings.admin.trashPurge }));
    // The first tap only arms the button; nothing has left the server yet.
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE'),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: strings.admin.trashPurgeConfirm }));

    await waitFor(() => {
      const purge = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/trash/prod-9') && (init as RequestInit)?.method === 'DELETE',
      );
      expect(purge).toBeDefined();
    });
  });

  it('shows a password link once and marks the account that needs one', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      {
        path: '/users',
        body: {
          users: [ADMIN, { ...testUser, username: 'anna', passwordResetRequired: true }],
        },
      },
      {
        path: `/users/${testUser.id}/reset-link`,
        method: 'POST',
        body: {
          link: {
            username: 'anna',
            token: 'a'.repeat(43),
            url: `http://localhost/reset?token=${'a'.repeat(43)}`,
            expiresAt: '2026-08-24T10:00:00.000Z',
          },
        },
      },
      INVITES,
      TRASH,
    ]);

    renderAdmin();

    // The account that arrived without a password says so.
    expect(await screen.findByText(strings.admin.userNeedsPassword)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: strings.admin.userResetLink }));

    // On screen, not only in the clipboard: without a secure context there is
    // no clipboard, and the link still has to get out.
    expect(await screen.findByText(/\/reset\?token=a{43}/)).toBeInTheDocument();
    expect(screen.getByText(strings.admin.userResetLinkFor('anna'))).toBeInTheDocument();
  });

  it('copies a registration link rather than the bare code', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS, TRASH]);

    renderAdmin();
    await screen.findByText('A1B2-C3D4-E5F6');

    await user.click(screen.getByRole('button', { name: strings.admin.inviteCopyLink }));

    await waitFor(() => {
      // The link carries the code into the form, so nobody types it out.
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('/register?invite=A1B2-C3D4-E5F6'),
      );
    });
    expect(await screen.findByText(strings.common.copied)).toBeInTheDocument();
  });

  it('says so when the clipboard refuses instead of pretending', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
    });

    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS, TRASH]);

    renderAdmin();
    await screen.findByText('A1B2-C3D4-E5F6');

    await user.click(screen.getByRole('button', { name: strings.admin.inviteCopyLink }));

    expect(await screen.findByText(strings.common.copyFailed)).toBeInTheDocument();
  });

  it('sets a new password for another account', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/users/user-1/password', method: 'POST', body: { ok: true, revokedSessions: 1 } },
      INVITES,
      USERS,
      TRASH,
    ]);

    renderAdmin();
    await screen.findByText('anna');

    // The field only appears once the action has been chosen; a password box
    // next to every account invites accidents.
    expect(screen.queryByLabelText(strings.fields.newPassword)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: strings.admin.userResetPassword }));

    await user.type(screen.getByLabelText(strings.fields.newPassword), 'ein-neues-passwort');
    await user.click(screen.getByRole('button', { name: strings.admin.userResetSubmit }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/users/user-1/password'),
      );
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        newPassword: 'ein-neues-passwort',
      });
    });

    expect(await screen.findByText(strings.admin.userResetDone)).toBeInTheDocument();
  });

  it('changes another account but offers nothing on your own', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      { path: '/users/user-1', method: 'PATCH', body: { user: testUser } },
      INVITES,
      USERS,
      TRASH,
    ]);

    renderAdmin();
    await screen.findByText('anna');

    // Locking yourself out of your own instance is not a feature.
    expect(screen.getByText(strings.admin.userSelf)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: strings.admin.userDisable })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: strings.admin.userMakeAdmin }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'PATCH',
      );
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ role: 'admin' });
    });
  });
});
