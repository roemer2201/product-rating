import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { CameraIcon, PhotoIcon } from '@/components/icons';
import { preparePhoto, type PreparedPhoto } from '@/lib/image';
import { strings } from '@/lib/strings';

/**
 * Picking one picture: the two buttons, the shrinking, the preview.
 *
 * Two screens need exactly this and nothing more — the gallery of a product,
 * where the picture goes up on its own, and the form for a product that does
 * not exist yet, where it has to wait for the save. What follows the pick
 * differs, so what is shared here stops at the prepared picture: the caller
 * decides what happens to it.
 *
 * There are two ways to pick, because on iOS the `capture` attribute is not a
 * preference the user can step around: with it, Safari opens the camera and
 * nothing else. A picture that already exists — a label photographed earlier,
 * something a family member sent — would be unreachable behind that one
 * button, so the library gets a button of its own without the attribute.
 */

interface PhotoSourceProps {
  label: string;
  icon: ReactNode;
  /**
   * Set for the camera only. It is a wish, not a demand: a phone opens the
   * camera, a desktop browser ignores it and shows its usual file dialogue.
   * Left off, iOS offers the photo library instead.
   */
  capture?: 'environment';
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** One way into the picker; both sources end in the same `onPick`. */
function PhotoSource({ label, icon, capture, inputRef, onPick }: PhotoSourceProps) {
  return (
    <label className="button">
      {icon}
      {label}
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture={capture}
        onChange={onPick}
      />
    </label>
  );
}

export interface PhotoPick {
  /** The shrunk picture, ready to be sent. */
  picked: PreparedPhoto | null;
  /** Object URL of the same picture, for the preview. */
  preview: string | null;
  /** True while the file is being decoded and scaled down. */
  preparing: boolean;
  cameraRef: RefObject<HTMLInputElement | null>;
  libraryRef: RefObject<HTMLInputElement | null>;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
  clear: () => void;
}

interface PhotoPickOptions {
  initial?: PreparedPhoto | null;
  onChange?: (photo: PreparedPhoto | null) => void;
  /** Runs before a new file is prepared, so a screen can clear what it showed. */
  onStart?: () => void;
}

/** Holds the picked picture; `PhotoSources` and `PhotoPreview` display it. */
export function usePhotoPick({
  initial = null,
  onChange,
  onStart,
}: PhotoPickOptions = {}): PhotoPick {
  // One ref per source: whichever one was used has to be emptied afterwards,
  // or picking the same file again fires no `change` event.
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState(initial);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const latestPick = useRef(0);

  // An object URL is a reference the browser holds until it is told otherwise.
  useEffect(() => {
    const url = picked === null ? null : URL.createObjectURL(picked.blob);
    setPreview(url);
    return () => {
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [picked]);

  useEffect(() => {
    return () => {
      latestPick.current += 1;
    };
  }, []);

  const clear = (): void => {
    latestPick.current += 1;
    setPicked(null);
    setPreparing(false);
    onChange?.(null);
    for (const ref of [cameraRef, libraryRef]) {
      if (ref.current !== null) ref.current.value = '';
    }
  };

  const take = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (file === undefined) return;

    const request = ++latestPick.current;
    onStart?.();
    setPreparing(true);

    try {
      const prepared = await preparePhoto(file);
      if (request !== latestPick.current) return;
      setPicked(prepared);
      onChange?.(prepared);
    } finally {
      if (request === latestPick.current) setPreparing(false);
    }
  };

  return {
    picked,
    preview,
    preparing,
    cameraRef,
    libraryRef,
    onPick: (event) => void take(event),
    clear,
  };
}

/** The two buttons that lead into the camera and into the photo library. */
export function PhotoSources({ pick }: { pick: PhotoPick }) {
  return (
    <div className="photo-upload__sources">
      <PhotoSource
        label={strings.photo.take}
        icon={<CameraIcon className="button__icon" />}
        capture="environment"
        inputRef={pick.cameraRef}
        onPick={pick.onPick}
      />

      <PhotoSource
        label={strings.photo.choose}
        icon={<PhotoIcon className="button__icon" />}
        inputRef={pick.libraryRef}
        onPick={pick.onPick}
      />
    </div>
  );
}

interface PhotoPreviewProps {
  src: string;
  /**
   * Runs once the picture has a height — or has failed to get one. Only then
   * do the buttons below it stand where they will end up, which is what the
   * screens use to bring them into view.
   */
  onShown: () => void;
  /** Everything under the picture: progress, errors, the buttons. */
  children?: ReactNode;
}

export function PhotoPreview({ src, onShown, children }: PhotoPreviewProps) {
  return (
    <div className="photo-upload__preview">
      <img
        className="photo-upload__image"
        src={src}
        alt={strings.photo.previewAlt}
        onLoad={onShown}
        onError={onShown}
      />
      {children}
    </div>
  );
}
