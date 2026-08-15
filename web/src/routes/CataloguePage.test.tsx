import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { CataloguePage } from '@/routes/CataloguePage';
import { strings } from '@/lib/strings';
import { mockFetch } from '@/testing/fetchMock';
import { makeProduct, makeProductPage, makeRating } from '@/testing/fixtures';
import { renderWithProviders } from '@/testing/render';

/**
 * The catalogue: what is shown, and what the filters turn into.
 *
 * The assertions are on the request the screen produces rather than on the rows
 * it renders after a filter — the filtering itself is the server's job and is
 * tested there. What can only be checked here is that the screen asks the right
 * question.
 */

const CATEGORIES = { path: '/products/categories', body: { categories: ['Getränke'] } };

function renderCatalogue() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<CataloguePage />} />
      <Route path="/scan" element={<p>Scanner</p>} />
    </Routes>,
    { route: '/' },
  );
}

/** The last call to the product list, which is the one the filters produced. */
function lastListUrl(calls: unknown[][]): string {
  const urls = calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/v1/products?') || url === '/api/v1/products');

  return urls.at(-1) ?? '';
}

describe('CataloguePage', () => {
  it('lists the products with their average', async () => {
    mockFetch([
      CATEGORIES,
      {
        path: '/products',
        body: makeProductPage([
          makeProduct({ name: 'Apfelsaft', ratings: { average: 4.5, count: 2 } }),
          makeProduct({ id: 'prod-2', name: 'Haferflocken', brand: 'Kölln' }),
        ]),
      },
    ]);

    renderCatalogue();

    expect(await screen.findByText('Apfelsaft')).toBeInTheDocument();
    expect(screen.getByText('Haferflocken')).toBeInTheDocument();
    expect(screen.getByText(strings.catalogue.total(2))).toBeInTheDocument();
    expect(screen.getByText(/4[.,]5/)).toBeInTheDocument();
    // A product nobody has rated says so rather than showing zero stars.
    expect(screen.getByText(strings.rating.averageNone)).toBeInTheDocument();
  });

  it('offers the scanner when the catalogue is empty', async () => {
    mockFetch([CATEGORIES, { path: '/products', body: makeProductPage([]) }]);

    renderCatalogue();

    expect(await screen.findByText(strings.catalogue.empty)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('link', { name: strings.nav.scan }));
    expect(screen.getByText('Scanner')).toBeInTheDocument();
  });

  it('waits for a pause in the typing before it searches', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    await user.type(screen.getByLabelText(strings.catalogue.search), 'saft');

    await waitFor(() => {
      expect(lastListUrl(fetchMock.mock.calls)).toContain('q=saft');
    });

    // Four keystrokes, but not four searches: the first list plus one for the
    // finished term.
    const searches = fetchMock.mock.calls.filter(([url]) => String(url).includes('q='));
    expect(searches).toHaveLength(1);
  });

  it('turns the filters into query parameters', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    await user.selectOptions(screen.getByLabelText(strings.catalogue.category), 'Getränke');
    await user.selectOptions(screen.getByLabelText(strings.catalogue.minStars), String(4));
    await user.click(screen.getByLabelText(strings.catalogue.ratedByMe));
    await user.selectOptions(screen.getByLabelText(strings.catalogue.sort), 'name');

    await waitFor(() => {
      const url = lastListUrl(fetchMock.mock.calls);
      expect(url).toContain('category=Getr%C3%A4nke');
      expect(url).toContain('minStars=4');
      expect(url).toContain('ratedByMe=true');
      expect(url).toContain('sort=name');
    });
  });

  it('says that a filtered list is empty for a different reason', async () => {
    const user = userEvent.setup();
    mockFetch([CATEGORIES, { path: '/products', body: makeProductPage([]) }]);

    renderCatalogue();
    await screen.findByText(strings.catalogue.empty);

    await user.click(screen.getByLabelText(strings.catalogue.ratedByMe));

    expect(await screen.findByText(strings.catalogue.emptyFiltered)).toBeInTheDocument();
  });

  it('loads the next page on demand', async () => {
    const user = userEvent.setup();
    let page = 0;

    // Two pages, handed out in order; the second one ends the list.
    const fetchMock = mockFetch([
      CATEGORIES,
      {
        path: '/products',
        get body() {
          page += 1;
          return page === 1
            ? { ...makeProductPage([makeProduct()], 'cursor-2'), total: 2 }
            : {
                ...makeProductPage([
                  makeProduct({ id: 'prod-2', name: 'Haferflocken', ownRating: makeRating() }),
                ]),
                total: 2,
              };
        },
      },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    await user.click(screen.getByRole('button', { name: strings.common.loadMore }));

    expect(await screen.findByText('Haferflocken')).toBeInTheDocument();
    // The first page is still there; a page is added, not replaced.
    expect(screen.getByText('Apfelsaft')).toBeInTheDocument();
    expect(lastListUrl(fetchMock.mock.calls)).toContain('cursor=cursor-2');
  });
});
