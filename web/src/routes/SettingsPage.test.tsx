import { describe, expect, it } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { SettingsPage } from '@/routes/SettingsPage';
import { strings } from '@/lib/strings';
import { enqueueCapture, listCaptures } from '@/lib/offlineQueue';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { makeProductDetail, makeRating, TEST_EAN } from '@/testing/fixtures';
import { createTestQueryClient, renderWithProviders } from '@/testing/render';
import { APP_VERSION } from '@/lib/version';
import { setOnline } from '@/testing/online';
import { captureOwner } from '@/lib/captureIdentity';
import { createQueryClient, queryKeys } from '@/lib/queries';

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

function renderSettings(client = createTestQueryClient()) {
  return renderWithProviders(
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/login" element={<p>Anmelden</p>} />
      <Route path="/admin" element={<p>Verwaltung</p>} />
    </Routes>,
    { route: '/settings', client },
  );
}

describe('SettingsPage', () => {
  it('shows the version of the app and nothing more while the server agrees', async () => {
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      SESSIONS,
      { path: '/healthz', body: { status: 'ok', version: APP_VERSION } },
    ]);

    renderSettings();

    expect(await screen.findByText(strings.settings.version(APP_VERSION))).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/^Server /u)).not.toBeInTheDocument();
    });
  });

  it('points out a newer server, because the app here still has to update', async () => {
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      SESSIONS,
      // A degraded server still says which version it is.
      { path: '/healthz', status: 503, body: { status: 'degraded', version: '999.0.0' } },
    ]);

    renderSettings();

    expect(await screen.findByText(strings.settings.serverVersionNewer('999.0.0'))).toBeVisible();
    expect(screen.getByText(strings.settings.version(APP_VERSION))).toBeInTheDocument();
  });

  it('names an older server without asking for an update', async () => {
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      SESSIONS,
      { path: '/healthz', body: { status: 'ok', version: '0.0.1' } },
    ]);

    renderSettings();

    expect(await screen.findByText(strings.settings.serverVersion('0.0.1'))).toBeVisible();
  });

  it('saves a display name and says how the others will see it', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      SESSIONS,
      {
        path: '/auth/profile',
        method: 'PATCH',
        body: { user: { ...testUser, displayName: 'Anna aus dem Bad' } },
      },
    ]);

    renderSettings();

    const field = await screen.findByLabelText(new RegExp(strings.settings.displayNameLabel, 'iu'));
    await user.type(field, 'Anna aus dem Bad');
    await user.click(screen.getByRole('button', { name: strings.settings.displayNameSubmit }));

    expect(
      await screen.findByText(strings.settings.displayNameSaved('Anna aus dem Bad')),
    ).toBeInTheDocument();

    const request = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/profile'));
    expect(JSON.parse(String((request?.[1] as RequestInit).body))).toEqual({
      displayName: 'Anna aus dem Bad',
    });
  });

  it('sends null when the field is emptied, which gives the name up', async () => {
    const user = userEvent.setup();
    const named = { ...testUser, displayName: 'Anna aus dem Bad' };
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: named } },
      SESSIONS,
      { path: '/auth/profile', method: 'PATCH', body: { user: testUser } },
    ]);

    renderSettings();

    const field = await screen.findByDisplayValue('Anna aus dem Bad');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: strings.settings.displayNameSubmit }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/profile'));
      expect(JSON.parse(String((request?.[1] as RequestInit).body))).toEqual({ displayName: null });
    });
  });

  it('lists what was captured offline and transfers it on request', async () => {
    const user = userEvent.setup();
    await enqueueCapture({
      ean: TEST_EAN,
      label: 'Apfelsaft',
      rating: { stars: 4, comment: null, capturedAt: Date.parse('2026-08-20T10:00:00.000Z') },
    });

    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      SESSIONS,
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: makeProductDetail() } },
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
      {
        path: '/products/prod-1/rating',
        method: 'PUT',
        body: { rating: makeRating(), ratings: { average: 4, count: 1 } },
      },
    ]);

    renderSettings();

    expect(await screen.findByText('Apfelsaft')).toBeInTheDocument();
    // The parentheses in the label are text, not a pattern.
    expect(screen.getByText(/Enthält/)).toHaveTextContent(strings.offlineCapture.partRating(4));

    await user.click(screen.getByRole('button', { name: strings.offlineCapture.sync }));

    await waitFor(async () => {
      expect(await listCaptures()).toEqual([]);
    });
    expect(await screen.findByText(strings.offlineCapture.empty)).toBeInTheDocument();
  });

  it('asks which verdict counts when both changed', async () => {
    const user = userEvent.setup();
    await enqueueCapture({
      ean: TEST_EAN,
      label: 'Apfelsaft',
      rating: { stars: 2, comment: null, capturedAt: Date.parse('2026-08-20T10:00:00.000Z') },
    });

    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      SESSIONS,
      { path: `/products/by-ean/${TEST_EAN}`, body: { product: makeProductDetail() } },
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            // Rated elsewhere after the capture was written down.
            ownRating: makeRating({ stars: 5, updatedAt: '2026-08-21T09:00:00.000Z' }),
          }),
        },
      },
    ]);

    renderSettings();
    await screen.findByText('Apfelsaft');

    await user.click(screen.getByRole('button', { name: strings.offlineCapture.sync }));

    expect(await screen.findByText(strings.offlineCapture.conflictTitle)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: strings.offlineCapture.keepMine }),
    ).toBeInTheDocument();

    // Deciding for the server verdict drops the capture; nothing else is in it.
    await user.click(screen.getByRole('button', { name: strings.offlineCapture.keepServer }));
    await waitFor(async () => {
      expect(await listCaptures()).toEqual([]);
    });
  });

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

  it.each([
    { outcome: 'success', response: { body: { ok: true } } },
    { outcome: 'a network error', response: { networkError: true } },
    { outcome: 'a server error', response: { status: 503 } },
    { outcome: 'an expired session', response: { status: 401 } },
  ])('posts the logout and clears local account data after $outcome', async ({ response }) => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      { path: '/auth/logout', method: 'POST', ...response },
      { path: '/healthz', body: { version: APP_VERSION } },
      SESSIONS,
    ]);
    const client = createQueryClient();
    client.setQueryData(queryKeys.ratings.all, ['private rating']);

    renderSettings(client);
    await screen.findByText('iPhone · Safari');

    await user.click(screen.getByRole('button', { name: strings.common.logout }));

    expect(await screen.findByText('Anmelden')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/logout$/u),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(client.getQueryData(queryKeys.session)).toBeNull();
    expect(client.getQueryData(queryKeys.ratings.all)).toBeUndefined();
    expect(captureOwner()).toBeNull();
  });

  it('ends the session locally without waiting for the device to come online', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      { path: '/auth/logout', method: 'POST', networkError: true },
      { path: '/healthz', body: { version: APP_VERSION } },
      SESSIONS,
    ]);

    const client = createQueryClient();
    client.setQueryData(queryKeys.ratings.all, ['private rating']);
    const view = renderSettings(client);
    await screen.findByText('iPhone · Safari');

    try {
      setOnline(false);
      onlineManager.setOnline(false);
      await user.click(screen.getByRole('button', { name: strings.common.logout }));

      expect(await screen.findByText('Anmelden')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/auth\/logout$/u),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(client.getQueryData(queryKeys.session)).toBeNull();
      expect(client.getQueryData(queryKeys.ratings.all)).toBeUndefined();
      expect(captureOwner()).toBeNull();
    } finally {
      view.unmount();
      onlineManager.setOnline(true);
    }
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
