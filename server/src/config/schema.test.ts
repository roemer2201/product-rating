import { describe, expect, it } from 'vitest';
import { ConfigError } from './errors.js';
import { parseConfig } from './load.js';
import { configSchema, getKeySchema, isConfigSection, keysOfSection } from './schema.js';
import type { RawConfig } from './values.js';

describe('config schema', () => {
  it('fills every section from its defaults', () => {
    const config = parseConfig({}, '/srv/app');

    expect(config.server).toEqual({
      host: '127.0.0.1',
      port: 8080,
      base_url: 'http://127.0.0.1:8080',
      trust_proxy: false,
      trusted_origins: [],
    });
    expect(config.uploads.allowed_mime).toContain('image/jpeg');
    expect(config.auth.session_ttl_days).toBe(90);
    expect(config.auth.min_password_length).toBe(10);
    expect(config.log.destination).toBe('stdout');
    expect(config.app.external_lookup).toBe(false);
  });

  it('rejects an unknown section', () => {
    expect(() => parseConfig({ nope: {} } as unknown as RawConfig)).toThrow(ConfigError);
  });

  it('names the offending key when a value has the wrong type', () => {
    try {
      parseConfig({ server: { port: 'eighty' } });
      expect.unreachable('expected a ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).details.join('\n')).toContain('server.port');
    }
  });

  it('rejects an unknown key inside a known section', () => {
    try {
      parseConfig({ paths: { databse: '/tmp/app.db' } });
      expect.unreachable('expected a ConfigError');
    } catch (error) {
      expect((error as ConfigError).details.join('\n')).toContain('databse');
    }
  });

  it('enforces value ranges', () => {
    expect(() => parseConfig({ server: { port: 0 } })).toThrow(ConfigError);
    expect(() => parseConfig({ uploads: { max_file_size_mb: 0 } })).toThrow(ConfigError);
    expect(() => parseConfig({ log: { level: 'chatty' } })).toThrow(ConfigError);
    expect(() => parseConfig({ server: { base_url: 'not-a-url' } })).toThrow(ConfigError);
  });

  it('keeps the session renewal threshold below the session lifetime', () => {
    expect(() =>
      parseConfig({ auth: { session_ttl_days: 5, session_renew_threshold_days: 5 } }),
    ).toThrow(ConfigError);
    expect(
      parseConfig({ auth: { session_ttl_days: 5, session_renew_threshold_days: 4 } }).auth
        .session_ttl_days,
    ).toBe(5);
  });

  it('keeps the thumbnail smaller than the detail image', () => {
    expect(() => parseConfig({ uploads: { thumbnail_px: 1600, detail_px: 1600 } })).toThrow(
      ConfigError,
    );
  });

  it('refuses to enable the external lookup', () => {
    try {
      parseConfig({ app: { external_lookup: true } });
      expect.unreachable('expected a ConfigError');
    } catch (error) {
      expect((error as ConfigError).details.join('\n')).toContain('not implemented');
    }
  });

  it('exposes its own structure for overrides', () => {
    expect(isConfigSection('paths')).toBe(true);
    expect(isConfigSection('database')).toBe(false);
    expect(keysOfSection('paths')).toEqual(['database', 'uploads', 'temp']);
    expect(getKeySchema('paths', 'database')).toBeDefined();
    expect(getKeySchema('paths', 'missing')).toBeUndefined();
    expect(Object.keys(configSchema.shape)).toEqual([
      'server',
      'paths',
      'uploads',
      'auth',
      'log',
      'app',
    ]);
  });
});
