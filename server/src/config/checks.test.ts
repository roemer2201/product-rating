import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureRuntimeDirectories, MIN_SECRET_LENGTH, readSessionSecret } from './checks.js';
import { ConfigError } from './errors.js';
import { parseConfig } from './load.js';
import type { RawConfig } from './values.js';

const SECRET = 'a'.repeat(MIN_SECRET_LENGTH);

describe('start-up checks', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'product-rating-checks-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function config(overrides: RawConfig = {}) {
    return parseConfig(
      {
        ...overrides,
        paths: {
          database: join(root, 'db/app.db'),
          uploads: join(root, 'uploads'),
          temp: join(root, 'tmp'),
          ...overrides.paths,
        },
        auth: { secret_file: join(root, 'secret.env'), ...overrides.auth },
      },
      root,
    );
  }

  describe('runtime directories', () => {
    it('creates missing directories', () => {
      ensureRuntimeDirectories(config());

      expect(existsSync(join(root, 'db'))).toBe(true);
      expect(existsSync(join(root, 'uploads'))).toBe(true);
      expect(existsSync(join(root, 'tmp'))).toBe(true);
    });

    it('creates the log directory only when logging to a file', () => {
      ensureRuntimeDirectories(config({ log: { file: join(root, 'log/app.log') } }));
      expect(existsSync(join(root, 'log'))).toBe(false);

      ensureRuntimeDirectories(
        config({ log: { destination: 'file', file: join(root, 'log/app.log') } }),
      );
      expect(existsSync(join(root, 'log'))).toBe(true);
    });

    it('reports a path that is occupied by a file', () => {
      writeFileSync(join(root, 'uploads'), 'not a directory', 'utf8');

      try {
        ensureRuntimeDirectories(config());
        expect.unreachable('expected a ConfigError');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).details.join('\n')).toContain('is not a directory');
      }
    });

    it('reports a database path that is a directory', () => {
      mkdirSync(join(root, 'db'));
      const configuration = config({ paths: { database: join(root, 'db') } });

      try {
        ensureRuntimeDirectories(configuration);
        expect.unreachable('expected a ConfigError');
      } catch (error) {
        expect((error as ConfigError).details.join('\n')).toContain('is not a file');
      }
    });

    it('accepts a frontend directory with the app shell in it', () => {
      mkdirSync(join(root, 'web'));
      writeFileSync(join(root, 'web/index.html'), '<!doctype html>', 'utf8');

      expect(() =>
        ensureRuntimeDirectories(config({ server: { static_dir: join(root, 'web') } })),
      ).not.toThrow();
    });

    it('reports a frontend directory that does not exist', () => {
      try {
        ensureRuntimeDirectories(config({ server: { static_dir: join(root, 'web') } }));
        expect.unreachable('expected a ConfigError');
      } catch (error) {
        expect((error as ConfigError).details.join('\n')).toContain('server.static_dir');
      }
    });

    it('reports a frontend directory without the app shell', () => {
      mkdirSync(join(root, 'web'));

      try {
        ensureRuntimeDirectories(config({ server: { static_dir: join(root, 'web') } }));
        expect.unreachable('expected a ConfigError');
      } catch (error) {
        expect((error as ConfigError).details.join('\n')).toContain('index.html');
      }
    });
  });

  describe('session secret', () => {
    function writeSecret(content: string, mode = 0o600): void {
      const path = join(root, 'secret.env');
      writeFileSync(path, content, { encoding: 'utf8', mode });
      chmodSync(path, mode);
    }

    it('reads a plain secret file', () => {
      writeSecret(`${SECRET}\n`);

      expect(readSessionSecret(config())).toBe(SECRET);
    });

    it('reads an env style secret file', () => {
      writeSecret(`# generated on install\nPRODUCT_RATING_SECRET="${SECRET}"\n`);

      expect(readSessionSecret(config())).toBe(SECRET);
    });

    it('fails when the file is missing', () => {
      try {
        readSessionSecret(config());
        expect.unreachable('expected a ConfigError');
      } catch (error) {
        expect((error as ConfigError).message).toContain('missing');
        expect((error as ConfigError).format()).toContain('openssl rand');
      }
    });

    it('fails when the permissions are too open', () => {
      writeSecret(SECRET, 0o644);

      try {
        readSessionSecret(config());
        expect.unreachable('expected a ConfigError');
      } catch (error) {
        expect((error as ConfigError).format()).toContain('expected 0600');
      }
    });

    it('fails when the secret is too short', () => {
      writeSecret('short');

      expect(() => readSessionSecret(config())).toThrow(/too short/);
    });
  });
});
