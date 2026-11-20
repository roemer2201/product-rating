import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawEditedPhoto, FULL_IMAGE, type PhotoEdits } from '@/lib/photoEditor';

const DEFAULT_EDITS: PhotoEdits = {
  turns: 0,
  crop: FULL_IMAGE,
  portrait: false,
  focus: { x: 0.5, y: 0.5 },
  focusSize: 0.55,
};

function image(width: number, height: number): HTMLImageElement {
  const value = document.createElement('img');
  Object.defineProperties(value, {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  return value;
}

function canvasWithContext() {
  const canvas = document.createElement('canvas');
  const context = {
    fillRect: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return { canvas, context };
}

/**
 * The portrait effect draws onto canvases of its own. jsdom has no 2D context,
 * so every canvas created during the call gets a recording stand-in.
 */
function recordPortraitCanvases() {
  const created: { canvas: HTMLCanvasElement; gradient: ReturnType<typeof vi.fn> }[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (name: string, options?: ElementCreationOptions) => {
      const element = original(name, options);
      if (name === 'canvas') {
        const gradient = vi.fn(() => ({ addColorStop: vi.fn() }));
        vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue({
          drawImage: vi.fn(),
          fillRect: vi.fn(),
          createRadialGradient: gradient,
        } as unknown as CanvasRenderingContext2D);
        created.push({ canvas: element as HTMLCanvasElement, gradient });
      }
      return element;
    },
  );
  return created;
}

describe('drawEditedPhoto', () => {
  afterEach(() => vi.restoreAllMocks());

  it('blurs an exported crop as coarsely as the preview of the whole frame', () => {
    const edits: PhotoEdits = {
      ...DEFAULT_EDITS,
      crop: { x: 0.5, y: 0.5, width: 0.25, height: 0.25 },
      portrait: true,
      focus: { x: 0.6, y: 0.7 },
      focusSize: 0.5,
    };

    const preview = canvasWithContext();
    const previewLayers = recordPortraitCanvases();
    drawEditedPhoto(preview.canvas, image(4000, 3000), edits, 640, true);
    vi.restoreAllMocks();

    const exported = canvasWithContext();
    const exportLayers = recordPortraitCanvases();
    drawEditedPhoto(exported.canvas, image(4000, 3000), edits, 2048, false);

    // Preview: 640 x 480 shrunk to 48 x 36. Export: a quarter of a 4000 x 3000
    // frame, 1000 x 750, shrunk by the same share of the full frame to 12 x 9.
    expect([previewLayers[0]!.canvas.width, previewLayers[0]!.canvas.height]).toEqual([48, 36]);
    expect([exportLayers[0]!.canvas.width, exportLayers[0]!.canvas.height]).toEqual([12, 9]);

    // Same centre and radius in the picture: (0.6, 0.7) of the frame lies at
    // (400, 600) of the crop, and half the shorter edge is 1500 pixels.
    expect(previewLayers[1]!.gradient).toHaveBeenCalledWith(384, 336, 156, 384, 336, 240);
    const near = (value: number) => expect.closeTo(value, 6);
    expect(exportLayers[1]!.gradient).toHaveBeenCalledWith(
      near(400),
      near(600),
      near(975),
      near(400),
      near(600),
      near(1500),
    );
  });

  it('exports a small crop at its available source resolution', () => {
    const { canvas, context } = canvasWithContext();
    const original = image(4000, 3000);

    drawEditedPhoto(
      canvas,
      original,
      { ...DEFAULT_EDITS, crop: { x: 0.25, y: 0.25, width: 0.1, height: 0.2 } },
      2048,
      false,
    );

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(600);
    expect(context.translate).toHaveBeenCalledWith(-1000, -750);
    expect(context.drawImage).toHaveBeenCalledWith(original, -2000, -1500, 4000, 3000);
    expect(context.fill).not.toHaveBeenCalled();
  });

  it('keeps the full-frame preview smaller with a visible crop overlay', () => {
    const { canvas, context } = canvasWithContext();

    drawEditedPhoto(
      canvas,
      image(4000, 3000),
      { ...DEFAULT_EDITS, crop: { x: 0.25, y: 0.25, width: 0.1, height: 0.2 } },
      640,
      true,
    );

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(context.rect).toHaveBeenCalledWith(160, 120, 64, 96);
    expect(context.fill).toHaveBeenCalledWith('evenodd');
  });

  it('crops against the rotated frame without losing the source pixels', () => {
    const { canvas, context } = canvasWithContext();

    drawEditedPhoto(
      canvas,
      image(4000, 3000),
      { ...DEFAULT_EDITS, turns: 1, crop: { x: 0.2, y: 0.25, width: 0.2, height: 0.25 } },
      2048,
      false,
    );

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(1000);
    expect(context.translate).toHaveBeenCalledWith(-600, -1000);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
  });

  it('limits large selections to the export edge', () => {
    const { canvas } = canvasWithContext();

    drawEditedPhoto(canvas, image(4000, 3000), DEFAULT_EDITS, 2048, false);
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(1536);
  });
});
