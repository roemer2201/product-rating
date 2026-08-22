import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { ProductPage } from '@/routes/ProductPage';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import {
  makePhoto,
  makePrice,
  makeProductDetail,
  makeProductRating,
  makeRating,
} from '@/testing/fixtures';
import { renderWithProviders } from '@/testing/render';
import { mockUpload } from '@/testing/xhrMock';

/**
 * The product screen: reading it, rating it, correcting it, deleting it.
 *
 * The three numbers on this screen mean different things — the own rating, the
 * household average, the number of votes — and most of what is checked here is
 * that they stay apart, both on screen and in the requests they cause.
 */

const CATEGORIES = { path: '/products/categories', body: { categories: ['Getränke'] } };

/** Who is logged in is decided by the `/auth/me` route the test sets up. */
function renderProduct() {
  return renderWithProviders(
    <Routes>
      <Route path="/products/:id" element={<ProductPage />} />
      <Route path="/" element={<p>Katalog</p>} />
    </Routes>,
    { route: '/products/prod-1' },
  );
}

const ADMIN = { ...testUser, id: 'admin-1', username: 'chef', role: 'admin' as const };

describe('ProductPage', () => {
  it('shows the product with its average and its own rating', async () => {
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            ratings: { average: 4.5, count: 2 },
            ownRating: makeRating({ stars: 5, comment: 'Sehr gut' }),
          }),
        },
      },
    ]);

    renderProduct();

    expect(await screen.findByRole('heading', { name: 'Apfelsaft' })).toBeInTheDocument();
    expect(screen.getByText(/Bio Hof/)).toBeInTheDocument();

    // Average and number of votes belong to the same fact and are read as one.
    const average = screen.getByText(strings.rating.average).parentElement;
    expect(average).toHaveTextContent(/4[.,]5/);
    expect(average).toHaveTextContent(strings.rating.count(2));

    // The own rating is in the editor, ready to be changed.
    expect(screen.getByRole('radio', { name: strings.rating.starLabel(5) })).toBeChecked();
    expect(screen.getByLabelText(new RegExp(strings.rating.comment))).toHaveValue('Sehr gut');
  });

  it('saves a rating only when the button is pressed', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      {
        path: '/products/prod-1/rating',
        method: 'PUT',
        body: {
          rating: makeRating({ stars: 3, comment: 'geht so' }),
          ratings: { average: 3, count: 1 },
        },
      },
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
    ]);

    renderProduct();
    await screen.findByRole('heading', { name: 'Apfelsaft' });

    await user.click(screen.getByRole('radio', { name: strings.rating.starLabel(3) }));
    await user.type(screen.getByLabelText(new RegExp(strings.rating.comment)), 'geht so');

    // A tap on a star is not a save; brushing one while scrolling must not
    // overwrite a verdict.
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PUT')).toBe(
      false,
    );

    await user.click(screen.getByRole('button', { name: strings.rating.save }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
        stars: 3,
        comment: 'geht so',
      });
    });
  });

  it('corrects the shared catalogue without asking for a role', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      { path: '/products/prod-1', method: 'PATCH', body: { product: makeProductDetail() } },
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
    ]);

    renderProduct();
    await screen.findByRole('heading', { name: 'Apfelsaft' });

    await user.click(screen.getByRole('button', { name: strings.common.edit }));
    const name = screen.getByLabelText(new RegExp(strings.fields.name));
    await user.clear(name);
    await user.type(name, 'Apfelsaft naturtrüb');
    await user.click(screen.getByRole('button', { name: strings.common.save }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'PATCH',
      );
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toMatchObject({
        name: 'Apfelsaft naturtrüb',
      });
    });
  });

  it('keeps deleting to administrators and asks before it does', async () => {
    const user = userEvent.setup();

    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
    ]);

    const view = renderProduct();
    await screen.findByRole('heading', { name: 'Apfelsaft' });
    expect(screen.queryByRole('button', { name: strings.common.delete })).not.toBeInTheDocument();
    view.unmount();

    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: ADMIN } },
      CATEGORIES,
      { path: '/products/prod-1', method: 'DELETE', body: { ok: true } },
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
    ]);

    renderProduct();
    await screen.findByRole('heading', { name: 'Apfelsaft' });

    await user.click(screen.getByRole('button', { name: strings.common.delete }));
    // One press arms it, the second one carries it out.
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE'),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: strings.product.deleteConfirm }));

    expect(await screen.findByText('Katalog')).toBeInTheDocument();
  });

  it('uploads a picked photo and shows how far it has got', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
    ]);
    const upload = mockUpload();

    renderProduct();
    await screen.findByRole('heading', { name: 'Apfelsaft' });

    const file = new File([new Uint8Array(64)], 'IMG_0815.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(strings.photo.take), file);

    // Preview first: a picture of a thumb should be noticed before the wait.
    expect(await screen.findByAltText(strings.photo.previewAlt)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: strings.photo.upload }));

    upload().emitProgress(30, 60);
    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toHaveValue(0.5);
    });

    upload().respond(201, { photo: makePhoto() });
    expect(await screen.findByText(strings.photo.uploaded)).toBeInTheDocument();
  });

  it('offers a retry when the upload fails and keeps the picture', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
    ]);
    const upload = mockUpload();

    renderProduct();
    await screen.findByRole('heading', { name: 'Apfelsaft' });

    await user.upload(
      screen.getByLabelText(strings.photo.take),
      new File([new Uint8Array(64)], 'foto.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByAltText(strings.photo.previewAlt);

    await user.click(screen.getByRole('button', { name: strings.photo.upload }));
    upload().fail();

    expect(await screen.findByRole('button', { name: strings.photo.retry })).toBeInTheDocument();
    // The prepared picture is still there, so retrying is one tap.
    expect(screen.getByAltText(strings.photo.previewAlt)).toBeInTheDocument();
  });

  it('shows what the household thought, with the own verdict marked', async () => {
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            ratings: { average: 3.5, count: 2 },
            ownRating: makeRating({ stars: 5 }),
            allRatings: [
              makeProductRating({
                username: 'bert',
                userId: 'user-bert',
                stars: 2,
                comment: 'zu süß',
              }),
              makeProductRating({ username: 'anna', userId: testUser.id, stars: 5 }),
            ],
          }),
        },
      },
    ]);

    renderProduct();

    expect(await screen.findByText('bert')).toBeInTheDocument();
    expect(screen.getByText('zu süß')).toBeInTheDocument();
    // Only the caller's own entry carries the marker.
    expect(screen.getAllByText(strings.rating.householdYou)).toHaveLength(1);
  });

  it('records a price in cents, whatever separator was typed', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      { path: '/prices/shops', body: { shops: ['Bioladen'] } },
      {
        path: '/products/prod-1/prices',
        method: 'POST',
        body: { price: makePrice() },
      },
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
    ]);

    renderProduct();
    await screen.findByRole('heading', { name: 'Apfelsaft' });

    await user.type(screen.getByLabelText(new RegExp(strings.price.amount)), '1,99');
    // Restricted to the input: the suggestion list next to it carries the
    // word "Einkaufsort" in its own label.
    await user.type(
      screen.getByLabelText(new RegExp(strings.price.shop), { selector: 'input' }),
      'Bioladen',
    );
    await user.click(screen.getByRole('button', { name: strings.price.add }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/products/prod-1/prices') &&
          (init as RequestInit)?.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = JSON.parse(String((post?.[1] as RequestInit).body)) as Record<string, unknown>;
      // Whole cents on the wire, never a decimal.
      expect(body.cents).toBe(199);
      expect(body.shop).toBe('Bioladen');
    });
  });

  it('says so when the amount is not one, instead of sending a zero', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      { path: '/prices/shops', body: { shops: [] } },
      { path: '/products/prod-1', body: { product: makeProductDetail() } },
    ]);

    renderProduct();
    await screen.findByRole('heading', { name: 'Apfelsaft' });

    await user.type(screen.getByLabelText(new RegExp(strings.price.amount)), 'teuer');
    await user.click(screen.getByRole('button', { name: strings.price.add }));

    expect(await screen.findByText(strings.price.amountInvalid)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/products/prod-1/prices')),
    ).toBe(false);
  });

  it('marks the cheapest recorded purchase in the history', async () => {
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      { path: '/prices/shops', body: { shops: [] } },
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            prices: [
              makePrice({ id: 'price-2', cents: 249, shop: 'Supermarkt' }),
              makePrice({ id: 'price-1', cents: 179, shop: 'Discounter' }),
            ],
          }),
        },
      },
    ]);

    renderProduct();

    // Once in the summary above the list and once in the row it belongs to.
    expect(await screen.findAllByText(/Discounter/)).toHaveLength(2);
    // The label of the summary and the badge on the cheapest row.
    expect(screen.getAllByText(strings.price.lowest)).toHaveLength(2);
  });

  it('shows the photos of a product with the primary one marked', async () => {
    mockFetch([
      { path: '/auth/me', body: { user: testUser } },
      CATEGORIES,
      {
        path: '/products/prod-1',
        body: {
          product: makeProductDetail({
            primaryPhotoId: 'photo-1',
            photos: [makePhoto(), makePhoto({ id: 'photo-2', isPrimary: false })],
          }),
        },
      },
    ]);

    renderProduct();

    expect(await screen.findByText(strings.photo.isPrimary)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.photo.setPrimary })).toBeInTheDocument();
  });
});
