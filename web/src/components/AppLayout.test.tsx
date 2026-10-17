import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
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
    </Routes>,
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
});
