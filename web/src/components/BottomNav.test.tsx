import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { BottomNav } from '@/components/BottomNav';
import { strings } from '@/lib/strings';
import { renderWithProviders } from '@/testing/render';

describe('BottomNav', () => {
  it('leads to all four screens', () => {
    renderWithProviders(<BottomNav />);

    const nav = screen.getByRole('navigation', { name: strings.nav.label });
    expect(nav).toBeInTheDocument();

    for (const label of [
      strings.nav.catalogue,
      strings.nav.scan,
      strings.nav.ratings,
      strings.nav.settings,
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the current screen', () => {
    renderWithProviders(<BottomNav />, { route: '/ratings' });

    expect(screen.getByRole('link', { name: strings.nav.ratings })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // `/` is a prefix of every path and must not be active as well.
    expect(screen.getByRole('link', { name: strings.nav.catalogue })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
