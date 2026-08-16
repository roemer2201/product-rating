import { CONFIG_FLAGS } from '../config/index.js';

/**
 * Option parsing for the subcommands.
 *
 * Every command takes its own options out of the argument list and leaves the
 * configuration flags (`--config`, `--set`, `--port`, …) untouched, so they
 * can be handed to `loadConfig()` afterwards. A flag nobody knows is an error
 * rather than something silently ignored — a typo in `--repair` must not turn
 * a check into a run that repairs nothing.
 */

/** Wrong usage: reported with the command's help and exit code 2. */
export class UsageError extends Error {}

export type OptionType = 'string' | 'boolean';

/** Long option names without the leading dashes, mapped to their type. */
export type OptionSpec = Record<string, OptionType>;

export interface ParsedArguments {
  /** Values of the declared options; absent ones are missing entirely. */
  options: Record<string, string | boolean>;
  /** Everything that is not an option, in order. */
  positionals: string[];
  /** Configuration flags, ready for `loadConfig({ argv })`. */
  configArgs: string[];
}

/** Short forms understood everywhere. */
const ALIASES: Record<string, string> = { '-h': '--help' };

/** Reads `--flag=value` or the argument that follows the flag. */
function readValue(argv: string[], index: number, flag: string): { value: string; next: number } {
  const current = argv[index] ?? '';
  const assignment = current.indexOf('=');
  if (assignment >= 0) return { value: current.slice(assignment + 1), next: index + 1 };

  const value = argv[index + 1];
  if (value === undefined) throw new UsageError(`missing value for ${flag}`);

  return { value, next: index + 2 };
}

/**
 * Splits `argv` into the command's own options, its positional arguments and
 * the configuration flags. `--` ends option parsing, so a value that starts
 * with a dash can still be passed as a positional argument.
 */
export function parseArguments(argv: string[], spec: OptionSpec): ParsedArguments {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  const configArgs: string[] = [];

  let index = 0;
  while (index < argv.length) {
    const argument = argv[index] ?? '';

    if (argument === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!argument.startsWith('-') || argument === '-') {
      positionals.push(argument);
      index += 1;
      continue;
    }

    const raw = argument.split('=', 1)[0] ?? argument;
    const flag = ALIASES[raw] ?? raw;
    const name = flag.replace(/^--/, '');

    // The command's own options win over a configuration flag of the same
    // name: `fsck --uploads` asks for a check, not for a path.
    const declared = Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (declared === 'boolean') {
      if (argument.includes('=')) throw new UsageError(`${flag} takes no value`);
      options[name] = true;
      index += 1;
      continue;
    }
    if (declared === 'string') {
      const { value, next } = readValue(argv, index, flag);
      options[name] = value;
      index = next;
      continue;
    }

    if (CONFIG_FLAGS.includes(flag)) {
      const { value, next } = readValue(argv, index, flag);
      configArgs.push(flag, value);
      index = next;
      continue;
    }

    throw new UsageError(`unknown option: ${argument}`);
  }

  return { options, positionals, configArgs };
}

/** Reads a whole number option, with the range the command expects. */
export function numberOption(
  options: Record<string, string | boolean>,
  name: string,
  fallback: number,
  minimum = 0,
): number {
  const raw = options[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new UsageError(`--${name} needs a whole number of at least ${String(minimum)}`);
  }

  return value;
}

/** Reads a string option, or `undefined` when it was not given. */
export function stringOption(
  options: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === 'string' ? value : undefined;
}

/** Reads a string option that the command cannot work without. */
export function requiredOption(options: Record<string, string | boolean>, name: string): string {
  const value = stringOption(options, name);
  if (value === undefined || value.trim().length === 0) {
    throw new UsageError(`--${name} is required`);
  }

  return value;
}
