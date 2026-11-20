import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptureQueue } from './CaptureQueue';
import { confirmCaptureOwner } from '@/lib/captureIdentity';
import {
  enqueueCapture,
  enqueuePhotoReplacement,
  getCapture,
  listPhotoReplacements,
  saveCapture,
  savePhotoReplacement,
} from '@/lib/offlineQueue';
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
    // The label exists in both the old orphan row and the adopted row.
    // Wait for the orphan to disappear before looking for the new row,
    // otherwise findByText can hand back an element being unmounted.
    await waitFor(() => {
      expect(screen.queryByText(strings.offlineCapture.unassignedTitle)).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Captured before the update')).toBeInTheDocument();
  } finally {
    view.unmount();
  }
});

/**
 * The in-memory IndexedDB hands a `Blob` back as a plain object, which the
 * real `createObjectURL` refuses. A browser returns the `Blob` itself.
 */
function stubObjectUrls(): void {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kept');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('lists an edited photo waiting offline and keeps it as a new photo after a conflict', async () => {
  stubObjectUrls();
  const entry = await enqueuePhotoReplacement({
    photoId: 'photo-1',
    productId: 'prod-1',
    label: 'Apfelsaft',
    blob: new Blob(['edited'], { type: 'image/jpeg' }),
    filename: 'produktfoto.jpg',
  });
  await savePhotoReplacement({ ...entry, state: 'conflict' });

  const view = renderWithProviders(<CaptureQueue />);
  try {
    expect(await screen.findByText('Apfelsaft')).toBeInTheDocument();
    expect(screen.getByText(strings.offlineCapture.photoConflictTitle)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(strings.offlineCapture.partPhotoReplace))).toBeVisible();
    expect(screen.getByAltText(strings.offlineCapture.photoAlt('Apfelsaft'))).toBeInTheDocument();
    expect(screen.queryByText(strings.offlineCapture.empty)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: strings.offlineCapture.addAsNew }));

    await waitFor(async () => {
      expect(await listPhotoReplacements()).toMatchObject([{ mode: 'add', state: 'pending' }]);
    });
    expect(await screen.findByText(new RegExp(strings.offlineCapture.partPhotoAdd))).toBeVisible();
  } finally {
    view.unmount();
  }
});

it('discards an edited photo only on the second tap', async () => {
  stubObjectUrls();
  await enqueuePhotoReplacement({
    photoId: 'photo-1',
    productId: 'prod-1',
    label: 'Apfelsaft',
    blob: new Blob(['edited'], { type: 'image/jpeg' }),
    filename: 'produktfoto.jpg',
  });

  const view = renderWithProviders(<CaptureQueue />);
  try {
    await screen.findByText('Apfelsaft');
    await userEvent.click(screen.getByRole('button', { name: strings.offlineCapture.discard }));
    expect(await listPhotoReplacements()).toHaveLength(1);

    await userEvent.click(
      screen.getByRole('button', { name: strings.offlineCapture.discardConfirm }),
    );
    expect(await screen.findByText(strings.offlineCapture.empty)).toBeInTheDocument();
    expect(await listPhotoReplacements()).toEqual([]);
  } finally {
    view.unmount();
  }
});
