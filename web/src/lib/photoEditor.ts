export interface ImageRect {
  /** Coordinates relative to the displayed orientation, from 0 to 1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_IMAGE: ImageRect = { x: 0, y: 0, width: 1, height: 1 };

/** Compared by value: a rectangle moved back to the full frame is no crop. */
export function isFullImage({ x, y, width, height }: ImageRect): boolean {
  return x === 0 && y === 0 && width === 1 && height === 1;
}

export interface PhotoEdits {
  /** Quarter turns clockwise, 0 to 3. */
  turns: number;
  crop: ImageRect;
  portrait: boolean;
  /** Centre of the sharp area, relative to the turned frame. */
  focus: { x: number; y: number };
  /** Radius of the sharp area as a share of the shorter edge. */
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
  // Measured in pixels against the shorter edge, so the sharp area is a circle
  // on a portrait or landscape picture alike instead of a stretched ellipse.
  const centreX = focus.x * width;
  const centreY = focus.y * height;
  const radius = focusSize * Math.min(width, height);
  const fade = mask.createRadialGradient(centreX, centreY, radius * 0.65, centreX, centreY, radius);
  fade.addColorStop(0, 'transparent');
  fade.addColorStop(1, 'black');
  mask.fillStyle = fade;
  mask.fillRect(0, 0, width, height);
  context.drawImage(layer, 0, 0);
}

/**
 * Render the full turned frame for the interactive preview, but only the
 * selected pixels for export. Drawing the entire image at the upload size and
 * then cropping it used to throw away most of the available resolution for
 * small selections. A crop of a 4000px image must stay 400px wide, not 205px
 * merely because the full preview was capped at 2048px.
 *
 * Drawing directly into the output canvas also avoids a full-frame
 * getImageData() readback and limits memory to the exported dimensions.
 */
export function drawEditedPhoto(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  edits: PhotoEdits,
  maxEdge: number,
  showCrop: boolean,
): void {
  const sideways = edits.turns % 2 !== 0;
  const orientedWidth = sideways ? image.naturalHeight : image.naturalWidth;
  const orientedHeight = sideways ? image.naturalWidth : image.naturalHeight;
  const selection = showCrop ? FULL_IMAGE : edits.crop;
  const selectedWidth = orientedWidth * selection.width;
  const selectedHeight = orientedHeight * selection.height;
  const scale = Math.min(1, maxEdge / Math.max(selectedWidth, selectedHeight));
  const width = Math.max(1, Math.round(selectedWidth * scale));
  const height = Math.max(1, Math.round(selectedHeight * scale));
  const fullWidth = orientedWidth * scale;
  const fullHeight = orientedHeight * scale;

  canvas.width = width;
  canvas.height = height;
  const context = context2d(canvas);
  context.fillStyle = 'white';
  context.fillRect(0, 0, width, height);
  context.save();
  // Turn the source around its centre, then offset that full oriented image
  // so the selected rectangle is the only part painted onto this canvas.
  context.translate(-selection.x * fullWidth, -selection.y * fullHeight);
  context.translate(fullWidth / 2, fullHeight / 2);
  context.rotate((edits.turns * Math.PI) / 2);
  context.drawImage(
    image,
    (-image.naturalWidth * scale) / 2,
    (-image.naturalHeight * scale) / 2,
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  context.restore();

  if (edits.portrait) {
    // The user chose the focus on the full turned frame. Keep its actual
    // position and radius when exporting only a portion of that frame.
    const focus = {
      x: (edits.focus.x - selection.x) / selection.width,
      y: (edits.focus.y - selection.y) / selection.height,
    };
    const radius =
      (edits.focusSize * Math.min(orientedWidth, orientedHeight)) /
      Math.min(selectedWidth, selectedHeight);
    softenBackground(canvas, context, focus, radius);
  }

  if (!showCrop || isFullImage(edits.crop)) return;

  const { x, y, width: w, height: h } = edits.crop;
  context.fillStyle = 'rgba(0, 0, 0, 0.6)';
  context.beginPath();
  context.rect(0, 0, width, height);
  context.rect(x * width, y * height, w * width, h * height);
  context.fill('evenodd');
  context.strokeStyle = 'white';
  context.strokeRect(x * width, y * height, w * width, h * height);
}
