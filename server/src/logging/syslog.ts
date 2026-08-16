import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Writable } from 'node:stream';

/**
 * Log destination `syslog`.
 *
 * Node has no way of writing to `/dev/log` on its own: the socket is a Unix
 * datagram socket, and `node:dgram` only speaks UDP. Rather than adding a
 * native module for one log destination, the lines are handed to `logger`
 * from util-linux, which is on every Debian system and is what the shell
 * scripts of this project use as well. `--prio-prefix` lets every single line
 * carry its own priority, so a warning stays a warning in the journal instead
 * of everything arriving as `notice`.
 */

/** The program that forwards the lines; util-linux on Debian. */
export const SYSLOG_COMMAND = 'logger';

/** Facility of the messages. A background service is `daemon` (3). */
export const SYSLOG_FACILITY_DAEMON = 3;

/** Syslog severities, in the order RFC 5424 numbers them. */
const SEVERITY_CRIT = 2;
const SEVERITY_ERR = 3;
const SEVERITY_WARNING = 4;
const SEVERITY_INFO = 6;
const SEVERITY_DEBUG = 7;

/**
 * Maps a pino level to a syslog severity. pino counts 10 (trace) to 60
 * (fatal); everything below `info` is debugging detail to syslog.
 */
export function syslogSeverity(level: number): number {
  if (level >= 60) return SEVERITY_CRIT;
  if (level >= 50) return SEVERITY_ERR;
  if (level >= 40) return SEVERITY_WARNING;
  if (level >= 30) return SEVERITY_INFO;
  return SEVERITY_DEBUG;
}

/** `<PRI>` value of a line: facility times eight plus severity. */
export function syslogPriority(level: number, facility = SYSLOG_FACILITY_DAEMON): number {
  return facility * 8 + syslogSeverity(level);
}

/**
 * Reads the level out of a serialized log line.
 *
 * The stream sees what the formatter produced, not the log object, so the
 * level has to be recovered from the text. JSON lines carry it verbatim; a
 * pretty printed line does not, and lands on `info` — the level filtering has
 * already happened at that point, so the only thing at stake is the severity
 * syslog files the line under.
 */
export function levelOfLine(line: string): number {
  const match = /"level"\s*:\s*(\d+)/.exec(line);
  if (match === null) return 30;

  const level = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(level) ? level : 30;
}

/**
 * Tries to file a single line and reports what stood in the way, or `null`
 * when it worked.
 *
 * Checking that the program exists is not enough: in a container there is
 * usually no syslog socket to talk to, and `logger` fails at exactly that
 * point. Writing one line at debug level answers both questions at once, and
 * it answers them during the start-up check rather than at the first log line
 * of a service that is already running.
 */
export function syslogProblem(tag: string, command = SYSLOG_COMMAND): string | null {
  const result = spawnSync(command, ['--prio-prefix', '--tag', tag], {
    input: `<${String(syslogPriority(20))}>logging check\n`,
    encoding: 'utf8',
  });

  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' ? `${command} was not found` : result.error.message;
  }

  if (result.status !== 0) {
    const reason = (result.stderr ?? '').trim();
    return reason.length > 0 ? reason : `${command} exited with ${String(result.status)}`;
  }

  return null;
}

export interface SyslogStreamOptions {
  /** Tag every line is filed under; the process name by convention. */
  tag: string;
  facility?: number;
  /** Overrides the program to run; used by the tests. */
  command?: string;
}

/**
 * A writable stream that forwards every log line to syslog.
 *
 * One long-lived `logger` process handles all of them — spawning one per line
 * would cost more than the logging itself. If that process ever dies, the
 * lines fall back to stderr instead of disappearing: a service that stops
 * logging because its log helper crashed is worse than one that logs to the
 * wrong place.
 */
export function createSyslogStream(options: SyslogStreamOptions): Writable {
  const facility = options.facility ?? SYSLOG_FACILITY_DAEMON;
  const command = options.command ?? SYSLOG_COMMAND;

  let child: ChildProcess | null = spawn(command, ['--prio-prefix', '--tag', options.tag], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  let reported = false;

  /** Switches to stderr once, with a line saying why. */
  const degrade = (why: string): void => {
    child = null;
    if (reported) return;
    reported = true;
    process.stderr.write(`syslog logging stopped working (${why}); falling back to stderr\n`);
  };

  child.on('error', (error: Error) => {
    degrade(error.message);
  });
  // A pipe into a process that has just died raises EPIPE on the socket
  // rather than on the write, and an unhandled one of those would take the
  // whole server with it. Logging is not worth a crash.
  child.stdin?.on('error', (error: Error) => {
    degrade(error.message);
  });
  child.on('exit', (code, signal) => {
    degrade(signal === null ? `logger exited with ${String(code)}` : `logger got ${signal}`);
  });
  // The log helper must not keep the process alive on its own.
  child.unref();

  return new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      for (const line of text.split('\n')) {
        if (line.trim().length === 0) continue;

        const priority = syslogPriority(levelOfLine(line), facility);
        const message = `<${String(priority)}>${line}\n`;

        // `writable` can still be true for a process that is already gone,
        // so the write itself has to be guarded as well.
        let written = false;
        if (child?.stdin?.writable === true) {
          try {
            child.stdin.write(message);
            written = true;
          } catch (error) {
            degrade(error instanceof Error ? error.message : String(error));
          }
        }
        if (!written) process.stderr.write(message);
      }

      callback();
    },
    final(callback): void {
      child?.stdin?.end();
      callback();
    },
  });
}
