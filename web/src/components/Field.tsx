import { useId, type InputHTMLAttributes } from 'react';
import { strings } from '@/lib/strings';

/**
 * A labelled text input with its hint and its error message.
 *
 * Everything the browser and a screen reader need is wired up here once:
 * `label` points at the input, `aria-invalid` marks a rejected value, and
 * `aria-describedby` ties hint and error to the field so both are read out
 * instead of floating next to it.
 */

type FieldProps = {
  label: string;
  /** Shown greyed out next to the label. */
  optional?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export function Field({ label, optional = false, hint, error, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {optional && <span className="field__optional"> ({strings.common.optional})</span>}
      </label>

      <input
        {...input}
        id={id}
        className="field__input"
        aria-invalid={error === undefined ? undefined : true}
        {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
      />

      {hint !== undefined && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}

      {error !== undefined && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
