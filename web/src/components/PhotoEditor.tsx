import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { canvasToBlob, jpegName, UPLOAD_MAX_EDGE } from '@/lib/image';
import { drawEditedPhoto, FULL_IMAGE, isFullImage, type PhotoEdits } from '@/lib/photoEditor';
import { errorMessage } from '@/lib/api';
import { useOnlineStatus } from '@/lib/online';
import { strings } from '@/lib/strings';

type SavePhoto = (file: Blob, filename: string) => void | Promise<unknown>;
type Mode = 'crop' | 'focus';
type Point = { x: number; y: number };

const initial: PhotoEdits = {
  turns: 0,
  crop: FULL_IMAGE,
  portrait: false,
  focus: { x: 0.5, y: 0.5 },
  focusSize: 0.55,
};
const label = strings.photo.editor;

/** How far one arrow key moves the crop or the focus, as a share of the frame. */
const KEY_STEP = 0.02;
/** The smallest crop the keyboard leaves, so the frame never vanishes. */
const MIN_CROP = 0.05;
const ARROWS: Partial<Record<string, Point>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function clamp(value: number, min = 0, max = 1): number {
  // Rounded, so a few steps back and forth land on the value they started at.
  return Math.round(Math.min(max, Math.max(min, value)) * 1000) / 1000;
}

interface PhotoEditButtonProps {
  src: string;
  filename: string;
  onSave: SavePhoto;
  disabled?: boolean;
  savedPhoto?: boolean;
  ariaLabel?: string;
}

export function PhotoEditButton({ disabled, ariaLabel, ...editor }: PhotoEditButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="button button--quiet"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label.open}
      </button>
      {open &&
        createPortal(<PhotoEditor {...editor} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function PhotoEditor({
  src,
  filename,
  onSave,
  onClose,
  savedPhoto,
}: Omit<PhotoEditButtonProps, 'disabled' | 'ariaLabel'> & { onClose: () => void }) {
  const titleId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ pointerId: number; start: Point } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [edits, setEdits] = useState(initial);
  const [mode, setMode] = useState<Mode>('crop');
  const [savePending, setSavePending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Replacing a gallery photo is a request; there is no queue for it, so the
  // button says so before it is pressed rather than failing afterwards.
  const online = useOnlineStatus();
  const offline = savedPhoto === true && !online;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const source = new Image();
    source.onload = () => setImage(source);
    source.onerror = () => setFailed(true);
    source.src = src;
    return () => {
      source.onload = null;
      source.onerror = null;
    };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (image === null || canvas === null) return;
    try {
      drawEditedPhoto(canvas, image, edits, 640, true);
    } catch {
      setFailed(true);
    }
  }, [image, edits]);

  const changed = edits.turns !== 0 || edits.portrait || !isFullImage(edits.crop);
  const ready = image !== null && !failed && !savePending;

  const rotate = (turns: number): void => {
    setEdits((old) => {
      const { x, y, width, height } = old.crop;
      return {
        ...old,
        turns: (old.turns + turns + 4) % 4,
        crop:
          old.crop === FULL_IMAGE
            ? FULL_IMAGE
            : turns === 1
              ? { x: 1 - y - height, y: x, width: height, height: width }
              : { x: y, y: 1 - x - width, width: height, height: width },
        focus:
          turns === 1
            ? { x: 1 - old.focus.y, y: old.focus.x }
            : { x: old.focus.y, y: 1 - old.focus.x },
      };
    });
  };

  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const select = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (!ready || event.button !== 0 || drag.current !== null) return;
    const start = point(event);
    if (mode === 'focus') {
      setEdits((old) => ({ ...old, focus: start }));
    } else {
      drag.current = { pointerId: event.pointerId, start };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const resizeCrop = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (!ready || drag.current?.pointerId !== event.pointerId) return;
    const start = drag.current.start;
    const end = point(event);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    if (width < 0.02 || height < 0.02) return;
    setEdits((old) => ({
      ...old,
      crop: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height },
    }));
  };

  /**
   * The keyboard way to what a finger does on the picture: arrows move the
   * focus or the crop, and with Shift they change the size of the crop -
   * right and down make it larger, left and up smaller.
   */
  const nudge = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    const direction = ARROWS[event.key];
    if (!ready || direction === undefined) return;
    event.preventDefault();
    const dx = direction.x * KEY_STEP;
    const dy = direction.y * KEY_STEP;
    const resize = event.shiftKey;
    setEdits((old) => {
      if (mode === 'focus') {
        return { ...old, focus: { x: clamp(old.focus.x + dx), y: clamp(old.focus.y + dy) } };
      }
      const { x, y, width, height } = old.crop;
      const crop = resize
        ? {
            x,
            y,
            width: clamp(width + dx, MIN_CROP, 1 - x),
            height: clamp(height + dy, MIN_CROP, 1 - y),
          }
        : { x: clamp(x + dx, 0, 1 - width), y: clamp(y + dy, 0, 1 - height), width, height };
      return { ...old, crop: isFullImage(crop) ? FULL_IMAGE : crop };
    });
  };

  const save = async (): Promise<void> => {
    if (image === null || !ready || !changed || offline) return;
    setSavePending(true);
    setSaveError(null);
    try {
      const canvas = document.createElement('canvas');
      drawEditedPhoto(canvas, image, edits, UPLOAD_MAX_EDGE, false);
      const file = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      try {
        await onSave(file, jpegName(filename));
      } catch (error) {
        setSaveError(errorMessage(error));
        return;
      }
      onClose();
    } catch {
      setSaveError(label.cannotSave);
    } finally {
      setSavePending(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="photo-editor"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!savePending) onClose();
      }}
    >
      <h2 id={titleId} className="section__title">
        {label.title}
      </h2>
      {image === null && !failed && <p role="status">{label.loading}</p>}
      {failed && <p role="alert">{label.cannotOpen}</p>}
      <canvas
        ref={canvasRef}
        className="photo-editor__canvas"
        hidden={image === null || failed}
        tabIndex={ready ? 0 : -1}
        role="img"
        aria-label={strings.photo.preview}
        aria-describedby={hintId}
        onKeyDown={nudge}
        onPointerDown={select}
        onPointerMove={resizeCrop}
        onPointerUp={resizeCrop}
        onLostPointerCapture={(event) => {
          if (drag.current?.pointerId === event.pointerId) drag.current = null;
        }}
      />
      <p id={hintId} className="field__hint">
        {mode === 'crop' ? label.cropHint : label.focusHint}{' '}
        {mode === 'crop' ? label.cropKeys : label.focusKeys}
      </p>
      <div className="form__actions">
        <button type="button" className="button" disabled={!ready} onClick={() => rotate(-1)}>
          {label.left}
        </button>
        <button type="button" className="button" disabled={!ready} onClick={() => rotate(1)}>
          {label.right}
        </button>
        <button
          type="button"
          className="button"
          disabled={!ready}
          aria-pressed={mode === 'crop'}
          onClick={() => setMode('crop')}
        >
          {label.crop}
        </button>
        <button
          type="button"
          className="button"
          disabled={!ready}
          aria-pressed={edits.portrait}
          onClick={() => {
            setMode(edits.portrait ? 'crop' : 'focus');
            setEdits((old) => ({ ...old, portrait: !old.portrait }));
          }}
        >
          {label.portrait}
        </button>
        {edits.portrait && mode === 'crop' && (
          <button
            type="button"
            className="button"
            disabled={!ready}
            onClick={() => setMode('focus')}
          >
            {label.focus}
          </button>
        )}
      </div>
      {mode === 'focus' && (
        <label className="photo-editor__range">
          {label.focusSize}
          <input
            type="range"
            min={20}
            max={90}
            value={Math.round(edits.focusSize * 100)}
            disabled={!ready}
            onChange={(event) => {
              const focusSize = Number(event.currentTarget.value) / 100;
              setEdits((old) => ({ ...old, focusSize }));
            }}
          />
        </label>
      )}
      {savedPhoto && changed && <p className="field__hint">{label.replaceHint}</p>}
      {offline && <p className="field__hint">{label.offline}</p>}
      {saveError !== null && <p role="alert">{saveError}</p>}
      <div className="form__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!ready || !changed || offline}
          onClick={() => void save()}
        >
          {savePending ? label.saving : savedPhoto ? label.replace : label.apply}
        </button>
        <button
          type="button"
          className="button"
          disabled={!ready || !changed}
          onClick={() => {
            setEdits(initial);
            setMode('crop');
            setSaveError(null);
          }}
        >
          {label.reset}
        </button>
        <button type="button" className="button" disabled={savePending} onClick={onClose}>
          {strings.common.cancel}
        </button>
      </div>
    </dialog>
  );
}
