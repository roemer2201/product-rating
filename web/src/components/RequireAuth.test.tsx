import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { RequireAuth } from '@/components/RequireAuth';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';

/**
 * The gate has to keep three cases apart: not yet known, not logged in, and a
 * server that cannot be asked. Only the middle one may lead to the login form.
 */

function renderGate(route = '/protected') {
  return renderWithProviders(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/protected" element={<p>Geschützter Inhalt</p>} />
      </Route>
      <Route path="/login" element={<p>Anmeldemaske</p>} />
    </Routes>,
    { route },
  );
}

describe('RequireAuth', () => {
  it('waits while the session is being looked up', () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderGate();

    expect(screen.getByText(strings.session.checking)).toBeInTheDocument();
  });

  it('shows the screen once the account is known', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderGate();

    expect(await screen.findByText('Geschützter Inhalt')).toBeInTheDocument();
  });

  it('sends anonymous visitors to the login form', async () => {
    mockFetch([{ path: '/auth/me', status: 401, body: { error: { code: 'unauthorized' } } }]);

    renderGate();

    expect(await screen.findByText('Anmeldemaske')).toBeInTheDocument();
  });

  it('does not log anyone out because the server is unreachable', async () => {
    mockFetch([{ path: '/auth/me', networkError: true }]);

    renderGate();

    expect(await screen.findByText(strings.errors.network)).toBeInTheDocument();
    expect(screen.queryByText('Anmeldemaske')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.common.retry })).toBeInTheDocument();
  });
});
