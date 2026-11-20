import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoEditButton } from '@/components/PhotoEditor';
import { ApiError } from '@/lib/api';
import * as imageUtils from '@/lib/image';
import * as photoEditor from '@/lib/photoEditor';
import { strings } from '@/lib/strings';

vi.mock('@/lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof imageUtils>()),
  canvasToBlob: vi.fn(),
}));
vi.mock('@/lib/photoEditor', async (importOriginal) => ({
  ...(await importOriginal<typeof photoEditor>()),
  drawEditedPhoto: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function mockBrowserImage(): void {
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
}

function mockDialog(): void {
  class MockDialog extends HTMLDialogElement {
    override showModal() {
      this.open = true;
    }

    override close() {
      this.open = false;
    }
  }

  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (name: string, options?: ElementCreationOptions) => {
      const element = original(name, options);
      if (name === 'dialog') Object.setPrototypeOf(element, MockDialog.prototype);
      return element;
    },
  );
}

const labels = strings.photo.editor;

describe('PhotoEditButton', () => {
  afterEach(() => vi.restoreAllMocks());

  it('combines crop, rotation and portrait before applying a single uploadable image', async () => {
    const user = userEvent.setup();
    mockBrowserImage();
    mockDialog();
    const saved = new Blob(['edited'], { type: 'image/jpeg' });
    vi.mocked(imageUtils.canvasToBlob).mockResolvedValue(saved);
    const onSave = vi.fn();
    render(<PhotoEditButton src="blob:original" filename="foto.png" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: labels.open }));
    const canvas = await screen.findByRole('img', { name: strings.photo.preview });
    Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 100));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, clientX: 70, clientY: 70 });
    fireEvent.lostPointerCapture(canvas, { pointerId: 1 });
    await user.click(screen.getByRole('button', { name: labels.right }));
    await user.click(screen.getByRole('button', { name: labels.portrait }));
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 60, clientY: 50 });

    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: labels.apply }));
    expect(photoEditor.drawEditedPhoto).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.any(HTMLImageElement),
      expect.objectContaining({
        turns: 1,
        crop: expect.objectContaining({
          y: 0.2,
          width: expect.closeTo(0.4),
          height: expect.closeTo(0.4),
        }),
        portrait: true,
        focus: { x: 0.5, y: 0.4 },
      }),
      2048,
      false,
    );
    expect(onSave).toHaveBeenCalledWith(saved, 'foto.jpg');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves and resizes the crop and the focus with the arrow keys', async () => {
    const user = userEvent.setup();
    mockBrowserImage();
    mockDialog();
    vi.mocked(imageUtils.canvasToBlob).mockResolvedValue(new Blob(['edited']));
    const onSave = vi.fn();
    render(<PhotoEditButton src="blob:original" filename="foto.jpg" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: labels.open }));
    const canvas = await screen.findByRole('img', { name: strings.photo.preview });
    expect(screen.getByRole('button', { name: labels.apply })).toBeDisabled();

    canvas.focus();
    // Shift + left narrows the frame, which then has room to move right.
    await user.keyboard('{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}{ArrowRight}');
    await user.click(screen.getByRole('button', { name: labels.portrait }));
    canvas.focus();
    await user.keyboard('{ArrowDown}{ArrowLeft}');
    await user.click(screen.getByRole('button', { name: labels.apply }));

    expect(photoEditor.drawEditedPhoto).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.any(HTMLImageElement),
      expect.objectContaining({
        crop: { x: 0.02, y: 0, width: 0.96, height: 1 },
        portrait: true,
        focus: { x: 0.48, y: 0.52 },
      }),
      2048,
      false,
    );
    expect(onSave).toHaveBeenCalled();
  });

  it('offers to keep the edited picture when the replacement found no connection', async () => {
    const user = userEvent.setup();
    mockBrowserImage();
    mockDialog();
    const edited = new Blob(['edited'], { type: 'image/jpeg' });
    vi.mocked(imageUtils.canvasToBlob).mockResolvedValue(edited);
    const onSave = vi.fn().mockRejectedValue(new ApiError({ status: 0, code: 'network_error' }));
    const onKeep = vi.fn().mockResolvedValue(undefined);
    render(
      <PhotoEditButton
        src="/media/1"
        filename="foto.jpg"
        onSave={onSave}
        onKeep={onKeep}
        savedPhoto
      />,
    );

    await user.click(screen.getByRole('button', { name: labels.open }));
    await screen.findByRole('img', { name: strings.photo.preview });
    await user.click(screen.getByRole('button', { name: labels.right }));
    // Always tried first: whether the phone thinks it is online decides nothing.
    await user.click(screen.getByRole('button', { name: labels.replace }));
    expect(onSave).toHaveBeenCalledWith(edited, 'foto.jpg');
    expect(onKeep).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: strings.offlineCapture.keep }));
    expect(onKeep).toHaveBeenCalledWith(edited, 'foto.jpg');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no queue for a refusal, nor for a picture edited since the failure', async () => {
    const user = userEvent.setup();
    mockBrowserImage();
    mockDialog();
    vi.mocked(imageUtils.canvasToBlob).mockResolvedValue(new Blob(['edited']));
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 403, code: 'forbidden' }))
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'network_error' }));
    render(
      <PhotoEditButton
        src="/media/1"
        filename="foto.jpg"
        onSave={onSave}
        onKeep={vi.fn()}
        savedPhoto
      />,
    );

    await user.click(screen.getByRole('button', { name: labels.open }));
    await screen.findByRole('img', { name: strings.photo.preview });
    await user.click(screen.getByRole('button', { name: labels.right }));
    await user.click(screen.getByRole('button', { name: labels.replace }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: strings.offlineCapture.keep })).toBeNull();

    await user.click(screen.getByRole('button', { name: labels.replace }));
    await screen.findByRole('button', { name: strings.offlineCapture.keep });
    // Another turn makes a different picture than the one that failed.
    await user.click(screen.getByRole('button', { name: labels.right }));
    expect(screen.queryByRole('button', { name: strings.offlineCapture.keep })).toBeNull();
  });

  it('starts from a picture kept on the device', async () => {
    const user = userEvent.setup();
    mockBrowserImage();
    mockDialog();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kept');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const kept = new Blob(['kept'], { type: 'image/jpeg' });
    render(<PhotoEditButton src={kept} filename="foto.jpg" onSave={vi.fn()} savedPhoto />);

    await user.click(screen.getByRole('button', { name: labels.open }));
    await screen.findByRole('img', { name: strings.photo.preview });
    expect(create).toHaveBeenCalledWith(kept);

    await user.click(screen.getByRole('button', { name: strings.common.cancel }));
    expect(revoke).toHaveBeenCalledWith('blob:kept');
  });
});
