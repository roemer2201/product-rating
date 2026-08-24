import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** The same, against another configuration file — a second instance. */
async function runWith(configArgs: string[], argv: string[]): Promise<Recorded> {
  const out: string[] = [];
  const err: string[] = [];

  const io: CliIo = {
    out: (message = '') => out.push(message),
    err: (message = '') => err.push(message),
    ask: () => Promise.reject(new Error('no questions expected')),
    askSecret: () => Promise.reject(new Error('no password prompt expected')),
  };

  const code = await runCli([...argv, ...configArgs], io);
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

  it('sets and clears the display name', async () => {
    await run(['user', 'add', 'carla'], {
      secrets: ['correct horse battery', 'correct horse battery'],
    });

    // The name may contain spaces, quoted or not.
    const named = await run(['user', 'display-name', 'carla', 'Carla', 'aus', 'der', 'Küche']);
    expect(named.code).toBe(0);
    expect(named.out).toContain('shown as "Carla aus der Küche"');
    expect((await run(['user', 'list'])).out).toContain('Carla aus der Küche');

    const cleared = await run(['user', 'display-name', 'carla']);
    expect(cleared.code).toBe(0);
    expect(cleared.out).toContain('by its username again');
    expect((await run(['user', 'list'])).out).not.toContain('Carla aus der Küche');
  });

  it('refuses a display name the API would refuse as well', async () => {
    const result = await run(['user', 'display-name', 'anna', 'x'.repeat(41)]);

    expect(result.code).toBe(2);
    expect(result.err).toContain('display name');
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

describe('export and import', () => {
  it('writes both formats and reads its own file back', async () => {
    const target = join(directory, 'export');

    const exported = await run(['export', '--to', target, '--format', 'both']);
    expect(exported.code).toBe(0);
    expect(exported.out).toBe(target);
    expect(readFileSync(join(target, 'export.json'), 'utf8')).toContain('product-rating-export');
    expect(readFileSync(join(target, 'products.csv'), 'utf8')).toContain('ean,name,variant,brand');

    expect(readFileSync(join(target, 'users.csv'), 'utf8')).toContain(
      'username,display_name,role,email',
    );
    // Whatever else is in the export, a password hash is not.
    expect(readFileSync(join(target, 'export.json'), 'utf8')).not.toContain('$argon2id$');

    // The same instance reads it back: everything is already here, so nothing
    // is created and nothing is doubled.
    const imported = await run(['import', '--from', target]);
    expect(imported.code).toBe(0);
    expect(imported.out).toContain('accounts: 0 new');
    expect(imported.out).toContain('products: 0 new');
  });

  it('leaves the accounts out when --no-users says so', async () => {
    const target = join(directory, 'export-no-users');

    const exported = await run(['export', '--to', target, '--format', 'both', '--no-users']);
    expect(exported.code).toBe(0);
    expect(exported.err).toContain('0 account(s)');
    expect(existsSync(join(target, 'users.csv'))).toBe(false);
    expect(readFileSync(join(target, 'export.json'), 'utf8')).not.toContain('"users"');
  });

  it('brings accounts along without a password and says who needs a link', async () => {
    const source = join(directory, 'export-accounts');
    await run(['export', '--to', source]);

    // A second instance with its own database, but the same configuration.
    const other = join(directory, 'other.toml');
    writeFileSync(
      other,
      readFileSync(configFile, 'utf8').replace(
        join(directory, 'db', 'app.db'),
        join(directory, 'db2', 'app.db'),
      ),
    );

    const io = { config: ['--config', other] };
    expect((await runWith(io.config, ['migrate'])).code).toBe(0);

    const imported = await runWith(io.config, ['import', '--from', source]);
    expect(imported.code).toBe(0);
    expect(imported.out).toMatch(/accounts: [1-9]\d* new/);
    expect(imported.err).toContain('product-rating user reset-link');

    // The accounts arrived, and none of them can be logged into yet.
    const listed = await runWith(io.config, ['user', 'list']);
    expect(listed.out).toContain('needs password');

    // A link is what gets one of them back in.
    const link = await runWith(io.config, ['user', 'reset-link', 'anna']);
    expect(link.code).toBe(0);
    expect(link.out).toContain('/reset?token=');
  });

  it('rejects a format it does not know', async () => {
    const result = await run(['export', '--to', join(directory, 'nope'), '--format', 'xml']);

    expect(result.code).toBe(2);
    expect(result.err).toContain('--format');
  });

  it('says where an import file is missing instead of writing half of it', async () => {
    const result = await run(['import', '--from', join(directory, 'not-there')]);

    expect(result.code).toBe(1);
    expect(result.err).toContain('export.json');
  });
});

describe('proxy-config', () => {
  it('writes an nginx configuration filled in with this instance', async () => {
    const result = await run([
      'proxy-config',
      '--server',
      'nginx',
      '--base-url',
      'https://produkte.example.org',
      '--set',
      'server.trust_proxy=true',
    ]);

    expect(result.code).toBe(0);
    expect(result.out).toContain('server_name produkte.example.org;');
    expect(result.out).toContain('server 127.0.0.1:8080;');
    // Nothing to complain about: base_url matches and the proxy is trusted.
    expect(result.err).not.toContain('warning:');
  });

  it('takes the certificate paths and writes them into the file', async () => {
    const target = join(directory, 'proxy', 'apache.conf');
    const certificate = join(directory, 'cert.pem');
    const key = join(directory, 'cert.key');
    writeFileSync(certificate, 'not a certificate');
    writeFileSync(key, 'not a key');

    const result = await run([
      'proxy-config',
      '--server',
      'apache2',
      '--base-url',
      'https://produkte.example.org',
      '--set',
      'server.trust_proxy=true',
      '--cert',
      certificate,
      '--key',
      key,
      '--out',
      target,
    ]);

    expect(result.code).toBe(0);
    // The directory did not exist; the result goes to standard error, so the
    // file itself stays free of anything but configuration.
    expect(result.err).toContain(`wrote ${target}`);
    expect(result.out).toBe('');

    const written = readFileSync(target, 'utf8');
    expect(written).toContain(`SSLCertificateFile    ${certificate}`);
    expect(written).toContain(`SSLCertificateKeyFile ${key}`);
  });

  it('refuses to replace a file that is there, unless told to', async () => {
    const target = join(directory, 'proxy', 'caddy');
    writeFileSync(target, 'earlier work\n');

    const refused = await run(['proxy-config', '--server', 'caddy', '--out', target]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('exists already');
    expect(readFileSync(target, 'utf8')).toBe('earlier work\n');

    const forced = await run(['proxy-config', '--server', 'caddy', '--out', target, '--force']);
    expect(forced.code).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('reverse_proxy');
  });

  it('names the file itself when --out is a directory', async () => {
    const target = join(directory, 'proxy');

    const result = await run(['proxy-config', '--server', 'traefik', '--out', target]);

    expect(result.code).toBe(0);
    expect(existsSync(join(target, 'product-rating.yml'))).toBe(true);
  });

  it('warns about what the application still has to be told', async () => {
    const result = await run([
      'proxy-config',
      '--server',
      'nginx',
      '--domain',
      'anders.example.org',
      '--base-url',
      'https://produkte.example.org',
    ]);

    expect(result.code).toBe(0);
    // base_url points somewhere else, and the proxy is not trusted yet -
    // both let the interface load and then fail at the first save or hide
    // the client from the log.
    expect(result.err).toContain('--set server.base_url=https://anders.example.org');
    expect(result.err).toContain('server.trust_proxy is false');
  });

  it('accepts every spelling of Apache and names them all in the help', async () => {
    for (const name of ['apache', 'apache2', 'httpd']) {
      const result = await run([
        'proxy-config',
        '--server',
        name,
        '--base-url',
        'https://produkte.example.org',
      ]);

      expect(result.code).toBe(0);
      expect(result.out).toContain('ServerName produkte.example.org');
    }

    const help = await run(['proxy-config', '--help']);
    expect(help.code).toBe(0);
    expect(help.out).toContain('nginx | apache | apache2 | httpd | caddy | traefik');
  });

  it('rejects a web server it does not know and a half given certificate', async () => {
    const unknown = await run(['proxy-config', '--server', 'lighttpd']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('unknown web server: lighttpd');
    expect(unknown.err).toContain('Usage: product-rating proxy-config');

    const half = await run(['proxy-config', '--server', 'nginx', '--cert', '/etc/ssl/x.pem']);
    expect(half.code).toBe(2);
    expect(half.err).toContain('--cert and --key go together');

    const missing = await run(['proxy-config']);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('--server is required');
  });
});
