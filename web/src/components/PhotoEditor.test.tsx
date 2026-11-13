import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoEditButton } from '@/components/PhotoEditor';
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
});
