import { strings } from '@/lib/strings';

/**
 * The little that form handling needs beyond the shared zod schemas.
 *
 * Screens validate with the very schemas the server validates with, which
 * leaves one job: turning the issues of a failed parse into one German sentence
 * per field. The zod messages themselves are English and written for a
 * developer, so they are dropped in favour of the texts in `strings.ts` — the
 * field name is the only part of an issue that is used.
 *
 * The issue type is described structurally instead of importing zod, so the web
 * workspace keeps its dependency on the schemas alone.
 */

interface IssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** One message per field, keyed by field name. */
export type FieldErrors = Record<string, string>;

const VALIDATION_TEXTS: Readonly<Record<string, string>> = strings.validation;

/**
 * Collects the first issue per field. Further issues on the same field would
 * only repeat the same advice — a username can be too short *and* carry a
 * forbidden character, and the text names both rules anyway.
 */
export function fieldErrors(issues: readonly IssueLike[]): FieldErrors {
  const errors: FieldErrors = {};

  for (const issue of issues) {
    const [first] = issue.path;
    const field = typeof first === 'string' ? first : '';
    if (field === '' || errors[field] !== undefined) continue;

    errors[field] = VALIDATION_TEXTS[field] ?? strings.validation.fallback;
  }

  return errors;
}

/**
 * The field an error response blames, if it names one. Lets a form put the
 * server's verdict next to the input it belongs to rather than above the form.
 */
export function errorField(details: Record<string, unknown> | undefined): string | undefined {
  return typeof details?.field === 'string' ? details.field : undefined;
}

/** An empty text input means "not set", not an empty string. */
export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
