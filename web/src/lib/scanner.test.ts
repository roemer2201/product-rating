import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CameraError,
  cameraSupport,
  closeCamera,
  hasTorch,
  listCameras,
  openCamera,
  setTorch,
} from './scanner.js';

/**
 * The camera side of the scanner, which is the half that can fail in ways a
 * user has to be told about. Decoding itself is not tested here: it needs a
 * canvas with a real 2D context and a WebAssembly module, neither of which
 * jsdom has — it is covered by scanning a real barcode with a real phone.
 */

/**
 * A stream with one video track, as `getUserMedia` would hand it over. The
 * overrides are loosely typed on purpose: `torch` is not in the DOM types yet,
 * and a track without `getCapabilities` is exactly the Firefox case under test.
 */
function fakeStream(overrides: Record<string, unknown> = {}): MediaStream {
  const track = {
    kind: 'video',
    stop: vi.fn(),
    applyConstraints: vi.fn(() => Promise.resolve()),
    getCapabilities: () => ({}),
    ...overrides,
  } as unknown as MediaStreamTrack;

  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function stubMediaDevices(devices: Partial<MediaDevices>): void {
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: devices as MediaDevices });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cameraSupport', () => {
  it('reports a missing secure context before anything else', () => {
    vi.stubGlobal('window', { ...window, isSecureContext: false });
    expect(cameraSupport()).toBe('insecure-context');
  });

  it('reports a browser without the camera API', () => {
    vi.stubGlobal('window', { ...window, isSecureContext: true });
    stubMediaDevices({});
    expect(cameraSupport()).toBe('unsupported');
  });

  it('is happy when both are in place', () => {
    vi.stubGlobal('window', { ...window, isSecureContext: true });
    stubMediaDevices({ getUserMedia: vi.fn() });
    expect(cameraSupport()).toBeNull();
  });
});

describe('openCamera', () => {
  it('asks for the back camera and a large picture', async () => {
    const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) =>
      Promise.resolve(fakeStream()),
    );
    vi.stubGlobal('window', { ...window, isSecureContext: true });
    stubMediaDevices({ getUserMedia });

    await openCamera();

    const constraints = getUserMedia.mock.calls[0]?.[0];
    const video = constraints?.video as MediaTrackConstraints;
    // `ideal`, not `exact`: a laptop with only a front camera still gets one.
    expect(video.facingMode).toEqual({ ideal: 'environment' });
    expect(constraints?.audio).toBe(false);
  });

  it('asks for exactly the camera that was picked', async () => {
    const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) =>
      Promise.resolve(fakeStream()),
    );
    vi.stubGlobal('window', { ...window, isSecureContext: true });
    stubMediaDevices({ getUserMedia });

    await openCamera('cam-2');

    const video = getUserMedia.mock.calls[0]?.[0].video as MediaTrackConstraints;
    expect(video.deviceId).toEqual({ exact: 'cam-2' });
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'missing'],
    ['OverconstrainedError', 'missing'],
    ['NotReadableError', 'unavailable'],
    ['TypeError', 'unknown'],
  ])('turns %s into the problem %s', async (name, problem) => {
    vi.stubGlobal('window', { ...window, isSecureContext: true });
    stubMediaDevices({
      getUserMedia: vi.fn(() => Promise.reject(new DOMException('nope', name))),
    });

    const error = await openCamera().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CameraError);
    expect((error as CameraError).problem).toBe(problem);
  });

  it('refuses without a secure context instead of asking the browser', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('window', { ...window, isSecureContext: false });
    stubMediaDevices({ getUserMedia });

    const error = await openCamera().catch((thrown: unknown) => thrown);

    expect((error as CameraError).problem).toBe('insecure-context');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe('listCameras', () => {
  it('keeps the video inputs and names the unlabelled ones', async () => {
    stubMediaDevices({
      enumerateDevices: vi.fn(() =>
        Promise.resolve([
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Rückkamera' },
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Mikrofon' },
          { kind: 'videoinput', deviceId: 'cam-2', label: '' },
        ] as MediaDeviceInfo[]),
      ),
    });

    expect(await listCameras()).toEqual([
      { deviceId: 'cam-1', label: 'Rückkamera' },
      { deviceId: 'cam-2', label: 'Kamera 2' },
    ]);
  });

  it('answers with an empty list rather than failing', async () => {
    stubMediaDevices({ enumerateDevices: vi.fn(() => Promise.reject(new Error('no'))) });
    expect(await listCameras()).toEqual([]);
  });
});

describe('torch', () => {
  it('is only offered where the track advertises it', () => {
    expect(hasTorch(fakeStream({ getCapabilities: () => ({ torch: true }) }))).toBe(true);
    expect(hasTorch(fakeStream({ getCapabilities: () => ({}) }))).toBe(false);
    // Firefox has no `getCapabilities` at all.
    expect(hasTorch(fakeStream({ getCapabilities: undefined }))).toBe(false);
  });

  it('reports a refused constraint instead of pretending it worked', async () => {
    const working = fakeStream({ getCapabilities: () => ({ torch: true }) });
    expect(await setTorch(working, true)).toBe(true);

    const refusing = fakeStream({
      applyConstraints: vi.fn(() => Promise.reject(new Error('not supported'))),
    });
    expect(await setTorch(refusing, true)).toBe(false);
  });
});

describe('closeCamera', () => {
  it('stops every track and tolerates having none', () => {
    const stop = vi.fn();
    closeCamera(fakeStream({ stop }));
    expect(stop).toHaveBeenCalledTimes(1);

    expect(() => {
      closeCamera(null);
    }).not.toThrow();
  });
});
