import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { LoginPage } from '@/routes/LoginPage';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';

/**
 * The login screen is driven through the real client and the real cache; only
 * `fetch` is replaced. The catalogue behind it is a stub, so a successful login
 * is visible as a change of address.
 */

function renderLogin(route = '/login', state?: unknown) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<p>Katalog</p>} />
      <Route path="/settings" element={<p>Einstellungen</p>} />
    </Routes>,
    state === undefined ? { route } : { route, state },
  );
}

const anonymous = { path: '/auth/me', status: 401, body: { error: { code: 'unauthorized' } } };

describe('LoginPage', () => {
  it('logs in and moves on to the catalogue', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      anonymous,
      { path: '/auth/login', method: 'POST', body: { user: testUser } },
    ]);

    renderLogin();

    await user.type(screen.getByLabelText(strings.login.username), 'Anna');
    await user.type(screen.getByLabelText(strings.login.password), 'ein-gutes-passwort');
    await user.click(screen.getByRole('button', { name: strings.login.submit }));

    expect(await screen.findByText('Katalog')).toBeInTheDocument();

    const login = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/login'));
    // The shared schema lower-cases the username before it is sent.
    expect((login?.[1] as RequestInit).body).toBe(
      JSON.stringify({ username: 'anna', password: 'ein-gutes-passwort' }),
    );
  });

  it('returns to the screen the user was sent away from', async () => {
    const user = userEvent.setup();
    mockFetch([anonymous, { path: '/auth/login', method: 'POST', body: { user: testUser } }]);

    // This is the state `RequireAuth` attaches when it sends someone here.
    renderLogin('/login', { from: '/settings' });

    await user.type(screen.getByLabelText(strings.login.username), 'anna');
    await user.type(screen.getByLabelText(strings.login.password), 'ein-gutes-passwort');
    await user.click(screen.getByRole('button', { name: strings.login.submit }));

    expect(await screen.findByText('Einstellungen')).toBeInTheDocument();
  });

  it('names a wrong password instead of talking about an expired session', async () => {
    const user = userEvent.setup();
    mockFetch([
      anonymous,
      {
        path: '/auth/login',
        method: 'POST',
        status: 401,
        body: { error: { code: 'unauthorized', message: 'username or password is wrong' } },
      },
    ]);

    renderLogin();

    await user.type(screen.getByLabelText(strings.login.username), 'anna');
    await user.type(screen.getByLabelText(strings.login.password), 'falsch');
    await user.click(screen.getByRole('button', { name: strings.login.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.login.wrongCredentials);
    expect(screen.queryByText('Katalog')).not.toBeInTheDocument();
  });

  it('shows how long the rate limit lasts', async () => {
    const user = userEvent.setup();
    mockFetch([
      anonymous,
      {
        path: '/auth/login',
        method: 'POST',
        status: 429,
        body: { error: { code: 'rate_limited', details: { retryAfterSeconds: 30 } } },
      },
    ]);

    renderLogin();

    await user.type(screen.getByLabelText(strings.login.username), 'anna');
    await user.type(screen.getByLabelText(strings.login.password), 'falsch');
    await user.click(screen.getByRole('button', { name: strings.login.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.errors.rateLimited(30));
  });

  it('catches an impossible username before the request', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([anonymous]);

    renderLogin();

    await user.type(screen.getByLabelText(strings.login.username), 'a!');
    await user.type(screen.getByLabelText(strings.login.password), 'ein-gutes-passwort');
    await user.click(screen.getByRole('button', { name: strings.login.submit }));

    expect(await screen.findByText(strings.validation.username)).toBeInTheDocument();
    expect(screen.getByLabelText(strings.login.username)).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/login'))).toBe(false);
  });

  it('keeps a logged in account away from the form', async () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderLogin();

    expect(await screen.findByText('Katalog')).toBeInTheDocument();
  });
});
