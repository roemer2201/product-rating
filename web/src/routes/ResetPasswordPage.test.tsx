import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { ResetPasswordPage } from '@/routes/ResetPasswordPage';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';

/**
 * The screen somebody lands on with a password link.
 *
 * Everything about it is a consequence of one fact: the person opening it
 * cannot log in. So the link is checked before a password is typed, and a
 * successful reset walks straight into the app.
 */

const TOKEN = 'a'.repeat(43);

function renderReset(route = `/reset?token=${TOKEN}`) {
  return renderWithProviders(
    <Routes>
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route path="/" element={<p>Katalog</p>} />
      <Route path="/login" element={<p>Anmelden</p>} />
    </Routes>,
    { route },
  );
}

const anonymous = { path: '/auth/me', status: 401, body: { error: { code: 'unauthorized' } } };

describe('ResetPasswordPage', () => {
  it('names the account and sets the password, then goes on to the catalogue', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      anonymous,
      { path: `/auth/reset/${TOKEN}`, body: { username: 'anna' } },
      { path: '/auth/reset', method: 'POST', body: { user: testUser } },
    ]);

    renderReset();

    expect(await screen.findByText(strings.reset.forUser('anna'))).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(new RegExp(strings.reset.password)),
      'ein-neues-passwort',
    );
    await user.click(screen.getByRole('button', { name: strings.reset.submit }));

    expect(await screen.findByText('Katalog')).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/auth/reset') && (init as RequestInit)?.method === 'POST',
    );
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      token: TOKEN,
      newPassword: 'ein-neues-passwort',
    });
  });

  it('says a spent link is spent before a password is typed', async () => {
    mockFetch([
      anonymous,
      {
        path: `/auth/reset/${TOKEN}`,
        status: 400,
        body: { error: { code: 'invalid_request', details: { field: 'token' } } },
      },
    ]);

    renderReset();

    expect(await screen.findByText(strings.reset.invalid)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: strings.reset.submit })).not.toBeInTheDocument();
  });

  it('explains an address without a token instead of asking for a password', async () => {
    mockFetch([anonymous]);

    renderReset('/reset');

    expect(await screen.findByText(strings.reset.missing)).toBeInTheDocument();
  });
});
