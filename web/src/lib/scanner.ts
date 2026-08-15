import type * as ZXingReader from 'zxing-wasm/reader';
import type { ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { normaliseEan } from '@product-rating/shared';

/**
 * Camera and barcode decoding.
 *
 * `BarcodeDetector` is deliberately not used: iOS Safari does not have it, and
 * the phone in the kitchen is an iPhone. `zxing-wasm` works everywhere the
 * camera does, at the price of a WebAssembly module — and manual entry stays
 * the equal path for everyone else (a locked down camera, a laptop, a barcode
 * that has been through the dishwasher).
 *
 * The module is loaded from our own bundle, never from a CDN: the app must not
 * make outbound requests in operation (CLAUDE.md, decision 6). Vite copies the
 * file into `dist/assets` and hands us its hashed URL.
 */

/** Type only: the import above is erased, the real one happens in `loadReader()`. */
type Reader = typeof ZXingReader;

let reader: Promise<Reader> | null = null;

/**
 * Loads the decoder on first use.
 *
 * The glue code and the WebAssembly module together are more than a megabyte,
 * and three of the four screens never decode anything. A dynamic import puts
 * them in their own chunk, so opening the catalogue on a phone connection does
 * not pay for the scanner.
 */
function loadReader(): Promise<Reader> {
  reader ??= import('zxing-wasm/reader').then((module) => {
    module.prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
    return module;
  });

  return reader;
}

/**
 * Starts fetching the decoder without waiting for it. Called when the camera is
 * opened, so the download happens while the stream is warming up rather than
 * in front of the first barcode someone holds up.
 */
export function warmUpDecoder(): void {
  void loadReader().catch(() => undefined);
}

/**
 * Only the three symbologies the catalogue accepts.
 *
 * UPC-E is left out on purpose: it is read as eight digits that are *not* a
 * valid EAN-8, so it would have to be expanded before the check digit adds up.
 * Nobody has that on a household product, and quietly storing a wrong number
 * would be worse than not reading it.
 */
const READER_OPTIONS: ReaderOptions = {
  formats: ['EAN13', 'EAN8', 'UPCA'],
  // The frame is a live camera picture, not a clean scan of a single code.
  tryHarder: true,
  // A barcode held at an angle is the normal case, not the exception.
  tryRotate: true,
  tryInvert: false,
  maxNumberOfSymbols: 1,
};

/** How much of the video is looked at, as a share of the shorter edge. */
const SCAN_REGION = { width: 0.8, height: 0.45 } as const;

/** Longest edge the decoder gets. More pixels cost time and find nothing new. */
const DECODE_MAX_EDGE = 720;

/** Pause between two decode attempts. Roughly five looks per second. */
export const DECODE_INTERVAL_MS = 200;

/* --------------------------------------------------------------- failures */

/**
 * Why the camera is not running. Every case gets its own explanation on
 * screen — "camera failed" tells nobody whether to grant a permission, use
 * HTTPS or simply type the digits.
 */
export type CameraProblem =
  /** No HTTPS and not localhost; the browser hides `getUserMedia` entirely. */
  | 'insecure-context'
  /** The browser has no camera API at all. */
  | 'unsupported'
  /** The user said no, or the system denied it for the whole browser. */
  | 'denied'
  /** There is no camera to open. */
  | 'missing'
  /** Something else has the camera, or the hardware reports an error. */
  | 'unavailable'
  | 'unknown';

export class CameraError extends Error {
  readonly problem: CameraProblem;

  constructor(problem: CameraProblem, cause?: unknown) {
    super(`camera unavailable: ${problem}`, cause === undefined ? {} : { cause });
    this.name = 'CameraError';
    this.problem = problem;
  }
}

/**
 * Maps what `getUserMedia` throws onto our cases. The names are specified in
 * the Media Capture standard, which is why they are matched rather than the
 * messages — those differ per browser and per language.
 */
function cameraErrorFrom(error: unknown): CameraError {
  const name = error instanceof DOMException ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', error);
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('missing', error);
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('unavailable', error);
    default:
      return new CameraError('unknown', error);
  }
}

/** Whether the browser can open a camera here at all, and why not if it cannot. */
export function cameraSupport(): CameraProblem | null {
  // A secure context is required for `getUserMedia`; without it the property is
  // undefined and the failure would look like "no camera" to the user.
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure-context';
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
    return 'unsupported';
  }
  return null;
}

/* ----------------------------------------------------------------- camera */

export interface CameraDevice {
  deviceId: string;
  label: string;
}

/**
 * Opens a camera, preferring the one on the back of the phone.
 *
 * `facingMode` is a wish, not a constraint — `ideal` rather than `exact`, so a
 * laptop with a single front camera still gets a picture instead of an error.
 */
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  const problem = cameraSupport();
  if (problem !== null) throw new CameraError(problem);

  const video: MediaTrackConstraints =
    deviceId === undefined
      ? { facingMode: { ideal: 'environment' } }
      : { deviceId: { exact: deviceId } };

  try {
    return await navigator.mediaDevices.getUserMedia({
      // A larger picture is a sharper barcode; the browser gives what it can.
      video: { ...video, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (error) {
    throw cameraErrorFrom(error);
  }
}

/**
 * The cameras that can be switched to. Labels only exist once a permission has
 * been granted, so this is called after the first stream is running — before
 * that every entry would read "Kamera" and the list would be useless.
 */
export async function listCameras(): Promise<CameraDevice[]> {
  if (navigator.mediaDevices?.enumerateDevices === undefined) return [];

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label === '' ? `Kamera ${index + 1}` : device.label,
      }));
  } catch {
    // Switching cameras is a convenience; failing to enumerate is not worth an
    // error message on top of a working picture.
    return [];
  }
}

/** Capabilities the DOM types do not know about yet. */
interface TorchCapabilities {
  torch?: boolean;
}

/** The video track's flashlight, if it has one. */
export function hasTorch(stream: MediaStream): boolean {
  const [track] = stream.getVideoTracks();
  if (track?.getCapabilities === undefined) return false;

  const capabilities = track.getCapabilities() as MediaTrackCapabilities & TorchCapabilities;
  return capabilities.torch === true;
}

/**
 * Switches the flashlight. Returns whether it worked — a track can advertise
 * the capability and still refuse the constraint, and a torch that silently
 * does nothing should not leave the button looking switched on.
 */
export async function setTorch(stream: MediaStream, on: boolean): Promise<boolean> {
  const [track] = stream.getVideoTracks();
  if (track === undefined) return false;

  try {
    await track.applyConstraints({
      advanced: [{ torch: on } as MediaTrackConstraintSet & TorchCapabilities],
    });
    return true;
  } catch {
    return false;
  }
}

/** Stops every track, which is what turns the camera indicator off. */
export function closeCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

/* ---------------------------------------------------------------- decoding */

/**
 * Cuts the middle band out of the video frame and scales it down.
 *
 * Two reasons to look at a part instead of the whole picture: it is what the
 * frame on screen promises, and it is four times less work per attempt — which
 * on a phone is the difference between a scanner that feels instant and one
 * that lags behind the hand holding it.
 */
function frameImageData(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const { videoWidth, videoHeight } = video;
  if (videoWidth === 0 || videoHeight === 0) return null;

  const regionWidth = Math.round(videoWidth * SCAN_REGION.width);
  const regionHeight = Math.round(videoHeight * SCAN_REGION.height);
  const left = Math.round((videoWidth - regionWidth) / 2);
  const top = Math.round((videoHeight - regionHeight) / 2);

  const scale = Math.min(1, DECODE_MAX_EDGE / regionWidth);
  const width = Math.max(1, Math.round(regionWidth * scale));
  const height = Math.max(1, Math.round(regionHeight * scale));

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;

  context.drawImage(video, left, top, regionWidth, regionHeight, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

/**
 * One decode attempt against the current frame.
 *
 * The result is the normalised thirteen digit form, or `null` when there was
 * nothing to read. Everything the decoder returns still goes through
 * `normaliseEan()`: zxing checks the check digit, but the catalogue only ever
 * stores what our own validation accepts, and one gate is easier to trust than
 * two.
 */
export async function decodeFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  const image = frameImageData(video, canvas);
  if (image === null) return null;

  const { readBarcodes } = await loadReader();
  const results = await readBarcodes(image, READER_OPTIONS);

  for (const result of results) {
    if (!result.isValid) continue;
    const ean = normaliseEan(result.text);
    if (ean !== null) return ean;
  }

  return null;
}

/* --------------------------------------------------------------- feedback */

/**
 * Confirms a hit the way a supermarket till does: a short beep and a buzz.
 *
 * Both are best effort. iOS Safari has no `navigator.vibrate` at all, and audio
 * only plays after a user gesture — the scanner is started by a tap, so by the
 * time anything is decoded that condition is met. Neither failure is worth a
 * message: the screen already shows what was found.
 */
export function signalHit(): void {
  try {
    navigator.vibrate?.([40]);
  } catch {
    // Some browsers throw instead of returning false. Not our problem.
  }

  playBeep();
}

/** Reused across scans; creating one per hit hits the per page context limit. */
let audioContext: AudioContext | null = null;

function playBeep(): void {
  try {
    audioContext ??= new AudioContext();
    // Safari suspends the context until a gesture; the tap that started the
    // scanner is one, so this resolves silently in the normal case.
    void audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.frequency.value = 1320;
    // A ramp instead of a stop, or the beep ends in an audible click.
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.12);

    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.12);
  } catch {
    // No audio output, a blocked context, an old browser: all silent failures.
  }
}
