import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from './errors.js';
import { CONFIG_PATH_ENV_VAR, configFileCandidates, SYSTEM_CONFIG_PATH } from './file.js';
import { loadConfig, parseConfig } from './load.js';

const EXAMPLE_TOML = `
[server]
host = "0.0.0.0"
port = 8081

[paths]
database = "data/app.db"
uploads  = "data/uploads"
temp     = "data/tmp"

[app]
title = "Haushalt"
`;

describe('configuration loading', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'product-rating-config-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(relativePath: string, content = EXAMPLE_TOML): string {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return path;
  }

  it('searches --config, the environment variable and the fixed locations in order', () => {
    const candidates = configFileCandidates({
      explicitPath: 'cli.toml',
      env: { [CONFIG_PATH_ENV_VAR]: 'env.toml' },
      cwd: '/work/server',
    });

    expect(candidates.map((candidate) => [candidate.source, candidate.path])).toEqual([
      ['cli', '/work/server/cli.toml'],
      ['env', '/work/server/env.toml'],
      ['system', SYSTEM_CONFIG_PATH],
      // The local file is looked for upwards as well, because npm runs a
      // workspace script inside the workspace directory.
      ['local', '/work/server/config/config.toml'],
      ['local', '/work/config/config.toml'],
      ['local', '/config/config.toml'],
    ]);
  });

  it('finds a configuration file in a parent directory', () => {
    writeConfig('config/config.toml');
    mkdirSync(join(root, 'server'), { recursive: true });

    const loaded = loadConfig({ env: {}, cwd: join(root, 'server') });

    expect(loaded.configFile).toBe(join(root, 'config/config.toml'));
  });

  it('starts on defaults alone when no configuration file exists', () => {
    const loaded = loadConfig({ env: {}, cwd: root });

    expect(loaded.configFile).toBeNull();
    expect(loaded.config.server.port).toBe(8080);
  });

  it('reads ./config/config.toml from the working directory', () => {
    const path = writeConfig('config/config.toml');
    const loaded = loadConfig({ env: {}, cwd: root });

    expect(loaded.configFile).toBe(path);
    expect(loaded.configFileSource).toBe('local');
    expect(loaded.config.server.host).toBe('0.0.0.0');
    expect(loaded.config.app.title).toBe('Haushalt');
  });

  it('prefers --config over the environment variable', () => {
    const fromCli = writeConfig('cli.toml', '[app]\ntitle = "cli"\n');
    writeConfig('env.toml', '[app]\ntitle = "env"\n');

    const loaded = loadConfig({
      argv: ['--config', fromCli],
      env: { [CONFIG_PATH_ENV_VAR]: join(root, 'env.toml') },
      cwd: root,
    });

    expect(loaded.configFile).toBe(fromCli);
    expect(loaded.config.app.title).toBe('cli');
  });

  it('uses $PRODUCT_RATING_CONFIG when no --config is given', () => {
    const path = writeConfig('env.toml', '[app]\ntitle = "env"\n');
    const loaded = loadConfig({ env: { [CONFIG_PATH_ENV_VAR]: path }, cwd: root });

    expect(loaded.configFileSource).toBe('env');
    expect(loaded.config.app.title).toBe('env');
  });

  it('resolves relative paths against the directory of the configuration file', () => {
    writeConfig('etc/config.toml');
    const loaded = loadConfig({
      env: {},
      cwd: root,
      argv: ['--config', join(root, 'etc/config.toml')],
    });

    expect(loaded.baseDir).toBe(join(root, 'etc'));
    expect(loaded.config.paths.database).toBe(join(root, 'etc/data/app.db'));
    expect(loaded.config.paths.uploads).toBe(join(root, 'etc/data/uploads'));
  });

  it('keeps absolute paths untouched', () => {
    writeConfig('config/config.toml', '[paths]\ndatabase = "/srv/pr/app.db"\n');
    const loaded = loadConfig({ env: {}, cwd: root });

    expect(loaded.config.paths.database).toBe('/srv/pr/app.db');
  });

  it('resolves the frontend directory but leaves it empty when unset', () => {
    writeConfig('etc/config.toml', '[server]\nstatic_dir = "../web"\n');
    const withDirectory = loadConfig({
      env: {},
      cwd: root,
      argv: ['--config', join(root, 'etc/config.toml')],
    });

    expect(withDirectory.config.server.static_dir).toBe(join(root, 'web'));
    expect(loadConfig({ env: {}, cwd: root }).config.server.static_dir).toBe('');
  });

  it('resolves relative paths against the working directory without a file', () => {
    const loaded = loadConfig({ env: { PR_PATHS__UPLOADS: 'photos' }, cwd: root });

    expect(loaded.config.paths.uploads).toBe(join(root, 'photos'));
  });

  it('applies defaults < file < environment < command line', () => {
    writeConfig('config/config.toml');

    const loaded = loadConfig({
      argv: ['--port', '9100'],
      env: { PR_SERVER__PORT: '9000', PR_SERVER__HOST: '127.0.0.2' },
      cwd: root,
    });

    // command line wins over environment
    expect(loaded.config.server.port).toBe(9100);
    // environment wins over the file
    expect(loaded.config.server.host).toBe('127.0.0.2');
    // the file wins over the defaults
    expect(loaded.config.app.title).toBe('Haushalt');
    // untouched keys keep their default
    expect(loaded.config.auth.session_ttl_days).toBe(90);
  });

  it('fails when a configuration file named explicitly does not exist', () => {
    expect(() =>
      loadConfig({ argv: ['--config', join(root, 'missing.toml')], env: {}, cwd: root }),
    ).toThrow(/not found/);
    expect(() =>
      loadConfig({ env: { [CONFIG_PATH_ENV_VAR]: join(root, 'missing.toml') }, cwd: root }),
    ).toThrow(ConfigError);
  });

  it('reports the file and the position of a TOML syntax error', () => {
    writeConfig('config/config.toml', '[server\nport = 8080\n');

    try {
      loadConfig({ env: {}, cwd: root });
      expect.unreachable('expected a ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain('not valid TOML');
      expect((error as ConfigError).format()).toContain('line 1');
    }
  });

  it('accepts config/config.example.toml and it documents the defaults', () => {
    const examplePath = fileURLToPath(
      new URL('../../../config/config.example.toml', import.meta.url),
    );
    const loaded = loadConfig({ argv: ['--config', examplePath], env: {}, cwd: root });

    expect(loaded.configFile).toBe(examplePath);
    expect(loaded.config).toEqual(parseConfig({}, dirname(examplePath)));
  });

  it('names the configuration file when a value is invalid', () => {
    const path = writeConfig('config/config.toml', '[server]\nport = 70000\n');

    try {
      loadConfig({ env: {}, cwd: root });
      expect.unreachable('expected a ConfigError');
    } catch (error) {
      expect((error as ConfigError).message).toContain(path);
      expect((error as ConfigError).details.join('\n')).toContain('server.port');
    }
  });
});
