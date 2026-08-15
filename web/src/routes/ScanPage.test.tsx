import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { ScanPage } from '@/routes/ScanPage';
import { strings } from '@/lib/strings';
import { mockFetch } from '@/testing/fetchMock';
import { TEST_EAN, makeProductDetail } from '@/testing/fixtures';
import { renderWithProviders } from '@/testing/render';

/**
 * The scan screen, driven through its manual entry.
 *
 * jsdom has no camera and no WebAssembly decoder, so what is tested here is
 * everything after a code has been read — and that is the same code path for
 * both ways in: the camera and the text field hand the very same normalised EAN
 * to the same lookup.
 */

function renderScan() {
  return renderWithProviders(
    <Routes>
      <Route path="/scan" element={<ScanPage />} />
      <Route path="/products/new" element={<p>Neues Produkt</p>} />
      <Route path="/products/:id" element={<p>Produktseite</p>} />
    </Routes>,
    { route: '/scan' },
  );
}

async function enterEan(value: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(strings.fields.ean), value);
  await user.click(screen.getByRole('button', { name: strings.scan.manualSubmit }));
}

describe('ScanPage', () => {
  it('goes to the product when the catalogue knows the EAN', async () => {
    const fetchMock = mockFetch([
      { path: '/products/by-ean/', body: { product: makeProductDetail() } },
    ]);

    renderScan();
    await enterEan(TEST_EAN);

    expect(await screen.findByText('Produktseite')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`/api/v1/products/by-ean/${TEST_EAN}`);
  });

  it('goes to the form with the EAN when the catalogue does not', async () => {
    mockFetch([{ path: '/products/by-ean/', status: 404, body: { error: { code: 'not_found' } } }]);

    renderScan();
    await enterEan(TEST_EAN);

    expect(await screen.findByText('Neues Produkt')).toBeInTheDocument();
  });

  it('normalises a short code before looking it up', async () => {
    const fetchMock = mockFetch([
      { path: '/products/by-ean/', body: { product: makeProductDetail() } },
    ]);

    renderScan();
    // An EAN-8 is the same article number as its padded thirteen digit form,
    // and that is the only form the catalogue stores.
    await enterEan('96385074');

    expect(await screen.findByText('Produktseite')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/products/by-ean/0000096385074');
  });

  it('refuses a broken check digit without asking the server', async () => {
    const fetchMock = mockFetch([]);

    renderScan();
    await enterEan('4260000000012');

    expect(await screen.findByText(strings.validation.ean)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains why the camera is unavailable instead of failing silently', async () => {
    mockFetch([]);

    // jsdom is not a secure context, which is exactly the case a phone hits
    // when the app is reached over plain HTTP.
    renderScan();

    expect(await screen.findByText(strings.scan.problem.insecureContext)).toBeInTheDocument();
    // Typing the digits has to stay possible in every one of those cases.
    expect(screen.getByLabelText(strings.fields.ean)).toBeEnabled();
  });
});
