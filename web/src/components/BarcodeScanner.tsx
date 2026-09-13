import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraIcon, TorchIcon } from '@/components/icons';
import { ErrorNotice } from '@/components/Feedback';
import {
  CameraError,
  DECODE_INTERVAL_MS,
  cameraSupport,
  closeCamera,
  decodeFrame,
  hasTorch,
  listCameras,
  openCamera,
  setTorch,
  signalHit,
  warmUpDecoder,
  type CameraDevice,
  type CameraProblem,
} from '@/lib/scanner';
import { strings } from '@/lib/strings';

/**
 * The camera half of the scan screen: picture, frame, torch and camera choice.
 *
 * It knows nothing about products — it reports a decoded EAN and is done. The
 * screen around it decides what that means, which is what keeps the camera
 * lifecycle out of the routing and the routing out of the render loop.
 *
 * The camera does not start on its own. Opening it costs battery and lights the
 * indicator on the phone, and a screen that grabs the camera because it was
 * navigated to is a screen people stop navigating to. Callers that are opened
 * by an explicit camera action may opt in to a one-time automatic start.
 */

interface BarcodeScannerProps {
  onDetected: (ean: string) => void;
  /** Stops decoding without giving up the camera, e.g. during the lookup. */
  paused?: boolean;
  /** Starts the camera once on mount, for an explicit user-triggered scanner. */
  autoStart?: boolean;
}

/** The German explanation for each way the camera can be unavailable. */
function problemText(problem: CameraProblem): string {
  switch (problem) {
    case 'insecure-context':
      return strings.scan.problem.insecureContext;
    case 'unsupported':
      return strings.scan.problem.unsupported;
    case 'denied':
      return strings.scan.problem.denied;
    case 'missing':
      return strings.scan.problem.missing;
    case 'unavailable':
      return strings.scan.problem.unavailable;
    case 'unknown':
      return strings.scan.problem.unknown;
  }
}

export function BarcodeScanner({
  onDetected,
  paused = false,
  autoStart = false,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoStartedRef = useRef(false);
  /**
   * Numbers the starts, so a stream can tell whether anyone still wants it.
   *
   * `getUserMedia` takes as long as it takes — a permission dialog, a camera
   * that has to wake up — and in that time the scanner can be closed or pointed
   * at another camera. The stream then arrives for a start nobody is waiting
   * for any more, and without this it would be stored in `streamRef` after the
   * cleanup has already run: a track that keeps recording, with the camera
   * indicator lit, until the page is reloaded.
   */
  const startIdRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  // Known before anything is opened: no HTTPS, no camera API.
  const [problem, setProblem] = useState<CameraProblem | null>(() => cameraSupport());
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [torchOn, setTorchOn] = useState(false);
  const [torchReady, setTorchReady] = useState(false);
  const [torchFailed, setTorchFailed] = useState(false);

  const stop = useCallback(() => {
    // Whatever is still opening belongs to nobody from here on.
    startIdRef.current += 1;
    closeCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    setRunning(false);
    setStarting(false);
    setTorchOn(false);
    setTorchReady(false);
  }, []);

  const start = useCallback(async (nextDeviceId?: string) => {
    const startId = (startIdRef.current += 1);
    /** False once this start has been stopped or overtaken by a later one. */
    const isCurrent = (): boolean => startIdRef.current === startId;

    setStarting(true);
    setProblem(null);
    setTorchFailed(false);
    // Fetch the decoder while the camera warms up, not at the first frame.
    warmUpDecoder();

    // A second stream on the same hardware fails on some phones.
    closeCamera(streamRef.current);
    streamRef.current = null;

    try {
      const stream = await openCamera(nextDeviceId);

      // Closed or restarted while the camera was opening: give the stream back
      // at once instead of leaving a track running that nothing points at.
      if (!isCurrent()) {
        closeCamera(stream);
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;
      if (video !== null) {
        video.srcObject = stream;
        // Safari rejects the promise when the element is torn down mid-play;
        // there is nothing to do about it and nothing to report.
        await video.play().catch(() => undefined);
      }

      // `stop()` during `play()` has already closed the stream this start put
      // into `streamRef`; announcing it as running would show a dead picture.
      if (!isCurrent()) return;

      setRunning(true);
      setTorchReady(hasTorch(stream));
      // Labels only exist once a permission has been granted, so the list is
      // read after the first stream rather than before it.
      const cameras = await listCameras();
      if (isCurrent()) setDevices(cameras);
    } catch (error) {
      // A failure of a start that has been given up says nothing about the one
      // that took its place.
      if (!isCurrent()) return;
      streamRef.current = null;
      setRunning(false);
      setProblem(error instanceof CameraError ? error.problem : 'unknown');
    } finally {
      // `stop()` has already cleared this, and a later start owns it now.
      if (isCurrent()) setStarting(false);
    }
  }, []);

  // An inline scanner opened through a camera button already has the user's
  // intent to use the camera, so it may start immediately. This is deliberately
  // one-shot: pressing "Kamera anhalten" must not start it again.
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || problem !== null) return;
    autoStartedRef.current = true;
    void start(deviceId);
  }, [autoStart, deviceId, problem, start]);

  // Give the camera back when the screen goes away, whatever the reason.
  useEffect(() => stop, [stop]);

  /**
   * The decode loop. A timeout chain rather than an interval: one attempt has
   * to finish before the next is scheduled, or a slow frame on an old phone
   * would queue up behind itself.
   */
  useEffect(() => {
    if (!running || paused) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (): Promise<void> => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!cancelled && video !== null && canvas !== null) {
        try {
          const ean = await decodeFrame(video, canvas);
          if (ean !== null && !cancelled) {
            signalHit();
            onDetected(ean);
            return;
          }
        } catch {
          // A frame that could not be read is the normal case, not an error.
        }
      }

      if (!cancelled) timer = setTimeout(() => void tick(), DECODE_INTERVAL_MS);
    };

    timer = setTimeout(() => void tick(), DECODE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, paused, onDetected]);

  const onToggleTorch = async (): Promise<void> => {
    const stream = streamRef.current;
    if (stream === null) return;

    const next = !torchOn;
    const worked = await setTorch(stream, next);
    setTorchOn(worked && next);
    setTorchFailed(!worked);
  };

  const onSelectCamera = (nextDeviceId: string): void => {
    setDeviceId(nextDeviceId);
    if (running) void start(nextDeviceId);
  };

  const blocked = problem === 'insecure-context' || problem === 'unsupported';

  return (
    <div className="scanner">
      <div className={`scanner__stage${running ? ' scanner__stage--live' : ''}`}>
        <video
          ref={videoRef}
          className="scanner__video"
          aria-label={strings.scan.videoLabel}
          muted
          playsInline
          // iOS only plays a stream inline when the element is also muted and
          // carries no controls; a full screen player would hide the frame.
          disablePictureInPicture
        />
        {running && <div className="scanner__frame" aria-hidden="true" />}
        {!running && (
          <div className="scanner__idle">
            <CameraIcon className="scanner__idle-icon" />
          </div>
        )}
      </div>

      {/* Never shown; the decoder reads its frames from here. */}
      <canvas ref={canvasRef} className="visually-hidden" />

      {problem !== null && <ErrorNotice message={problemText(problem)} />}
      {torchFailed && <p className="field__hint">{strings.scan.torchFailed}</p>}

      <div className="scanner__controls">
        {running ? (
          <button type="button" className="button" onClick={stop}>
            {strings.scan.stop}
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary"
            onClick={() => void start(deviceId)}
            disabled={starting || blocked}
          >
            {starting ? strings.scan.starting : strings.scan.start}
          </button>
        )}

        {running && torchReady && (
          <button
            type="button"
            className={`button${torchOn ? ' button--primary' : ''}`}
            onClick={() => void onToggleTorch()}
            aria-pressed={torchOn}
          >
            <TorchIcon className="button__icon" />
            {torchOn ? strings.scan.torchOff : strings.scan.torchOn}
          </button>
        )}
      </div>

      {running && devices.length > 1 && (
        <label className="scanner__cameras">
          <span className="field__label">{strings.scan.cameraSelect}</span>
          <select
            className="field__input field__input--select"
            value={deviceId ?? ''}
            onChange={(event) => {
              onSelectCamera(event.target.value);
            }}
          >
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
