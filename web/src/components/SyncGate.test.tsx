import { act, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SyncGate } from './SyncGate';
import { renderWithProviders } from '@/testing/render';
import {
  enqueueCapture,
  enqueuePhotoReplacement,
  listCaptures,
  listPhotoReplacements,
} from '@/lib/offlineQueue';
import { api, ApiError } from '@/lib/api';
import { makePhoto, TEST_EAN } from '@/testing/fixtures';
import { strings } from '@/lib/strings';

it('does not immediately repeat transient failures without a new online event', async () => {
  await enqueueCapture({ ean: TEST_EAN, label: 'Waiting' });
  const lookup = vi.spyOn(api.products, 'byEan').mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    throw new ApiError({ status: 503, code: 'unavailable' });
  });
  const view = renderWithProviders(<SyncGate />);
  try {
    await waitFor(async () => {
      expect((await listCaptures())[0]?.attempts).toBe(1);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect((await listCaptures())[0]?.state).toBe('pending');
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(async () => {
      expect((await listCaptures())[0]?.attempts).toBe(2);
    });
    expect(lookup).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    lookup.mockRestore();
  }
});

it('counts an edited photo as waiting and sends it on its own', async () => {
  const replace = vi.spyOn(api.photos, 'replace').mockResolvedValue({ photo: makePhoto() });
  await enqueuePhotoReplacement({
    photoId: 'photo-1',
    productId: 'prod-1',
    label: 'Apfelsaft',
    blob: new Blob(['edited'], { type: 'image/jpeg' }),
    filename: 'produktfoto.jpg',
  });

  const view = renderWithProviders(<SyncGate />);
  try {
    await waitFor(async () => {
      expect(await listPhotoReplacements()).toEqual([]);
    });
    expect(replace).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText(strings.offlineCapture.waiting(1))).not.toBeInTheDocument();
    });
  } finally {
    view.unmount();
    replace.mockRestore();
  }
});
