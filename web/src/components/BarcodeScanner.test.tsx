import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { strings } from '@/lib/strings';

/**
 * The camera lifecycle of the scanner.
 *
 * jsdom has neither a camera nor a decoder, so `lib/scanner` is replaced by a
 * stand-in that hands out streams on request and remembers whether they were
 * given back. That is what this file asks about: a stream that is opened and
 * never stopped is a camera that keeps recording, with the indicator lit on the
 * phone, until the page is reloaded — and `getUserMedia` is slow enough that a
 * screen can be closed while it is still answering.
 */

const camera = vi.hoisted(() => {
  class CameraError extends Error {
    problem: string;

    constructor(problem: string) {
      super(problem);
      this.problem = problem;
    }
  }

  /** One entry per stream handed out, `true` once its track was stopped. */
  const stopped: boolean[] = [];
  let gate: (() => void) | null = null;
  let holdNext = false;
  let failNext: string | null = null;
  let support: string | null = null;

  const openCamera = vi.fn(async () => {
    if (holdNext) {
      holdNext = false;
      await new Promise<void>((resolve) => {
        gate = resolve;
      });
    }

    if (failNext !== null) {
      const problem = failNext;
      failNext = null;
      throw new CameraError(problem);
    }

    const index = stopped.push(false) - 1;
    return {
      getTracks: () => [
        {
          stop: (): void => {
            stopped[index] = true;
          },
        },
      ],
    };
  });

  const closeCamera = vi.fn((stream: { getTracks: () => { stop: () => void }[] } | null) => {
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
  });

  return {
    CameraError,
    openCamera,
    closeCamera,
    stopped,
    cameraSupport: (): string | null => support,
    /** Makes the next `openCamera()` wait, the way a permission dialog does. */
    holdNextOpen: (): void => {
      holdNext = true;
    },
    /** Lets a held `openCamera()` answer. */
    finishOpen: (): void => {
      gate?.();
      gate = null;
    },
    failNextOpen: (problem: string): void => {
      failNext = problem;
    },
    setSupport: (next: string | null): void => {
      support = next;
    },
    reset: (): void => {
      stopped.length = 0;
      holdNext = false;
      failNext = null;
      gate = null;
      support = null;
    },
  };
});

vi.mock('@/lib/scanner', () => ({
  CameraError: camera.CameraError,
  DECODE_INTERVAL_MS: 10_000,
  cameraSupport: () => camera.cameraSupport(),
  closeCamera: (stream: { getTracks: () => { stop: () => void }[] } | null) =>
    camera.closeCamera(stream),
  decodeFrame: async () => null,
  hasTorch: () => false,
  listCameras: async () => [],
  openCamera: () => camera.openCamera(),
  setTorch: async () => false,
  signalHit: () => undefined,
  warmUpDecoder: () => undefined,
}));

beforeEach(() => {
  camera.reset();
  camera.openCamera.mockClear();
  camera.closeCamera.mockClear();
  // jsdom implements no media playback; without this the start path ends in
  // the catch and every test would see a camera problem instead of a picture.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

function renderScanner(props: { autoStart?: boolean } = {}) {
  return render(<BarcodeScanner onDetected={() => undefined} {...props} />);
}

describe('BarcodeScanner', () => {
  it('leaves the camera alone until it is asked', async () => {
    renderScanner();

    expect(await screen.findByRole('button', { name: strings.scan.start })).toBeInTheDocument();
    expect(camera.openCamera).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: strings.scan.start }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: strings.scan.stop })).toBeInTheDocument();
    });
    expect(camera.openCamera).toHaveBeenCalledTimes(1);
  });

  it('starts once on its own when the caller asks for it', async () => {
    renderScanner({ autoStart: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: strings.scan.stop })).toBeInTheDocument();
    });
    expect(camera.openCamera).toHaveBeenCalledTimes(1);
  });

  it('does not start again after the camera was stopped by hand', async () => {
    const user = userEvent.setup();
    renderScanner({ autoStart: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: strings.scan.stop })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: strings.scan.stop }));

    // The automatic start is one-shot: what the person switched off stays off.
    expect(await screen.findByRole('button', { name: strings.scan.start })).toBeEnabled();
    expect(camera.openCamera).toHaveBeenCalledTimes(1);
    expect(camera.stopped).toEqual([true]);
  });

  it('does not start on its own when there is no camera to start', async () => {
    camera.setSupport('insecure-context');
    renderScanner({ autoStart: true });

    expect(await screen.findByText(strings.scan.problem.insecureContext)).toBeInTheDocument();
    expect(camera.openCamera).not.toHaveBeenCalled();
  });

  it('offers another attempt after a camera that would not open', async () => {
    camera.failNextOpen('denied');
    renderScanner({ autoStart: true });

    expect(await screen.findByText(strings.scan.problem.denied)).toBeInTheDocument();
    // The button has to come back out of "Kamera wird gestartet …", or the
    // second attempt the message asks for would be impossible.
    expect(screen.getByRole('button', { name: strings.scan.start })).toBeEnabled();
  });

  it('gives back a stream that arrives after the scanner is gone', async () => {
    camera.holdNextOpen();
    const view = renderScanner({ autoStart: true });
    await waitFor(() => {
      expect(camera.openCamera).toHaveBeenCalled();
    });

    // The camera is still opening when the screen goes away.
    view.unmount();
    camera.finishOpen();

    await waitFor(() => {
      expect(camera.stopped).toEqual([true]);
    });
  });
});
