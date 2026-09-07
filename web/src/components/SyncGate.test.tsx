import { act, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SyncGate } from './SyncGate';
import { renderWithProviders } from '@/testing/render';
import { enqueueCapture, listCaptures } from '@/lib/offlineQueue';
import { api, ApiError } from '@/lib/api';
import { TEST_EAN } from '@/testing/fixtures';

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
