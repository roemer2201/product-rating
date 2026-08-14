import type { ZodError } from 'zod';

/**
 * Raised for every configuration problem that has to stop the process:
 * unreadable or invalid files, unknown keys, failed start-up checks.
 *
 * `details` carries one line per individual problem so the process can print a
 * list instead of a single dense message.
 */
export class ConfigError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ConfigError';
    this.details = details;
  }

  /** Human readable multi-line rendering, used when aborting the start-up. */
  format(): string {
    return this.details.length > 0
      ? [this.message, ...this.details.map((line) => `  - ${line}`)].join('\n')
      : this.message;
  }
}

/** Turns a zod error into `section.key: message` lines. */
export function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}
