import type { CliIo } from './io.js';

/**
 * Exit codes, the same in every command:
 *
 *   0  the command did what it was asked to do
 *   1  it failed, or a check found something to report
 *   2  it was called wrongly — unknown command, missing or unknown option
 *
 * The distinction matters for scripting: a wrong call is a mistake in the
 * caller and worth aborting a script for, a failed run is a state on the
 * machine that may well be worth retrying.
 */
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export interface CommandContext {
  /** Arguments after the command name. */
  argv: string[];
  io: CliIo;
}

export interface CliCommand {
  name: string;
  /** One line for the overview in the main help. */
  summary: string;
  /** The full help of this command, shown by `--help` and `help <command>`. */
  usage: string;
  run(context: CommandContext): Promise<number>;
}

/**
 * Lays out rows as columns, so `user list` and `invite list` stay readable
 * without pulling in a table library. The last column is not padded.
 */
export function formatTable(rows: string[][]): string[] {
  if (rows.length === 0) return [];

  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }

  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join('  ')
      .trimEnd(),
  );
}

/** Local date and time, the form the lists use. */
export function formatMoment(value: Date | string | null): string {
  if (value === null) return '-';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const pad = (part: number): string => String(part).padStart(2, '0');
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Bytes in a form a human reads at a glance. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit] ?? 'B'}`;
}
