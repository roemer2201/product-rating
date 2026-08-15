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
    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS]);

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

  it('copies a registration link rather than the bare code', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS]);

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

    mockFetch([{ path: '/auth/me', body: { user: ADMIN } }, INVITES, USERS]);

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
