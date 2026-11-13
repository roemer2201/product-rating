export interface ImageRect {
  /** Coordinates relative to the displayed orientation, from 0 to 1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_IMAGE: ImageRect = { x: 0, y: 0, width: 1, height: 1 };

export interface PhotoEdits {
  turns: number;
  crop: ImageRect;
  portrait: boolean;
  focus: { x: number; y: number };
  focusSize: number;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas is unavailable');
  return context;
}

/** Downsampled blur with a smooth focus mask. Uses Canvas 2D on iOS as well. */
function softenBackground(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  focus: PhotoEdits['focus'],
  focusSize: number,
): void {
  const { width, height } = canvas;
  const blur = document.createElement('canvas');
  const scale = Math.min(1, 48 / Math.max(width, height));
  blur.width = Math.max(1, Math.round(width * scale));
  blur.height = Math.max(1, Math.round(height * scale));
  const small = context2d(blur);
  small.drawImage(canvas, 0, 0, blur.width, blur.height);

  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const mask = context2d(layer);
  mask.drawImage(blur, 0, 0, width, height);
  mask.globalCompositeOperation = 'destination-in';
  mask.save();
  mask.scale(width, height);
  const fade = mask.createRadialGradient(
    focus.x,
    focus.y,
    focusSize * 0.65,
    focus.x,
    focus.y,
    focusSize,
  );
  fade.addColorStop(0, 'transparent');
  fade.addColorStop(1, 'black');
  mask.fillStyle = fade;
  mask.fillRect(0, 0, 1, 1);
  mask.restore();
  context.drawImage(layer, 0, 0);
}

/** Render a live view of the full frame, or just the selected output pixels. */
export function drawEditedPhoto(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  edits: PhotoEdits,
  maxEdge: number,
  showCrop: boolean,
): void {
  const sideways = edits.turns % 2 !== 0;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const sourceHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const width = sideways ? sourceHeight : sourceWidth;
  const height = sideways ? sourceWidth : sourceHeight;

  canvas.width = width;
  canvas.height = height;
  const context = context2d(canvas);
  context.fillStyle = 'white';
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((edits.turns * Math.PI) / 2);
  context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
  context.restore();

  if (edits.portrait) softenBackground(canvas, context, edits.focus, edits.focusSize);

  const { x, y, width: w, height: h } = edits.crop;
  if (x === 0 && y === 0 && w === 1 && h === 1) return;
  if (showCrop) {
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.beginPath();
    context.rect(0, 0, width, height);
    context.rect(x * width, y * height, w * width, h * height);
    context.fill('evenodd');
    context.strokeStyle = 'white';
    context.strokeRect(x * width, y * height, w * width, h * height);
    return;
  }

  const left = Math.min(width - 1, Math.round(x * width));
  const top = Math.min(height - 1, Math.round(y * height));
  const cropWidth = Math.max(1, Math.round((x + w) * width) - left);
  const cropHeight = Math.max(1, Math.round((y + h) * height) - top);
  const pixels = context.getImageData(left, top, cropWidth, cropHeight);
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  context.putImageData(pixels, 0, 0);
}
