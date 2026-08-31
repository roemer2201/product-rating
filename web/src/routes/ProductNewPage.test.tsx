import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { ProductNewPage } from '@/routes/ProductNewPage';
import { listCaptures } from '@/lib/offlineQueue';
import { strings } from '@/lib/strings';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { TEST_EAN, makeProduct } from '@/testing/fixtures';
import { renderWithProviders } from '@/testing/render';
import { mockUpload } from '@/testing/xhrMock';

/**
 * The screen a scan of an unknown EAN leads to.
 *
 * Its subject here is the photo: it is picked on this screen but can only be
 * uploaded once the product exists, so what is checked is the order of the two
 * requests and every way the second one can go wrong — the product is then
 * already there and must not be lost behind an error about a picture.
 */

const CATEGORIES = { path: '/products/categories', body: { categories: ['Getränke'] } };

function renderNew() {
  return renderWithProviders(
    <Routes>
      <Route path="/products/new" element={<ProductNewPage />} />
      <Route path="/products/:id" element={<p>Produktseite</p>} />
      <Route path="/scan" element={<p>Scannen</p>} />
      <Route path="/" element={<p>Katalog</p>} />
    </Routes>,
    { route: `/products/new?ean=${TEST_EAN}` },
  );
}

/** The name is the only field the save insists on. */
async function fillName(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(strings.fields.name), 'Apfelsaft');
}

function pickedFile(): File {
  return new File([new Uint8Array(64)], 'foto.jpg', { type: 'image/jpeg' });
}

describe('ProductNewPage', () => {
  it('sends an invalid EAN back to the scanner', () => {
    mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

    renderWithProviders(
      <Routes>
        <Route path="/products/new" element={<ProductNewPage />} />
        <Route path="/scan" element={<p>Scannen</p>} />
      </Routes>,
      { route: '/products/new?ean=42' },
    );

    expect(screen.getByText('Scannen')).toBeInTheDocument();
  });

  it('goes straight to the product when nothing was photographed', async () => {
    const user = userEvent.setup();
    mockFetch([
      CATEGORIES,
      { path: '/products', method: 'POST', status: 201, body: { product: makeProduct() } },
    ]);

    renderNew();
    await fillName(user);
    await user.click(screen.getByRole('button', { name: strings.product.create }));

    expect(await screen.findByText('Produktseite')).toBeInTheDocument();
  });

  it('creates the product first and uploads the photo to it', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      CATEGORIES,
      { path: '/products', method: 'POST', status: 201, body: { product: makeProduct() } },
    ]);
    const upload = mockUpload();

    renderNew();
    await fillName(user);
    await user.upload(screen.getByLabelText(strings.photo.take), pickedFile());
    await screen.findByAltText(strings.photo.previewAlt);

    // Nothing is uploaded before the product exists.
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/photos'),
      expect.anything(),
    );

    await user.click(screen.getByRole('button', { name: strings.product.create }));

    expect(await screen.findByText(strings.product.created)).toBeInTheDocument();
    expect(upload().url).toContain('/products/prod-1/photos');

    upload().respond(201, { photo: { id: 'photo-1' } });
    expect(await screen.findByText('Produktseite')).toBeInTheDocument();
  });

  it('brings the buttons of the form to the lower edge once the picture is there', async () => {
    const user = userEvent.setup();
    mockFetch([CATEGORIES]);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    vi.stubGlobal('visualViewport', { height: 800 });

    renderNew();
    await user.upload(screen.getByLabelText(strings.photo.choose), pickedFile());
    const image = await screen.findByAltText(strings.photo.previewAlt);

    // Nothing moves while the picture has no height yet.
    expect(scrollBy).not.toHaveBeenCalled();

    // jsdom loads no pictures and measures nothing; what is checked here is
    // that the load moves the page at all.
    fireEvent.load(image);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('keeps the product and offers a retry when only the upload fails', async () => {
    const user = userEvent.setup();
    mockFetch([
      CATEGORIES,
      { path: '/products', method: 'POST', status: 201, body: { product: makeProduct() } },
    ]);
    const upload = mockUpload();

    renderNew();
    await fillName(user);
    await user.upload(screen.getByLabelText(strings.photo.take), pickedFile());
    await screen.findByAltText(strings.photo.previewAlt);
    await user.click(screen.getByRole('button', { name: strings.product.create }));

    upload().respond(500, { error: { code: 'internal', message: 'kaputt' } });

    // The picture is still in hand, and the product is reachable without it.
    expect(await screen.findByRole('button', { name: strings.photo.retry })).toBeInTheDocument();
    expect(screen.getByAltText(strings.photo.previewAlt)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: strings.product.toCreated })).toHaveAttribute(
      'href',
      '/products/prod-1',
    );

    await user.click(screen.getByRole('button', { name: strings.photo.retry }));
    upload().respond(201, { photo: { id: 'photo-1' } });
    expect(await screen.findByText('Produktseite')).toBeInTheDocument();
  });

  it('keeps the picture in the queue when the upload finds no connection', async () => {
    const user = userEvent.setup();
    mockFetch([
      CATEGORIES,
      { path: '/products', method: 'POST', status: 201, body: { product: makeProduct() } },
    ]);
    const upload = mockUpload();

    renderNew();
    await fillName(user);
    await user.upload(screen.getByLabelText(strings.photo.take), pickedFile());
    await screen.findByAltText(strings.photo.previewAlt);
    await user.click(screen.getByRole('button', { name: strings.product.create }));

    upload().fail();

    await user.click(await screen.findByRole('button', { name: strings.offlineCapture.keep }));
    expect(await screen.findByText('Produktseite')).toBeInTheDocument();

    const captures = await listCaptures();
    expect(captures).toHaveLength(1);
    // Only the photo: the product is already on the server, and the queue
    // finds it again by its EAN.
    expect(captures[0]?.ean).toBe(TEST_EAN);
    expect(captures[0]?.product).toBeNull();
    expect(captures[0]?.photos).toHaveLength(1);
  });

  it('puts the picture into the queue together with a product that could not be saved', async () => {
    const user = userEvent.setup();
    mockFetch([CATEGORIES, { path: '/products', method: 'POST', networkError: true }]);

    renderNew();
    await fillName(user);
    await user.upload(screen.getByLabelText(strings.photo.take), pickedFile());
    await screen.findByAltText(strings.photo.previewAlt);
    await user.click(screen.getByRole('button', { name: strings.product.create }));

    await user.click(await screen.findByRole('button', { name: strings.offlineCapture.keep }));
    expect(await screen.findByText('Katalog')).toBeInTheDocument();

    const captures = await listCaptures();
    expect(captures).toHaveLength(1);
    expect(captures[0]?.product?.name).toBe('Apfelsaft');
    expect(captures[0]?.photos).toHaveLength(1);
  });
});
