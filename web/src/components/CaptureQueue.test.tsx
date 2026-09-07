import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { CaptureQueue } from './CaptureQueue';
import { confirmCaptureOwner } from '@/lib/captureIdentity';
import { enqueueCapture, getCapture, saveCapture } from '@/lib/offlineQueue';
import { mockFetch, testUser } from '@/testing/fetchMock';
import { renderWithProviders } from '@/testing/render';
import { strings } from '@/lib/strings';
import { TEST_EAN } from '@/testing/fixtures';

it('hides another account’s queued notes and shows them again when the owner returns', async () => {
  confirmCaptureOwner('account-a');
  await enqueueCapture({ ean: TEST_EAN, label: 'Private capture from A' });
  const view = renderWithProviders(<CaptureQueue />);
  expect(await screen.findByText('Private capture from A')).toBeInTheDocument();
  act(() => {
    confirmCaptureOwner('account-b');
  });
  expect(screen.queryByText('Private capture from A')).not.toBeInTheDocument();
  act(() => {
    confirmCaptureOwner('account-a');
  });
  expect(await screen.findByText('Private capture from A')).toBeInTheDocument();
  view.unmount();
});

it('adopts a capture from before the queue knew accounts, after a live identity check', async () => {
  const capture = await enqueueCapture({ ean: TEST_EAN, label: 'Captured before the update' });
  await saveCapture({ ...capture, ownerId: null });
  mockFetch([{ path: '/auth/me', body: { user: testUser } }]);

  const view = renderWithProviders(<CaptureQueue />);
  try {
    expect(await screen.findByText(strings.offlineCapture.unassignedTitle)).toBeInTheDocument();
    // The queue of the signed in account is empty, so the empty state must not
    // claim everything has been transferred while this one is still waiting.
    expect(screen.queryByText(strings.offlineCapture.empty)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: strings.offlineCapture.assign }));

    await waitFor(async () => {
      expect((await getCapture(capture.id))?.ownerId).toBe(testUser.id);
    });
    expect(await screen.findByText('Captured before the update')).toBeInTheDocument();
    expect(screen.queryByText(strings.offlineCapture.unassignedTitle)).not.toBeInTheDocument();
  } finally {
    view.unmount();
  }
});
