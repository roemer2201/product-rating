import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Photo, User } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { OfflineCapture } from '@/components/OfflineCapture';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, PhotoIcon, TrashIcon } from '@/components/icons';
import { api, errorMessage } from '@/lib/api';
import { preparePhoto, type PreparedPhoto } from '@/lib/image';
import {
  useDeletePhoto,
  useEnqueueCapture,
  useMovePhoto,
  useSetPrimaryPhoto,
  useUploadPhoto,
} from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The photos of a product: what is there, and how another one gets added.
 *
 * The route from the camera to the server has four steps, and each one can be
 * seen: pick, shrink, look at it, upload. The preview exists because a picture
 * taken at a shelf is often of a thumb, and noticing that before the upload
 * saves the wait — the shrinking is what makes the wait bearable in the first
 * place.
 *
 * A failed upload keeps the prepared picture, so retrying is one tap and not
 * another trip to the camera.
 *
 * The tiles are shown in the order the product carries them, and the first one
 * is the picture on the card. Moving a photo is therefore the same act as
 * promoting it, which is why the arrows and "Als Hauptbild" sit next to each
 * other instead of in two different places.
 */

interface PhotoManagerProps {
  productId: string;
  /** Identifies the product for a picture that is written down offline. */
  ean: string;
  productName: string;
  photos: Photo[];
  user: User;
}

export function PhotoManager({ productId, ean, productName, photos, user }: PhotoManagerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<PreparedPhoto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const setPrimary = useSetPrimaryPhoto();
  const move = useMovePhoto();
  const capture = useEnqueueCapture();

  // An object URL is a reference the browser holds until it is told otherwise.
  useEffect(() => {
    if (preview === null) return;
    return () => {
      URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const clearPick = (): void => {
    setPicked(null);
    setPreview(null);
    setProgress(null);
    upload.reset();
    if (inputRef.current !== null) inputRef.current.value = '';
  };

  const onPick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (file === undefined) return;

    setDone(false);
    setPreparing(true);
    upload.reset();

    try {
      const prepared = await preparePhoto(file);
      setPicked(prepared);
      setPreview(URL.createObjectURL(prepared.blob));
    } finally {
      setPreparing(false);
    }
  };

  const startUpload = (): void => {
    if (picked === null) return;

    setProgress(0);
    upload.mutate(
      {
        productId,
        file: picked.blob,
        options: {
          filename: picked.filename,
          onProgress: (fraction) => {
            setProgress(fraction);
          },
        },
      },
      {
        onSuccess: () => {
          clearPick();
          setDone(true);
        },
        // The prepared picture stays; the retry button uses it again.
        onError: () => {
          setProgress(null);
        },
      },
    );
  };

  const mayChange = (photo: Photo): boolean => photo.userId === user.id || user.role === 'admin';

  return (
    <section className="section">
      <h2 className="section__title">{strings.photo.title}</h2>

      {photos.length === 0 ? (
        <p className="section__intro">{strings.photo.empty}</p>
      ) : (
        <ul className="photo-grid">
          {photos.map((photo, index) => (
            <li className="photo-grid__item" key={photo.id}>
              {/*
                No `width`/`height` attributes: they are presentation hints that
                set the CSS height, which would win over the square box below
                and collapse the tile to the picture's own proportions. The box
                is fixed in CSS, so there is nothing left for them to stabilise.
              */}
              <img
                className="photo-grid__image"
                src={api.photos.url(photo.id, 'thumb')}
                alt={strings.photo.alt(index + 1)}
                loading="lazy"
              />

              <div className="photo-grid__actions">
                {mayChange(photo) && (
                  <span className="photo-grid__order">
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() =>
                        move.mutate({ photoId: photo.id, productId, position: index - 1 })
                      }
                      disabled={index === 0 || move.isPending}
                      aria-label={strings.photo.moveUpFor(index + 1)}
                      title={strings.photo.moveUp}
                    >
                      <ArrowUpIcon className="button__icon" />
                    </button>

                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() =>
                        move.mutate({ photoId: photo.id, productId, position: index + 1 })
                      }
                      disabled={index === photos.length - 1 || move.isPending}
                      aria-label={strings.photo.moveDownFor(index + 1)}
                      title={strings.photo.moveDown}
                    >
                      <ArrowDownIcon className="button__icon" />
                    </button>
                  </span>
                )}

                {photo.isPrimary ? (
                  <span className="badge badge--primary">
                    <CheckIcon className="badge__icon" />
                    {strings.photo.isPrimary}
                  </span>
                ) : (
                  mayChange(photo) && (
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => setPrimary.mutate({ photoId: photo.id, productId })}
                      disabled={setPrimary.isPending}
                    >
                      {strings.photo.setPrimary}
                    </button>
                  )
                )}

                {mayChange(photo) && (
                  <button
                    type="button"
                    className="button button--quiet button--danger"
                    onClick={() => remove.mutate({ photoId: photo.id, productId })}
                    disabled={remove.isPending}
                    aria-label={strings.photo.remove}
                  >
                    <TrashIcon className="button__icon" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {photos.length > 1 && <p className="section__intro">{strings.photo.orderHint}</p>}

      {remove.error !== null && <ErrorNotice message={errorMessage(remove.error)} />}
      {setPrimary.error !== null && <ErrorNotice message={errorMessage(setPrimary.error)} />}
      {move.error !== null && <ErrorNotice message={errorMessage(move.error)} />}

      <div className="photo-upload">
        <label className="button">
          <PhotoIcon className="button__icon" />
          {strings.photo.take}
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            // Opens the camera directly on a phone and stays a file picker
            // everywhere else — the attribute is a wish, not a demand.
            capture="environment"
            onChange={(event) => void onPick(event)}
          />
        </label>

        {preparing && <p role="status">{strings.photo.preparing}</p>}
        {done && <p role="status">{strings.photo.uploaded}</p>}

        {preview !== null && picked !== null && (
          <div className="photo-upload__preview">
            <img className="photo-upload__image" src={preview} alt={strings.photo.previewAlt} />

            {progress !== null && (
              <progress
                className="photo-upload__progress"
                value={progress}
                max={1}
                aria-label={strings.photo.uploading}
              >
                {strings.photo.progress(Math.round(progress * 100))}
              </progress>
            )}

            {upload.error !== null && <ErrorNotice message={errorMessage(upload.error)} />}

            {/* The picture is already shrunk and in hand; the queue takes the
                bytes as they are and uploads them when there is a line. */}
            <OfflineCapture
              error={upload.error}
              onKeep={() => {
                capture.mutate(
                  {
                    ean,
                    label: productName,
                    photos: [{ blob: picked.blob, filename: picked.filename }],
                  },
                  { onSuccess: clearPick },
                );
              }}
              kept={capture.isSuccess}
              pending={capture.isPending}
            />

            <div className="form__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={startUpload}
                disabled={upload.isPending}
              >
                {upload.isPending
                  ? strings.photo.uploading
                  : upload.error === null
                    ? strings.photo.upload
                    : strings.photo.retry}
              </button>

              <button
                type="button"
                className="button"
                onClick={clearPick}
                disabled={upload.isPending}
              >
                {strings.photo.discard}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
