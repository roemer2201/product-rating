import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { RATING_COMMENT_MAX_LENGTH, type Rating } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { OfflineCapture } from '@/components/OfflineCapture';
import { useProductDraft } from '@/components/ProductDrafts';
import { StarRating } from '@/components/StarRating';
import { TextAreaField } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { emptyToNull } from '@/lib/forms';
import { useDeleteRating, useEnqueueCapture, useUpsertRating } from '@/lib/queries';
import { OWN_RATING_ANCHOR } from '@/lib/links';
import { strings } from '@/lib/strings';

/**
 * The caller's own rating of one product.
 *
 * Nothing is saved on a tap of a star. Stars and comment belong together, and
 * an accidental brush against a star while scrolling should not overwrite a
 * verdict — the save button is one deliberate tap, which is the right price for
 * the only piece of data in this app that is genuinely someone's opinion.
 *
 * What is changed and not saved yet is reported as a draft, so that coming
 * back to the page through the browser history finds it again. Saving or
 * removing the rating ends the draft; the page then shows what the server has.
 */

/** Stars and comment as they stand on screen, before they are saved. */
export interface RatingDraft {
  stars: number | null;
  comment: string;
}

interface RatingEditorProps {
  productId: string;
  /**
   * Identifies the product for a capture that is written down offline; `null`
   * for an entry without one, which the queue cannot take.
   */
  ean: string | null;
  productName: string;
  rating: Rating | null;
}

export function RatingEditor({ productId, ean, productName, rating }: RatingEditorProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    // The target does not exist until the product request has finished.
    if (hash === `#${OWN_RATING_ANCHOR}`) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start' });
    }
  }, [hash]);

  const { draft, update } = useProductDraft();
  const { stars, comment } = draft?.rating ?? {
    stars: rating?.stars ?? null,
    comment: rating?.comment ?? '',
  };
  const pending = draft?.ratingPending;
  const saveError = draft?.ratingError;
  const upsert = useUpsertRating();
  const remove = useDeleteRating();
  const capture = useEnqueueCapture();

  const change = (rating: RatingDraft): void => {
    if (capture.isSuccess) capture.reset();
    if (upsert.isSuccess) upsert.reset();
    if (remove.isSuccess) remove.reset();
    update({ rating });
  };

  const finish = (): void =>
    update({ rating: undefined, ratingPending: undefined, ratingError: undefined });

  // Keep the request and draft in the same history entry so a quick return
  // cannot submit them again before the original request settles.
  const onSave = (): void => {
    if (stars === null || pending !== undefined) return;
    capture.reset();
    remove.reset();
    update({ ratingPending: 'save', ratingError: undefined });
    void upsert
      .mutateAsync({ productId, input: { stars, comment: emptyToNull(comment) } })
      .then(finish, (ratingError: Error) => update({ ratingPending: undefined, ratingError }));
  };

  const onRemove = (): void => {
    if (pending !== undefined) return;
    capture.reset();
    upsert.reset();
    update({ ratingPending: 'remove', ratingError: undefined });
    void remove.mutateAsync(productId).then(finish, () => update({ ratingPending: undefined }));
  };

  const failure = capture.error ?? remove.error ?? saveError;

  /** The verdict as it stands on screen, for the queue. */
  const keepOffline = (): void => {
    if (stars === null || ean === null || pending !== undefined) return;
    update({ ratingPending: 'queue' });
    void capture
      .mutateAsync({
        ean,
        label: productName,
        rating: { stars, comment: emptyToNull(comment), capturedAt: Date.now() },
      })
      .then(finish, () => update({ ratingPending: undefined }));
  };

  return (
    <section className="section">
      <h2
        className="section__title rating-editor__title"
        ref={heading}
        id={OWN_RATING_ANCHOR}
        tabIndex={-1}
      >
        {strings.rating.own}
      </h2>

      {failure !== undefined && <ErrorNotice message={errorMessage(failure)} />}

      <OfflineCapture
        error={saveError}
        onKeep={ean === null ? null : keepOffline}
        kept={capture.isSuccess}
        pending={pending !== undefined}
      />

      <StarRating
        value={stars}
        onChange={(value) => {
          change({ stars: value, comment });
        }}
        disabled={pending !== undefined}
        label={strings.rating.own}
      />
      <p className="field__hint">{strings.rating.zeroHint}</p>

      <TextAreaField
        label={strings.rating.comment}
        name="comment"
        value={comment}
        onChange={(event) => {
          change({ stars, comment: event.target.value });
        }}
        maxLength={RATING_COMMENT_MAX_LENGTH}
        hint={strings.rating.commentHint}
        rows={3}
        disabled={pending !== undefined}
        optional
      />

      <div className="form__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={onSave}
          // Without a number of stars there is nothing to save; the comment
          // alone is not a rating.
          disabled={stars === null || pending !== undefined}
        >
          {pending === 'save' ? strings.common.saving : strings.rating.save}
        </button>

        {rating !== null && (
          <button
            type="button"
            className="button button--danger"
            onClick={onRemove}
            disabled={pending !== undefined}
          >
            {pending === 'remove' ? strings.common.deleting : strings.rating.remove}
          </button>
        )}
      </div>

      {upsert.isSuccess && (
        <p className="field__hint" role="status">
          {strings.common.saved}
        </p>
      )}
      {remove.isSuccess && (
        <p className="field__hint" role="status">
          {strings.rating.removed}
        </p>
      )}
    </section>
  );
}
