import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { strings } from '@/lib/strings';

/**
 * Labelled form controls with their hint and their error message.
 *
 * Everything the browser and a screen reader need is wired up once here:
 * `label` points at the control, `aria-invalid` marks a rejected value, and
 * `aria-describedby` ties hint and error to the field so both are read out
 * instead of floating next to it. The three variants differ only in the control
 * in the middle, which is why they share `FieldShell`.
 */

interface ShellProps {
  label: string;
  /** Shown greyed out next to the label. */
  optional?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  /** Receives the ids it has to carry; the shell owns them. */
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

function FieldShell({ label, optional = false, hint, error, children }: ShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((entry): entry is string => entry !== null)
      .join(' ') || undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {optional && <span className="field__optional"> ({strings.common.optional})</span>}
      </label>

      {children({ id, describedBy })}

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

type FieldProps = {
  label: string;
  optional?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export function Field({ label, optional = false, hint, error, ...input }: FieldProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <input
          {...input}
          id={id}
          className="field__input"
          aria-invalid={error === undefined ? undefined : true}
          {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        />
      )}
    </FieldShell>
  );
}

type TextAreaFieldProps = {
  label: string;
  optional?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

export function TextAreaField({
  label,
  optional = false,
  hint,
  error,
  rows = 4,
  ...textarea
}: TextAreaFieldProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <textarea
          {...textarea}
          id={id}
          rows={rows}
          className="field__input field__input--multiline"
          aria-invalid={error === undefined ? undefined : true}
          {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        />
      )}
    </FieldShell>
  );
}

type SelectFieldProps = {
  label: string;
  optional?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'>;

export function SelectField({
  label,
  optional = false,
  hint,
  error,
  children,
  ...select
}: SelectFieldProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <select
          {...select}
          id={id}
          className="field__input field__input--select"
          aria-invalid={error === undefined ? undefined : true}
          {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}
