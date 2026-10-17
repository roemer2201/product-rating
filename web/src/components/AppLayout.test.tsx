import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { SettingsPage } from '@/routes/SettingsPage';
import { createQueryClient, queryKeys } from '@/lib/queries';
import { strings } from '@/lib/strings';
import { APP_VERSION } from '@/lib/version';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';

function renderLayout() {
  return renderWithProviders(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<p>Katalogansicht</p>} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="/login" element={<p>Anmeldemaske</p>} />
    </Routes>,
    { client: createQueryClient() },
  );
}

describe('AppLayout', () => {
  it('names the logged in account and shows the screen', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderLayout();

    expect(await screen.findByText(strings.session.loggedInAsLabel)).toBeInTheDocument();
    expect(screen.getByText('anna')).toBeInTheDocument();
    expect(screen.getByText('Katalogansicht')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: strings.nav.label })).toBeInTheDocument();
  });

  it('leaves logging out to the settings page', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderLayout();
    await screen.findByText(strings.session.loggedInAsLabel);

    expect(screen.queryByRole('button', { name: strings.common.logout })).not.toBeInTheDocument();
  });

  it('reaches the only logout through the navigation and leaves the protected layout', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      { path: '/auth/sessions', body: { sessions: [] } },
      { path: '/auth/logout', method: 'POST', body: { ok: true } },
      { path: '/healthz', body: { version: APP_VERSION } },
    ]);

    const { client } = renderLayout();
    await screen.findByText('Katalogansicht');

    await user.click(screen.getByRole('link', { name: strings.nav.settings }));

    expect(await screen.findByRole('heading', { name: strings.settings.title })).toBeVisible();
    expect(
      within(screen.getByRole('banner')).queryByRole('button', { name: strings.common.logout }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: strings.common.logout }));

    expect(await screen.findByText('Anmeldemaske')).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(client.getQueryData(queryKeys.session)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/logout$/u),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
