import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation, useParams } from 'react-router';
import { CataloguePage } from '@/routes/CataloguePage';
import { strings } from '@/lib/strings';
import { mockFetch } from '@/testing/fetchMock';
import {
  CATEGORY_LIST,
  makeProduct,
  makeProductDetail,
  makeProductPage,
  makeRating,
} from '@/testing/fixtures';
import { renderWithProviders } from '@/testing/render';

vi.mock('@/components/BarcodeScanner', () => ({
  BarcodeScanner: ({ onDetected }: { onDetected: (ean: string) => void }) => (
    <button
      type="button"
      onClick={() => {
        onDetected('4006381333931');
      }}
    >
      Test-EAN scannen
    </button>
  ),
}));

/**
 * The catalogue: what is shown, and what the filters turn into.
 *
 * The assertions are on the request the screen produces rather than on the rows
 * it renders after a filter — the filtering itself is the server's job and is
 * tested there. What can only be checked here is that the screen asks the right
 * question.
 */

const CATEGORIES = { path: '/categories', body: { categories: CATEGORY_LIST } };

/** The EAN the mocked scanner reports. */
const SCANNED_EAN = '4006381333931';

/** Stands in for the form, to show where a link led and with which EAN. */
function NewProductStub() {
  const location = useLocation();
  return <p>Neu: {location.search}</p>;
}

function ProductStub() {
  const { id } = useParams();
  return <p>Produkt: {id}</p>;
}

function renderCatalogue() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<CataloguePage />} />
      <Route path="/scan" element={<p>Scanner</p>} />
      <Route path="/products/new" element={<NewProductStub />} />
      <Route path="/products/:id" element={<ProductStub />} />
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

/** The hint shown for an empty list, found by what it says. */
async function emptyStateWith(text: string): Promise<HTMLElement> {
  const paragraph = await screen.findByText(text);
  const box = paragraph.closest<HTMLElement>('.empty-state');
  if (box === null) throw new Error('the text is not inside the empty state');
  return box;
}

/** Unfolds the filters behind "Zusätzliche Filter", whatever its count says. */
async function openMoreFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^Zusätzliche Filter/u }));
}

describe('CataloguePage', () => {
  it('lists the products with their average', async () => {
    mockFetch([
      CATEGORIES,
      {
        path: '/products',
        body: makeProductPage([
          makeProduct({ name: 'Apfelsaft', ratings: { average: 4.5, count: 2 } }),
          makeProduct({ id: 'prod-2', name: 'Haferflocken', variant: null, brand: 'Kölln' }),
        ]),
      },
    ]);

    renderCatalogue();

    expect(await screen.findByText('Apfelsaft')).toBeInTheDocument();
    expect(screen.getByText('Haferflocken')).toBeInTheDocument();
    // The variant is what tells two products of one line apart, so the row
    // shows it; a product without one keeps the line empty, so that every row
    // has the same four lines.
    expect(screen.getByText('naturtrüb')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    for (const row of rows) {
      expect(row.querySelectorAll('.product-card__variant')).toHaveLength(1);
    }
    expect(screen.getByText(strings.catalogue.total(2))).toBeInTheDocument();
    // The average is shown short enough to stay beside the stars, and read out
    // in full.
    expect(screen.getByText(/^4[.,]5 \(2\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^4[.,]5 · 2 Bewertungen$/)).toHaveClass('visually-hidden');
    // A product nobody has rated says so rather than showing zero stars.
    expect(screen.getByText(strings.rating.averageNone)).toBeInTheDocument();
  });

  it('reloads the list when the screen is pulled down at the top', async () => {
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    const before = fetchMock.mock.calls.length;

    // Far enough past the threshold that letting go reloads. The gesture itself
    // is tested in `PullToRefresh.test.tsx`; what matters here is that the
    // catalogue asks the server again.
    fireEvent.touchStart(screen.getByText('Apfelsaft'), {
      touches: [{ clientX: 100, identifier: 1, clientY: 100 }],
    });
    fireEvent.touchMove(screen.getByText('Apfelsaft'), {
      touches: [{ clientX: 100, identifier: 1, clientY: 300 }],
    });
    fireEvent.touchEnd(screen.getByText('Apfelsaft'), { touches: [] });

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });
    expect(lastListUrl(fetchMock.mock.calls)).toContain('/api/v1/products');
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

  it('uses a scanned EAN as the search term', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    await user.click(screen.getByRole('button', { name: strings.catalogue.scanSearch }));
    expect(screen.getByRole('heading', { name: strings.catalogue.scanSearch })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Test-EAN scannen' }));

    expect(screen.getByLabelText(strings.catalogue.search)).toHaveValue('4006381333931');
    expect(
      screen.queryByRole('heading', { name: strings.catalogue.scanSearch }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(lastListUrl(fetchMock.mock.calls)).toContain('q=4006381333931');
    });
  });

  it('clears the search but keeps the other filters', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    // Nothing to clear yet, so there is no button.
    expect(
      screen.queryByRole('button', { name: strings.catalogue.clearSearch }),
    ).not.toBeInTheDocument();

    // The filter is set after the search, so that the list without the term
    // is one the screen has not asked for yet and has to be fetched.
    const input = screen.getByLabelText(strings.catalogue.search);
    await user.type(input, 'saft');
    await waitFor(() => {
      expect(lastListUrl(fetchMock.mock.calls)).toContain('q=saft');
    });
    await openMoreFilters(user);
    await user.selectOptions(screen.getByLabelText(strings.catalogue.kind), 'dish');
    await waitFor(() => {
      const url = lastListUrl(fetchMock.mock.calls);
      expect(url).toContain('q=saft');
      expect(url).toContain('kind=dish');
    });

    await user.click(screen.getByRole('button', { name: strings.catalogue.clearSearch }));

    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: strings.catalogue.clearSearch }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      const url = lastListUrl(fetchMock.mock.calls);
      expect(url).not.toContain('q=');
      expect(url).toContain('kind=dish');
    });
  });

  it('turns the filters into query parameters', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    await openMoreFilters(user);
    await user.selectOptions(screen.getByLabelText(strings.catalogue.category), 'Getränke');
    await user.selectOptions(screen.getByLabelText(strings.catalogue.minStars), String(4));
    await user.click(screen.getByLabelText(strings.catalogue.ratedByMe));
    await user.click(screen.getByLabelText(strings.catalogue.createdByMe));
    await user.click(screen.getByLabelText(strings.catalogue.hasPrice));
    await user.selectOptions(screen.getByLabelText(strings.catalogue.kind), 'dish');
    await user.selectOptions(screen.getByLabelText(strings.catalogue.sort), 'name');

    await waitFor(() => {
      const url = lastListUrl(fetchMock.mock.calls);
      expect(url).toContain('categoryId=cat-drinks');
      expect(url).toContain('minStars=4');
      expect(url).toContain('ratedByMe=true');
      expect(url).toContain('createdByMe=true');
      expect(url).toContain('hasPrice=true');
      expect(url).toContain('kind=dish');
      expect(url).toContain('sort=name');
    });
  });

  it('leaves price watch entries out of the plain list, but not out of a search', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');
    expect(lastListUrl(fetchMock.mock.calls)).toContain('priceWatch=exclude');

    // Typing "Gouda" has to lead to the cheese kept for its price.
    await user.type(screen.getByLabelText(strings.catalogue.search), 'gouda');
    await waitFor(() => {
      const url = lastListUrl(fetchMock.mock.calls);
      expect(url).toContain('q=gouda');
      expect(url).toContain('priceWatch=include');
    });

    // "Nur diese" holds with a search as well.
    await openMoreFilters(user);
    await user.selectOptions(screen.getByLabelText(strings.catalogue.priceWatch), 'only');
    await waitFor(() => {
      expect(lastListUrl(fetchMock.mock.calls)).toContain('priceWatch=only');
    });

    await user.click(screen.getByRole('button', { name: strings.catalogue.clearSearch }));
    await user.selectOptions(screen.getByLabelText(strings.catalogue.priceWatch), 'include');
    await waitFor(() => {
      const url = lastListUrl(fetchMock.mock.calls);
      expect(url).not.toContain('q=');
      expect(url).toContain('priceWatch=include');
    });
    // Anything but the default narrows the list in its own way and counts.
    expect(
      screen.getByRole('button', { name: strings.catalogue.moreFiltersActive(1) }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: strings.catalogue.resetFilters }));
    // Back to the default, which counts as no filter. The plain list is cached
    // already, so a new request is optional and not asserted.
    expect(screen.getByLabelText(strings.catalogue.priceWatch)).toHaveValue('search');
    expect(screen.getByRole('button', { name: strings.catalogue.moreFilters })).toBeInTheDocument();
  });

  it('clears the personal filters and the price filter with reset', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    await openMoreFilters(user);
    const created = screen.getByLabelText(strings.catalogue.createdByMe);
    const rated = screen.getByLabelText(strings.catalogue.ratedByMe);
    const priced = screen.getByLabelText(strings.catalogue.hasPrice);
    await user.click(created);
    await user.click(rated);
    await user.click(priced);

    await waitFor(() => {
      const url = lastListUrl(fetchMock.mock.calls);
      expect(url).toContain('createdByMe=true');
      expect(url).toContain('ratedByMe=true');
      expect(url).toContain('hasPrice=true');
    });

    await user.click(screen.getByRole('button', { name: strings.catalogue.resetFilters }));

    expect(created).not.toBeChecked();
    expect(rated).not.toBeChecked();
    expect(priced).not.toBeChecked();
    // The unfiltered list is already cached, so a new HTTP request is optional.
    expect(
      screen.queryByRole('button', { name: strings.catalogue.resetFilters }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Apfelsaft')).toBeInTheDocument();
  });

  it('says that a filtered list is empty for a different reason', async () => {
    const user = userEvent.setup();
    mockFetch([CATEGORIES, { path: '/products', body: makeProductPage([]) }]);

    renderCatalogue();
    await screen.findByText(strings.catalogue.empty);

    await openMoreFilters(user);
    await user.click(screen.getByLabelText(strings.catalogue.ratedByMe));

    expect(await screen.findByText(strings.catalogue.emptyFiltered)).toBeInTheDocument();
  });

  it('offers to enter a scanned EAN the catalogue does not know', async () => {
    const user = userEvent.setup();
    mockFetch([CATEGORIES, { path: '/products', body: makeProductPage([]) }]);

    renderCatalogue();
    await screen.findByText(strings.catalogue.empty);

    await user.click(screen.getByRole('button', { name: strings.catalogue.scanSearch }));
    await user.click(screen.getByRole('button', { name: 'Test-EAN scannen' }));

    const empty = await emptyStateWith(strings.catalogue.eanUnknown(SCANNED_EAN));
    // Nothing is filtered but the search, so the hint offers nothing to reset;
    // the reset beside the filters still clears the search as always.
    expect(
      within(empty).queryByRole('button', { name: strings.catalogue.resetFilters }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: strings.catalogue.eanCreate }));
    expect(screen.getByText(`Neu: ?ean=${SCANNED_EAN}`)).toBeInTheDocument();
  });

  it('offers the same for a typed EAN, in its thirteen digit form', async () => {
    const user = userEvent.setup();
    mockFetch([CATEGORIES, { path: '/products', body: makeProductPage([]) }]);

    renderCatalogue();
    await screen.findByText(strings.catalogue.empty);

    // UPC-A as printed on imports; the catalogue stores it with a leading zero.
    await user.type(screen.getByLabelText(strings.catalogue.search), '036000291452');

    expect(
      await screen.findByText(strings.catalogue.eanUnknown('0036000291452')),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: strings.catalogue.eanCreate })).toHaveAttribute(
      'href',
      '/products/new?ean=0036000291452',
    );
  });

  it('keeps the plain hint for a search that is no valid EAN', async () => {
    const user = userEvent.setup();
    mockFetch([CATEGORIES, { path: '/products', body: makeProductPage([]) }]);

    renderCatalogue();
    await screen.findByText(strings.catalogue.empty);

    // Thirteen digits, but the check digit is wrong.
    await user.type(screen.getByLabelText(strings.catalogue.search), '4006381333932');

    expect(await screen.findByText(strings.catalogue.emptyFiltered)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: strings.catalogue.eanCreate }),
    ).not.toBeInTheDocument();
  });

  it('asks the lookup under filters, and offers to enter an EAN it does not know', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      // Before the list route: its path is a substring of this one.
      { path: '/products/by-ean/', status: 404, body: { error: { code: 'not_found' } } },
      { path: '/products', body: makeProductPage([]) },
    ]);

    renderCatalogue();
    await screen.findByText(strings.catalogue.empty);

    await openMoreFilters(user);
    await user.click(screen.getByLabelText(strings.catalogue.ratedByMe));
    await user.type(screen.getByLabelText(strings.catalogue.search), SCANNED_EAN);

    const empty = await emptyStateWith(strings.catalogue.eanUnknown(SCANNED_EAN));
    expect(
      within(empty).getByRole('link', { name: strings.catalogue.eanCreate }),
    ).toBeInTheDocument();
    expect(
      within(empty).getByRole('button', { name: strings.catalogue.resetFilters }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => String(url) === `/api/v1/products/by-ean/${SCANNED_EAN}`,
      ),
    ).toBe(true);
  });

  it('leads to a product the filters hide instead of offering to enter it again', async () => {
    const user = userEvent.setup();
    mockFetch([
      CATEGORIES,
      { path: '/products/by-ean/', body: { product: makeProductDetail({ id: 'prod-7' }) } },
      { path: '/products', body: makeProductPage([]) },
    ]);

    renderCatalogue();
    await screen.findByText(strings.catalogue.empty);

    await openMoreFilters(user);
    await user.click(screen.getByLabelText(strings.catalogue.ratedByMe));
    await user.type(screen.getByLabelText(strings.catalogue.search), SCANNED_EAN);

    expect(await screen.findByText(strings.catalogue.eanHidden(SCANNED_EAN))).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: strings.catalogue.eanCreate }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: strings.catalogue.eanOpen }));
    expect(screen.getByText('Produkt: prod-7')).toBeInTheDocument();
  });

  it('does not ask the lookup when no filter could hide the product', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([CATEGORIES, { path: '/products', body: makeProductPage([]) }]);

    renderCatalogue();
    await screen.findByText(strings.catalogue.empty);

    await user.type(screen.getByLabelText(strings.catalogue.search), SCANNED_EAN);
    await screen.findByText(strings.catalogue.eanUnknown(SCANNED_EAN));

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/by-ean/'))).toBe(false);
  });

  it('shows only the search line until the other filters are unfolded', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', body: makeProductPage([makeProduct()]) },
    ]);

    renderCatalogue();
    await screen.findByText('Apfelsaft');

    expect(screen.getByLabelText(strings.catalogue.search)).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: strings.catalogue.moreFilters });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (const label of [
      strings.catalogue.category,
      strings.catalogue.minStars,
      strings.catalogue.kind,
      strings.catalogue.sort,
      strings.catalogue.order,
      strings.catalogue.createdByMe,
      strings.catalogue.ratedByMe,
      strings.catalogue.hasPrice,
      strings.catalogue.priceWatch,
    ]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'catalogue-more-filters');
    await user.click(screen.getByLabelText(strings.catalogue.hasPrice));
    await user.selectOptions(screen.getByLabelText(strings.catalogue.minStars), String(4));
    // Sorting is not a filter and does not count.
    await user.selectOptions(screen.getByLabelText(strings.catalogue.sort), 'name');

    // Folded again, the button still says that the list is narrowed down, and
    // the reset stays within reach.
    await user.click(toggle);
    expect(screen.queryByLabelText(strings.catalogue.hasPrice)).not.toBeInTheDocument();
    expect(toggle).toHaveAccessibleName(strings.catalogue.moreFiltersActive(2));
    await waitFor(() => {
      expect(lastListUrl(fetchMock.mock.calls)).toContain('hasPrice=true');
    });

    await user.click(screen.getByRole('button', { name: strings.catalogue.resetFilters }));
    expect(toggle).toHaveAccessibleName(strings.catalogue.moreFilters);
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
