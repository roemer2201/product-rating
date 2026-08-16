import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

/**
 * Everything the commands write or read interactively goes through this
 * interface, so the tests can drive them without a terminal and without
 * anything reaching the real standard output.
 */
export interface CliIo {
  /** One line to standard output; the result of the command. */
  out(message?: string): void;
  /** One line to standard error; progress, warnings and failures. */
  err(message?: string): void;
  /** Asks a question and returns the answer, echoed as it is typed. */
  ask(question: string): Promise<string>;
  /** Asks for a password; nothing of it appears on screen. */
  askSecret(question: string): Promise<string>;
}

/** Reads a single line from standard input, for pipes and here-documents. */
export async function readStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
    // One line is all that is wanted; a file with more is read to its end
    // anyway, which is cheap for the sizes this is used with.
    if (Buffer.concat(chunks).includes('\n')) break;
  }

  return Buffer.concat(chunks).toString('utf8').split('\n')[0]?.replace(/\r$/, '') ?? '';
}

async function ask(question: string): Promise<string> {
  if (process.stdin.isTTY !== true) return readStdinLine();

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Asks for a password without echoing it.
 *
 * The prompt is written directly and the readline interface gets a sink as its
 * output, so the keystrokes are not printed anywhere — not on screen and not
 * into a terminal's scrollback, where a password has no business being.
 */
async function askSecret(question: string): Promise<string> {
  if (process.stdin.isTTY !== true) {
    throw new Error(
      'no terminal available to ask for a password; use --password-stdin and pipe it in',
    );
  }

  process.stderr.write(question);
  const sink = new Writable({
    write(_chunk, _encoding, callback): void {
      callback();
    },
  });

  const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
  try {
    return await rl.question('');
  } finally {
    rl.close();
    process.stderr.write('\n');
  }
}

/** The implementation the real command line uses. */
export const consoleIo: CliIo = {
  out(message = ''): void {
    process.stdout.write(`${message}\n`);
  },
  err(message = ''): void {
    process.stderr.write(`${message}\n`);
  },
  ask,
  askSecret,
};
