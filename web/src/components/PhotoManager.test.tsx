import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@product-rating/shared';
import { PhotoManager } from '@/components/PhotoManager';
import { api, ApiError } from '@/lib/api';
import * as imageUtils from '@/lib/image';
import type * as photoEditor from '@/lib/photoEditor';
import { enqueuePhotoReplacement, listPhotoReplacements } from '@/lib/offlineQueue';
import { strings } from '@/lib/strings';
import { testUser } from '@/testing/fetchMock';
import { makePhoto, TEST_EAN } from '@/testing/fixtures';
import { renderWithProviders } from '@/testing/render';

/**
 * The gallery side of the offline queue for edited photos: what it shows for
 * an edit that waits, and how an edit gets there.
 */

vi.mock('@/lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof imageUtils>()),
  canvasToBlob: vi.fn(),
}));
vi.mock('@/lib/photoEditor', async (importOriginal) => ({
  ...(await importOriginal<typeof photoEditor>()),
  drawEditedPhoto: vi.fn(),
}));

const labels = strings.photo.editor;

function renderGallery() {
  return renderWithProviders(
    <PhotoManager
      productId="prod-1"
      ean={TEST_EAN}
      productName="Apfelsaft"
      photos={[makePhoto()]}
      user={testUser as User}
    />,
  );
}

/** jsdom loads no images and has no modal dialogs; both are stood in for. */
function stubBrowser(): void {
  const OriginalImage = Image;
  vi.stubGlobal(
    'Image',
    class extends OriginalImage {
      constructor() {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event('load')));
      }
    },
  );
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
  // The in-memory IndexedDB hands a `Blob` back as a plain object, which the
  // real `createObjectURL` refuses; a browser returns the `Blob` itself.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kept');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('PhotoManager and the offline queue', () => {
  it('keeps an edit that found no connection and shows it on the tile', async () => {
    const user = userEvent.setup();
    stubBrowser();
    vi.mocked(imageUtils.canvasToBlob).mockResolvedValue(new Blob(['edited']));
    vi.spyOn(api.photos, 'replace').mockRejectedValue(
      new ApiError({ status: 0, code: 'network_error' }),
    );
    renderGallery();

    await user.click(screen.getByRole('button', { name: labels.openFor(1) }));
    await screen.findByRole('img', { name: strings.photo.preview });
    await user.click(screen.getByRole('button', { name: labels.right }));
    await user.click(screen.getByRole('button', { name: labels.replace }));
    await user.click(await screen.findByRole('button', { name: strings.offlineCapture.keep }));

    await waitFor(async () => {
      expect(await listPhotoReplacements()).toMatchObject([
        { photoId: 'photo-1', productId: 'prod-1', label: 'Apfelsaft', state: 'pending' },
      ]);
    });
    expect(await screen.findByText(labels.queued)).toBeInTheDocument();
    expect(screen.getByAltText(strings.photo.alt(1))).toHaveAttribute('src', 'blob:kept');
  });

  it('starts the next edit from the waiting one, and drops it once a save gets through', async () => {
    const user = userEvent.setup();
    stubBrowser();
    await enqueuePhotoReplacement({
      photoId: 'photo-1',
      productId: 'prod-1',
      label: 'Apfelsaft',
      blob: new Blob(['first edit'], { type: 'image/jpeg' }),
      filename: 'produktfoto.jpg',
    });
    vi.mocked(imageUtils.canvasToBlob).mockResolvedValue(new Blob(['second edit']));
    const replace = vi.spyOn(api.photos, 'replace').mockResolvedValue({ photo: makePhoto() });
    renderGallery();

    expect(await screen.findByText(labels.queued)).toBeInTheDocument();
    const fromServer = vi.mocked(URL.createObjectURL).mock.calls.length;
    await user.click(screen.getByRole('button', { name: labels.openFor(1) }));
    await screen.findByRole('img', { name: strings.photo.preview });
    // The editor made an address for the kept bytes instead of loading the
    // picture from the server.
    expect(vi.mocked(URL.createObjectURL).mock.calls.length).toBeGreaterThan(fromServer);

    await user.click(screen.getByRole('button', { name: labels.right }));
    await user.click(screen.getByRole('button', { name: labels.replace }));

    await waitFor(async () => {
      expect(await listPhotoReplacements()).toEqual([]);
    });
    expect(replace).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText(labels.queued)).not.toBeInTheDocument();
    });
  });
});
