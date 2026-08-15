import { useId } from 'react';
import { RATING_MAX_STARS, RATING_MIN_STARS } from '@product-rating/shared';
import { formatStars } from '@/lib/format';
import { strings } from '@/lib/strings';

/**
 * The star rating, once to look at and once to set.
 *
 * Whole stars only — halves would not survive a thumb on a phone, and a
 * household arguing over 3.5 versus 4 was never the point. Zero stars is a
 * deliberate verdict and therefore its own option: "not rated" is expressed by
 * having no rating at all, which is what the remove button is for.
 */

interface StarDisplayProps {
  stars: number;
  /** Adds the number in words for screen readers; off inside a labelled row. */
  labelled?: boolean;
  className?: string;
}

/** Read only stars, e.g. in a list row. */
export function StarDisplay({ stars, labelled = true, className }: StarDisplayProps) {
  const text = formatStars(stars);

  return (
    <span
      className={className === undefined ? 'stars-display' : `stars-display ${className}`}
      {...(labelled ? { role: 'img', 'aria-label': strings.rating.starsOf(stars) } : {})}
      // Without a label the glyphs are decoration next to text that says it.
      {...(labelled ? {} : { 'aria-hidden': true })}
    >
      {text}
    </span>
  );
}

interface StarRatingProps {
  value: number | null;
  onChange: (stars: number) => void;
  disabled?: boolean;
  /** Names the group for assistive technology. */
  label?: string;
}

const OPTIONS = Array.from(
  { length: RATING_MAX_STARS - RATING_MIN_STARS + 1 },
  (_entry, index) => RATING_MIN_STARS + index,
);

/**
 * The interactive widget: one radio per possible rating.
 *
 * Native radios rather than buttons with `role="radio"` — that way arrow key
 * navigation, the tab stop and the announcement come from the browser instead
 * of from code that has to be maintained. The inputs are visually hidden and
 * their labels carry the star, which keeps a 44 pixel touch target without
 * giving up any of that.
 */
export function StarRating({ value, onChange, disabled = false, label }: StarRatingProps) {
  const name = useId();

  return (
    <div className="stars" role="radiogroup" aria-label={label ?? strings.rating.starsLabel}>
      {OPTIONS.map((stars) => {
        const checked = value === stars;
        const filled = value !== null && stars > 0 && stars <= value;

        return (
          <label
            key={stars}
            className={`stars__option${checked ? ' stars__option--checked' : ''}${
              stars === 0 ? ' stars__option--zero' : ''
            }`}
          >
            <input
              className="stars__input"
              type="radio"
              name={name}
              value={stars}
              checked={checked}
              disabled={disabled}
              onChange={() => {
                onChange(stars);
              }}
            />
            <span className="stars__glyph" aria-hidden="true">
              {stars === 0 ? '0' : filled ? '★' : '☆'}
            </span>
            <span className="visually-hidden">{strings.rating.starLabel(stars)}</span>
          </label>
        );
      })}
    </div>
  );
}
