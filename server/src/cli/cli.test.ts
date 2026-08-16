import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './index.js';
import type { CliIo } from './io.js';

/**
 * The command line interface end to end: every command runs against a real
 * configuration file and a real database in a temporary directory, the way an
 * administrator would run it. Only the terminal is replaced — the answers to
 * password prompts come from the test instead of from a keyboard.
 */

interface Recorded {
  code: number;
  out: string;
  err: string;
}

let directory: string;
let configFile: string;

/** Runs one invocation with prepared answers for the interactive prompts. */
async function run(
  argv: string[],
  answers: { secrets?: string[]; lines?: string[] } = {},
): Promise<Recorded> {
  const out: string[] = [];
  const err: string[] = [];
  const secrets = [...(answers.secrets ?? [])];
  const lines = [...(answers.lines ?? [])];

  const io: CliIo = {
    out: (message = '') => out.push(message),
    err: (message = '') => err.push(message),
    ask: (question) => {
      const answer = lines.shift();
      if (answer === undefined) throw new Error(`unexpected question: ${question}`);
      return Promise.resolve(answer);
    },
    askSecret: (question) => {
      const answer = secrets.shift();
      if (answer === undefined) throw new Error(`unexpected password prompt: ${question}`);
      return Promise.resolve(answer);
    },
  };

  const code = await runCli([...argv, '--config', configFile], io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'product-rating-cli-'));
  configFile = join(directory, 'config.toml');

  writeFileSync(
    configFile,
    [
      '[paths]',
      `database = "${join(directory, 'db', 'app.db')}"`,
      `uploads = "${join(directory, 'uploads')}"`,
      `temp = "${join(directory, 'tmp')}"`,
      '',
      '[auth]',
      // The production parameters cost about a tenth of a second per hash,
      // which a test suite with several accounts notices.
      'argon2_memory_mib = 8',
      'argon2_time_cost = 1',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the dispatcher', () => {
  it('shows the general help and the help of a single command', async () => {
    const general = await run(['help']);
    expect(general.code).toBe(0);
    expect(general.out).toContain('Usage: product-rating <command>');
    expect(general.out).toContain('backup');

    const single = await run(['help', 'backup']);
    expect(single.out).toContain('Usage: product-rating backup --to DIR');
  });

  it('reports the version', async () => {
    const result = await run(['version']);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^product-rating \d+\.\d+\.\d+$/);
  });

  it('answers an unknown command with exit code 2 and the help', async () => {
    const result = await run(['nonsense']);

    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown command: nonsense');
    expect(result.err).toContain('Usage: product-rating <command>');
  });

  it('answers a wrong option with the help of that command', async () => {
    const result = await run(['fsck']);

    expect(result.code).toBe(2);
    expect(result.err).toContain('nothing to check; pass --uploads');
    expect(result.err).toContain('Usage: product-rating fsck');
  });

  it('refuses to work on a schema that is behind', async () => {
    const result = await run(['user', 'list']);

    expect(result.code).toBe(1);
    expect(result.err).toContain('product-rating migrate');
  });
});

describe('migrate', () => {
  it('applies the migrations and is idempotent', async () => {
    const first = await run(['migrate']);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/applied \d+ migration\(s\)/);

    const second = await run(['migrate']);
    expect(second.code).toBe(0);
    expect(second.out).toBe('nothing to do');
  });
});

describe('user', () => {
  it('creates an account and lists it', async () => {
    const created = await run(['user', 'add', 'anna', '--role', 'admin'], {
      secrets: ['correct horse battery', 'correct horse battery'],
    });

    expect(created.code).toBe(0);
    expect(created.out).toContain('created anna (admin)');

    const listed = await run(['user', 'list']);
    expect(listed.out).toContain('anna');
    expect(listed.out).toContain('admin');
    expect(listed.out).toContain('active');
  });

  it('rejects a password that was typed differently twice', async () => {
    const result = await run(['user', 'add', 'tom'], {
      secrets: ['correct horse battery', 'correct horse batteries'],
    });

    expect(result.code).toBe(1);
    expect(result.err).toContain('do not match');
  });

  it('rejects a password below the configured length', async () => {
    const result = await run(['user', 'add', 'tom'], { secrets: ['short', 'short'] });

    expect(result.code).toBe(1);
    expect(result.err).toContain('at least 10 characters');
  });

  it('refuses a username that exists', async () => {
    const result = await run(['user', 'add', 'anna'], {
      secrets: ['another password here', 'another password here'],
    });

    expect(result.code).toBe(1);
    expect(result.err).toContain('already taken');
  });

  it('disables and enables an account', async () => {
    await run(['user', 'add', 'tom'], {
      secrets: ['correct horse battery', 'correct horse battery'],
    });

    const disabled = await run(['user', 'disable', 'tom']);
    expect(disabled.code).toBe(0);
    expect(disabled.out).toContain('disabled tom');
    expect((await run(['user', 'list'])).out).toContain('disabled');

    const enabled = await run(['user', 'enable', 'tom']);
    expect(enabled.code).toBe(0);
    expect(enabled.out).toContain('enabled tom');
  });

  it('changes a password and names the account it does not know', async () => {
    const changed = await run(['user', 'passwd', 'tom'], {
      secrets: ['a completely new one', 'a completely new one'],
    });
    expect(changed.code).toBe(0);
    expect(changed.out).toContain('password of tom changed');

    const unknown = await run(['user', 'passwd', 'nobody'], { secrets: [] });
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('no account named "nobody"');
  });

  it('reports an unknown subcommand as wrong usage', async () => {
    const result = await run(['user', 'delete', 'anna']);

    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown subcommand: user delete');
  });
});

describe('invite', () => {
  let code = '';

  it('hands out a code attributed to the administrator', async () => {
    const created = await run(['invite', 'create', '--note', 'for Tom', '--ttl', '3']);

    expect(created.code).toBe(0);
    expect(created.out).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(created.err).toContain('created by anna');
    code = created.out;
  });

  it('lists the codes with their state', async () => {
    const listed = await run(['invite', 'list']);

    expect(listed.out).toContain(code);
    expect(listed.out).toContain('open');
    expect(listed.out).toContain('for Tom');
  });

  it('revokes a code and reports an unknown one', async () => {
    const revoked = await run(['invite', 'revoke', code]);
    expect(revoked.code).toBe(0);
    expect((await run(['invite', 'list'])).out).not.toContain(code);

    const unknown = await run(['invite', 'revoke', 'AAAA-BBBB-CCCC']);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('not found');
  });
});

describe('backup, restore and fsck', () => {
  it('finds nothing to complain about in a fresh instance', async () => {
    const result = await run(['fsck', '--uploads']);

    expect(result.code).toBe(0);
    expect(result.out).toContain('no problems found');
  });

  it('writes a snapshot and puts it back', async () => {
    const target = join(directory, 'backups');

    const backup = await run(['backup', '--to', target]);
    expect(backup.code).toBe(0);
    const snapshot = backup.out;
    expect(snapshot.startsWith(target)).toBe(true);
    expect(readFileSync(join(snapshot, 'app.db')).length).toBeGreaterThan(0);

    // A change that the restore has to undo.
    await run(['user', 'add', 'later', '--role', 'user'], {
      secrets: ['yet another password', 'yet another password'],
    });
    expect((await run(['user', 'list'])).out).toContain('later');

    const restored = await run(['restore', '--from', snapshot], { lines: ['restore'] });
    expect(restored.code).toBe(0);
    expect((await run(['user', 'list'])).out).not.toContain('later');
  });

  it('changes nothing when the confirmation is not typed', async () => {
    // A separate target: two snapshots within the same second would land on
    // the same name, and the second one is refused rather than overwriting.
    const target = join(directory, 'backups-second');
    const snapshot = (await run(['backup', '--to', target])).out;

    await run(['user', 'add', 'kept', '--role', 'user'], {
      secrets: ['still another one', 'still another one'],
    });

    const result = await run(['restore', '--from', snapshot], { lines: ['no'] });
    expect(result.code).toBe(0);
    expect(result.err).toContain('nothing was changed');
    expect((await run(['user', 'list'])).out).toContain('kept');
  });

  it('refuses a directory that is not a snapshot', async () => {
    const result = await run(['restore', '--from', directory, '--yes']);

    expect(result.code).toBe(1);
    expect(result.err).toContain('app.db');
  });
});
