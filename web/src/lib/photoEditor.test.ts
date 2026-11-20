import { describe, expect, it, vi } from 'vitest';
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

describe('drawEditedPhoto', () => {
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
