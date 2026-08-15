import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';

function renderLayout() {
  return renderWithProviders(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<p>Katalogansicht</p>} />
      </Route>
      <Route path="/login" element={<p>Anmeldemaske</p>} />
    </Routes>,
  );
}

describe('AppLayout', () => {
  it('names the logged in account and shows the screen', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderLayout();

    expect(await screen.findByText(strings.session.loggedInAs('anna'))).toBeInTheDocument();
    expect(screen.getByText('Katalogansicht')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: strings.nav.label })).toBeInTheDocument();
  });

  it('logs out and returns to the login form', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      { path: '/auth/logout', method: 'POST', body: { ok: true } },
    ]);

    renderLayout();
    await screen.findByText(strings.session.loggedInAs('anna'));

    await user.click(screen.getByRole('button', { name: strings.common.logout }));

    expect(await screen.findByText('Anmeldemaske')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/logout'))).toBe(true);
  });

  it('ends the session locally even when the request fails', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      { path: '/auth/logout', method: 'POST', networkError: true },
    ]);

    renderLayout();
    await screen.findByText(strings.session.loggedInAs('anna'));

    await user.click(screen.getByRole('button', { name: strings.common.logout }));

    expect(await screen.findByText('Anmeldemaske')).toBeInTheDocument();
  });
});
