import type { AppearancePalette } from '@product-rating/shared';

/**
 * One choice out of a few, shown all at once.
 *
 * Real radio buttons in a `fieldset`: the browser brings the arrow keys, the
 * grouping and the announcement "2 of 3" with it, and the radio itself shows
 * which option is in force - so the selection never rests on a colour alone.
 * The whole cell is the label and therefore the tap target.
 */

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** A second line that says what the option does. */
  hint?: string;
  /** Draws a dot in the accent of this palette next to the label. */
  swatch?: AppearancePalette;
}

interface ChoiceGroupProps<T extends string> {
  legend: string;
  /** Shared by the radios of the group; has to be unique on the screen. */
  name: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  /** `wide` for longer labels, `stacked` for options with a hint. */
  variant?: 'wide' | 'stacked';
}

export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  variant,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className={variant === undefined ? 'choice' : `choice choice--${variant}`}>
      <legend className="choice__legend">{legend}</legend>

      <div className="choice__options">
        {options.map((option) => (
          <label className="choice__option" key={option.value}>
            <input
              className="choice__input"
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
            />
            {option.swatch !== undefined && (
              // The attribute makes the palette rules of `theme.css` apply to
              // this one element, whatever palette the screen itself is in.
              <span className="choice__swatch" data-palette={option.swatch} aria-hidden="true" />
            )}
            <span className="choice__text">
              <span className="choice__label">{option.label}</span>
              {option.hint !== undefined && <span className="choice__hint">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
