import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { SettingsPage } from '@/routes/SettingsPage';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';

/** The account screen: password, devices, and the way out. */

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const SESSIONS = {
  path: '/auth/sessions',
  body: {
    sessions: [
      {
        id: 'sess-1',
        userAgent: IPHONE,
        createdAt: '2026-08-01T10:00:00.000Z',
        lastSeenAt: '2026-08-15T11:55:00.000Z',
        expiresAt: '2026-11-01T10:00:00.000Z',
        current: true,
      },
      {
        id: 'sess-2',
        userAgent: WINDOWS,
        createdAt: '2026-07-01T10:00:00.000Z',
        lastSeenAt: '2026-08-10T09:00:00.000Z',
        expiresAt: '2026-10-01T10:00:00.000Z',
        current: false,
      },
    ],
  },
};

function renderSettings() {
  return renderWithProviders(
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/login" element={<p>Anmelden</p>} />
      <Route path="/admin" element={<p>Verwaltung</p>} />
    </Routes>,
    { route: '/settings' },
  );
}

describe('SettingsPage', () => {
  it('names the devices instead of printing the user agent', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }, SESSIONS]);

    renderSettings();

    expect(await screen.findByText('iPhone · Safari')).toBeInTheDocument();
    expect(screen.getByText('Windows · Chrome')).toBeInTheDocument();
    // A hundred characters of version numbers answer nobody's question.
    expect(screen.queryByText(/AppleWebKit/)).not.toBeInTheDocument();
  });

  it('marks the current session and offers no way to end it here', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }, SESSIONS]);

    renderSettings();

    expect(await screen.findByText(strings.settings.sessionCurrent)).toBeInTheDocument();
    // One button, for the other device — ending this one is what logging out is.
    expect(
      screen.getByRole('button', {
        name: strings.settings.sessionRevokeFor('Windows · Chrome'),
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: strings.settings.sessionRevokeFor('iPhone · Safari'),
      }),
    ).not.toBeInTheDocument();
  });

  it('revokes another session', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      { path: '/auth/sessions/sess-2', method: 'DELETE', body: { ok: true } },
      SESSIONS,
    ]);

    renderSettings();
    await screen.findByText('Windows · Chrome');

    await user.click(
      screen.getByRole('button', {
        name: strings.settings.sessionRevokeFor('Windows · Chrome'),
      }),
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/auth/sessions/sess-2') &&
            (init as RequestInit)?.method === 'DELETE',
        ),
      ).toBe(true);
    });
  });

  it('changes the password and says how many sessions that ended', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      { path: '/auth/password', method: 'POST', body: { ok: true, revokedSessions: 2 } },
      SESSIONS,
    ]);

    renderSettings();
    await screen.findByText('iPhone · Safari');

    await user.type(screen.getByLabelText(strings.fields.currentPassword), 'altes-passwort');
    await user.type(screen.getByLabelText(strings.fields.newPassword), 'ein-neues-passwort');
    await user.click(screen.getByRole('button', { name: strings.settings.passwordSubmit }));

    expect(await screen.findByText(strings.settings.passwordChanged(2))).toBeInTheDocument();
  });

  it('blames the current password rather than the session on a 401', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      {
        path: '/auth/password',
        method: 'POST',
        status: 401,
        body: { error: { code: 'unauthorized' } },
      },
      SESSIONS,
    ]);

    renderSettings();
    await screen.findByText('iPhone · Safari');

    await user.type(screen.getByLabelText(strings.fields.currentPassword), 'falsch');
    await user.type(screen.getByLabelText(strings.fields.newPassword), 'ein-neues-passwort');
    await user.click(screen.getByRole('button', { name: strings.settings.passwordSubmit }));

    expect(await screen.findByText(strings.settings.passwordWrong)).toBeInTheDocument();
  });

  it('logs out from here as well as from the header', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      { path: '/auth/logout', method: 'POST', body: { ok: true } },
      SESSIONS,
    ]);

    renderSettings();
    await screen.findByText('iPhone · Safari');

    await user.click(screen.getByRole('button', { name: strings.common.logout }));

    expect(await screen.findByText('Anmelden')).toBeInTheDocument();
  });

  it('shows the way to the administration only to administrators', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }, SESSIONS]);
    const view = renderSettings();
    await screen.findByText('iPhone · Safari');
    expect(screen.queryByRole('link', { name: strings.settings.toAdmin })).not.toBeInTheDocument();
    view.unmount();

    mockFetch([{ path: '/auth/me', body: { user: { ...testUser, role: 'admin' } } }, SESSIONS]);
    renderSettings();

    expect(await screen.findByRole('link', { name: strings.settings.toAdmin })).toBeInTheDocument();
  });
});
