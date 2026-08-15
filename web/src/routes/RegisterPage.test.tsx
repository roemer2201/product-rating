import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { RegisterPage } from '@/routes/RegisterPage';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';

function renderRegister(route = '/register') {
  return renderWithProviders(
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<p>Katalog</p>} />
    </Routes>,
    { route },
  );
}

const anonymous = { path: '/auth/me', status: 401, body: { error: { code: 'unauthorized' } } };

describe('RegisterPage', () => {
  it('takes the invite code out of the link', () => {
    mockFetch([anonymous]);

    renderRegister('/register?invite=A1B2-C3D4-E5F6');

    expect(screen.getByLabelText(strings.register.invite)).toHaveValue('A1B2-C3D4-E5F6');
  });

  it('creates the account and lands in the catalogue', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      anonymous,
      { path: '/auth/register', method: 'POST', status: 201, body: { user: testUser } },
    ]);

    renderRegister('/register?invite=A1B2-C3D4-E5F6');

    await user.type(screen.getByLabelText(strings.register.username), 'anna');
    await user.type(screen.getByLabelText(strings.register.password), 'ein-gutes-passwort');
    await user.click(screen.getByRole('button', { name: strings.register.submit }));

    expect(await screen.findByText('Katalog')).toBeInTheDocument();

    const request = fetchMock.mock.calls.find(([url]) => String(url).includes('/auth/register'));
    // An empty e-mail field means "not set", not an empty string.
    expect(JSON.parse(String((request?.[1] as RequestInit).body))).toEqual({
      username: 'anna',
      password: 'ein-gutes-passwort',
      email: null,
      invite: 'A1B2-C3D4-E5F6',
    });
  });

  it('puts a taken username next to its field', async () => {
    const user = userEvent.setup();
    mockFetch([
      anonymous,
      {
        path: '/auth/register',
        method: 'POST',
        status: 409,
        body: { error: { code: 'conflict', details: { field: 'username' } } },
      },
    ]);

    renderRegister('/register?invite=A1B2-C3D4-E5F6');

    await user.type(screen.getByLabelText(strings.register.username), 'anna');
    await user.type(screen.getByLabelText(strings.register.password), 'ein-gutes-passwort');
    await user.click(screen.getByRole('button', { name: strings.register.submit }));

    expect(await screen.findByText(strings.errors.usernameTaken)).toBeInTheDocument();
    expect(screen.getByLabelText(strings.register.username)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('explains a password the server considers too short', async () => {
    const user = userEvent.setup();
    mockFetch([
      anonymous,
      {
        path: '/auth/register',
        method: 'POST',
        status: 400,
        body: {
          error: { code: 'invalid_request', details: { field: 'password', minimum: 12 } },
        },
      },
    ]);

    renderRegister('/register?invite=A1B2-C3D4-E5F6');

    await user.type(screen.getByLabelText(strings.register.username), 'anna');
    await user.type(screen.getByLabelText(strings.register.password), 'kurz');
    await user.click(screen.getByRole('button', { name: strings.register.submit }));

    expect(await screen.findByText(strings.errors.passwordTooShort(12))).toBeInTheDocument();
  });

  it('insists on an invite code before asking the server', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([anonymous]);

    renderRegister();

    await user.type(screen.getByLabelText(strings.register.username), 'anna');
    await user.type(screen.getByLabelText(strings.register.password), 'ein-gutes-passwort');
    await user.click(screen.getByRole('button', { name: strings.register.submit }));

    expect(await screen.findByText(strings.validation.invite)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/register'))).toBe(
      false,
    );
  });
});
