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
 */

interface RatingEditorProps {
  productId: string;
  /** Identifies the product for a capture that is written down offline. */
  ean: string;
  productName: string;
  rating: Rating | null;
}

export function RatingEditor({ productId, ean, productName, rating }: RatingEditorProps) {
  const [stars, setStars] = useState<number | null>(rating?.stars ?? null);
  const [comment, setComment] = useState(rating?.comment ?? '');

  const upsert = useUpsertRating();
  const remove = useDeleteRating();
  const capture = useEnqueueCapture();

  const onSave = (): void => {
    if (stars === null) return;
    upsert.mutate({ productId, input: { stars, comment: emptyToNull(comment) } });
  };

  const onRemove = (): void => {
    remove.mutate(productId, {
      onSuccess: () => {
        setStars(null);
        setComment('');
      },
    });
  };

  const failure = upsert.error ?? remove.error;

  /** The verdict as it stands on screen, for the queue. */
  const keepOffline = (): void => {
    if (stars === null) return;
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
        onKeep={keepOffline}
        kept={capture.isSuccess}
        pending={capture.isPending}
      />

      <StarRating
        value={stars}
        onChange={setStars}
        disabled={upsert.isPending || remove.isPending}
        label={strings.rating.own}
      />
      <p className="field__hint">{strings.rating.zeroHint}</p>

      <TextAreaField
        label={strings.rating.comment}
        name="comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
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
