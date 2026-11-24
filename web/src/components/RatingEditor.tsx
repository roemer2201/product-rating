import { useState } from 'react';
import { RATING_COMMENT_MAX_LENGTH, type Rating } from '@product-rating/shared';
import { ErrorNotice } from '@/components/Feedback';
import { OfflineCapture } from '@/components/OfflineCapture';
import { StarRating } from '@/components/StarRating';
import { TextAreaField } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { emptyToNull } from '@/lib/forms';
import { useDeleteRating, useEnqueueCapture, useUpsertRating } from '@/lib/queries';
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
  /** Unsaved changes from an earlier visit of the same history entry. */
  draft?: RatingDraft | undefined;
  onDraftChange?: (draft: RatingDraft | undefined) => void;
}

export function RatingEditor({
  productId,
  ean,
  productName,
  rating,
  draft,
  onDraftChange,
}: RatingEditorProps) {
  const [stars, setStars] = useState<number | null>(
    draft === undefined ? (rating?.stars ?? null) : draft.stars,
  );
  const [comment, setComment] = useState(
    draft === undefined ? (rating?.comment ?? '') : draft.comment,
  );

  const change = (next: RatingDraft): void => {
    setStars(next.stars);
    setComment(next.comment);
    onDraftChange?.(next);
  };

  const upsert = useUpsertRating();
  const remove = useDeleteRating();
  const capture = useEnqueueCapture();

  // Not `mutate` with callbacks: those are dropped once the page is left, and
  // a draft that outlived its save would come back as unsaved on return.
  const onSave = (): void => {
    if (stars === null) return;
    upsert.mutateAsync({ productId, input: { stars, comment: emptyToNull(comment) } }).then(
      () => onDraftChange?.(undefined),
      // The failure is on screen through the mutation's own state.
      () => undefined,
    );
  };

  const onRemove = (): void => {
    remove.mutateAsync(productId).then(
      () => {
        setStars(null);
        setComment('');
        onDraftChange?.(undefined);
      },
      () => undefined,
    );
  };

  const failure = upsert.error ?? remove.error;

  /** The verdict as it stands on screen, for the queue. */
  const keepOffline = (): void => {
    if (stars === null || ean === null) return;
    capture.mutate({
      ean,
      label: productName,
      rating: { stars, comment: emptyToNull(comment), capturedAt: Date.now() },
    });
  };

  return (
    <section className="section">
      <h2 className="section__title">{strings.rating.own}</h2>

      {failure !== null && <ErrorNotice message={errorMessage(failure)} />}

      <OfflineCapture
        error={upsert.error}
        onKeep={ean === null ? null : keepOffline}
        kept={capture.isSuccess}
        pending={capture.isPending}
      />

      <StarRating
        value={stars}
        onChange={(value) => {
          change({ stars: value, comment });
        }}
        disabled={upsert.isPending || remove.isPending}
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
        optional
      />

      <div className="form__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={onSave}
          // Without a number of stars there is nothing to save; the comment
          // alone is not a rating.
          disabled={stars === null || upsert.isPending}
        >
          {upsert.isPending ? strings.common.saving : strings.rating.save}
        </button>

        {rating !== null && (
          <button
            type="button"
            className="button button--danger"
            onClick={onRemove}
            disabled={remove.isPending}
          >
            {remove.isPending ? strings.common.deleting : strings.rating.remove}
          </button>
        )}
      </div>

      {upsert.isSuccess && !upsert.isPending && (
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
