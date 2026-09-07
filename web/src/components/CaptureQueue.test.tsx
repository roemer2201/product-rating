import { act, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CaptureQueue } from './CaptureQueue';
import { confirmCaptureOwner } from '@/lib/captureIdentity';
import { enqueueCapture } from '@/lib/offlineQueue';
import { renderWithProviders } from '@/testing/render';
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
