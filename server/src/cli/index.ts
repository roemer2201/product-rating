import { ConfigError, CONFIG_PATH_ENV_VAR } from '../config/index.js';
import { APP_NAME, APP_VERSION } from '../version.js';
import { backupCommand } from './backup.js';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, type CliCommand } from './command.js';
import { fsckCommand } from './fsck.js';
import { consoleIo, type CliIo } from './io.js';
import { inviteCommand } from './invites.js';
import { migrateCommand } from './migrate.js';
import { UsageError } from './options.js';
import { restoreCommand } from './restore.js';
import { serveCommand } from './serve.js';
import { exportCommand, importCommand } from './transfer.js';
import { userCommand } from './users.js';

/**
 * `product-rating <command>` — one entry point for the server and everything
 * around it.
 *
 * The commands share the configuration handling of the server, so `--config`,
 * `--set` and the convenience flags mean the same thing everywhere and a
 * second instance is a matter of `--config`. Everything a command prints as
 * its result goes to standard output; progress, warnings and errors go to
 * standard error, so the output stays usable in a pipe.
 */

export const COMMANDS: readonly CliCommand[] = [
  serveCommand,
  migrateCommand,
  userCommand,
  inviteCommand,
  backupCommand,
  restoreCommand,
  exportCommand,
  importCommand,
  fsckCommand,
];

/** The help shown without a command, and by `product-rating help`. */
export function mainUsage(): string {
  const commands = COMMANDS.map((command) => `  ${command.name.padEnd(18)}${command.summary}`).join(
    '\n',
  );

  return `Usage: ${APP_NAME} <command> [OPTIONS]

Commands:
${commands}
  help [COMMAND]    Show this help, or the help of one command
  version           Show the version and exit

Configuration options, accepted by every command:
      --config FILE       Configuration file to read instead of the search
                          path (--config, ${CONFIG_PATH_ENV_VAR},
                          /etc/${APP_NAME}/config.toml, ./config/config.toml).
      --set SECTION.KEY=VALUE
                          Override a single value, for example
                          --set paths.database=/srv/app.db. Repeatable.
      --host HOST         Same as --set server.host
      --port PORT         Same as --set server.port
      --base-url URL      Same as --set server.base_url
      --database FILE     Same as --set paths.database
      --uploads DIR       Same as --set paths.uploads
      --temp DIR          Same as --set paths.temp
      --log-level LEVEL   error | warn | info | debug
      --log-format FORMAT json | pretty
      --log-destination TARGET
                          stdout | file | syslog

Values are taken in this order, later ones winning: built-in defaults, the
configuration file, PR_<SECTION>__<KEY> environment variables, these options.

Note: "fsck --uploads" asks for the upload check, not for the path. Point a
command at another instance with --config or --set paths.uploads=DIR.

Exit codes:
  0  the command did what it was asked to do
  1  it failed, or a check found something to report
  2  it was called wrongly

Run "${APP_NAME} help COMMAND" for the options of a single command.`;
}

/** Prints the failure of a command in the form its type deserves. */
function reportError(io: CliIo, command: CliCommand | null, error: unknown): number {
  if (error instanceof UsageError) {
    io.err(`error: ${error.message}`);
    io.err('');
    io.err(command?.usage ?? mainUsage());
    return EXIT_USAGE;
  }

  if (error instanceof ConfigError) {
    io.err(error.format());
    return EXIT_FAILURE;
  }

  io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
  return EXIT_FAILURE;
}

/**
 * Runs one invocation and answers with the exit code, without ending the
 * process itself — that is the entry point's job, and it keeps the whole
 * dispatcher testable.
 */
export async function runCli(argv: string[], io: CliIo = consoleIo): Promise<number> {
  const [name, ...rest] = argv;

  if (name === undefined) {
    io.err(mainUsage());
    return EXIT_USAGE;
  }

  if (name === 'help' || name === '--help' || name === '-h') {
    const wanted = COMMANDS.find((command) => command.name === rest[0]);
    io.out(wanted?.usage ?? mainUsage());
    return EXIT_OK;
  }

  if (name === 'version' || name === '--version' || name === '-V') {
    io.out(`${APP_NAME} ${APP_VERSION}`);
    return EXIT_OK;
  }

  const command = COMMANDS.find((entry) => entry.name === name);
  if (command === undefined) {
    io.err(`error: unknown command: ${name}`);
    io.err('');
    io.err(mainUsage());
    return EXIT_USAGE;
  }

  try {
    return await command.run({ argv: rest, io });
  } catch (error) {
    return reportError(io, command, error);
  }
}

export { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './command.js';
export type { CliCommand, CommandContext } from './command.js';
export { consoleIo, type CliIo } from './io.js';
