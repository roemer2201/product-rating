import pino, { type DestinationStream, type Logger } from 'pino';
import pretty from 'pino-pretty';
import { ConfigError, type AppConfig } from '../config/index.js';
import { APP_NAME } from '../version.js';
import { createSyslogStream, syslogProblem, SYSLOG_COMMAND } from './syslog.js';

/**
 * Structured logging for the server.
 *
 * `log.level`, `log.format` and `log.destination` are put together here and
 * nowhere else, so a command line tool and the server produce the same lines.
 * The format decides how a line looks — JSON for machines, a readable line for
 * a terminal — the destination decides where it goes.
 */

export interface AppLogger {
  logger: Logger;
  /** Flushes what is still buffered; called before the process exits. */
  close(): Promise<void>;
}

/**
 * Checks upfront what the configured destination needs.
 *
 * Called during start-up next to the other configuration checks: a log that
 * goes nowhere has to be a clear message at the start, not something that is
 * noticed when an incident needs the lines that were never written.
 */
export function assertLoggingUsable(config: AppConfig): void {
  if (config.log.destination !== 'syslog') return;

  const problem = syslogProblem(APP_NAME);
  if (problem === null) return;

  throw new ConfigError(`log.destination = "syslog" does not work here: ${problem}`, [
    `the ${SYSLOG_COMMAND} command comes with util-linux: apt install util-linux`,
    'a container usually has no syslog socket; there log.destination = "stdout" is the way,',
    'which is where the container runtime and systemd pick the log up anyway',
  ]);
}

/**
 * A log target this module can write to and close again. Both of pino's own
 * destinations and the syslog stream fit it; only `end()` is used, and only
 * when the process shuts down.
 */
type LogStream = DestinationStream & { end(): void };

/** Opens the stream the lines are written to, before any formatting. */
function openDestination(config: AppConfig): LogStream {
  switch (config.log.destination) {
    case 'file':
      // The directory is created and checked by `ensureRuntimeDirectories()`;
      // `mkdir` here only covers a path that changes while running.
      return pino.destination({ dest: config.log.file, mkdir: true, sync: false });
    case 'syslog':
      return createSyslogStream({ tag: APP_NAME });
    case 'stdout':
    default:
      return pino.destination({ fd: 1, sync: false });
  }
}

/**
 * Builds the logger the server hands to Fastify.
 *
 * Pretty printing runs in this process rather than in a worker thread: one
 * household sized instance writes a handful of lines a second, and a worker
 * would have to be shut down cleanly before the process may exit — a lot of
 * machinery for no gain here.
 */
export function createLogger(config: AppConfig): AppLogger {
  const destination = openDestination(config);

  const stream =
    config.log.format === 'pretty'
      ? pretty({
          destination,
          // Colours belong in a terminal, not in a log file or the journal.
          colorize: config.log.destination === 'stdout' && process.stdout.isTTY === true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: false,
        })
      : destination;

  const logger = pino({ level: config.log.level, name: APP_NAME }, stream);

  return {
    logger,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        // `flush(cb)` empties the buffer of an asynchronous destination; the
        // callback fires even when there is nothing left, so this always ends.
        logger.flush(() => {
          resolve();
        });
      });
      stream.end();
    },
  };
}

export {
  createSyslogStream,
  syslogProblem,
  levelOfLine,
  syslogPriority,
  syslogSeverity,
  SYSLOG_COMMAND,
  SYSLOG_FACILITY_DAEMON,
} from './syslog.js';
