import { describe, expect, it } from 'vitest';
import { collectEnvOverrides } from './env.js';
import { ConfigError } from './errors.js';
import { parseConfig } from './load.js';

describe('environment overrides', () => {
  it('ignores variables without the prefix', () => {
    expect(collectEnvOverrides({ PATH: '/usr/bin', PRODUCT_RATING_CONFIG: '/etc/x.toml' })).toEqual(
      {},
    );
  });

  it('maps PR_<SECTION>__<KEY> onto section and key', () => {
    expect(collectEnvOverrides({ PR_PATHS__DATABASE: '/srv/app.db' })).toEqual({
      paths: { database: '/srv/app.db' },
    });
  });

  it('accepts lower case names', () => {
    expect(collectEnvOverrides({ pr_server__host: '0.0.0.0' })).toEqual({
      server: { host: '0.0.0.0' },
    });
  });

  it('converts numbers, booleans and lists to the expected type', () => {
    const overrides = collectEnvOverrides({
      PR_SERVER__PORT: '9000',
      PR_SERVER__TRUST_PROXY: 'yes',
      PR_UPLOADS__STRIP_EXIF: '0',
      PR_UPLOADS__ALLOWED_MIME: 'image/jpeg, image/webp',
      PR_LOG__LEVEL: 'debug',
      PR_APP__TITLE: '2026',
    });

    expect(overrides).toEqual({
      server: { port: 9000, trust_proxy: true },
      uploads: { strip_exif: false, allowed_mime: ['image/jpeg', 'image/webp'] },
      log: { level: 'debug' },
      app: { title: '2026' },
    });
  });

  it('keeps a single list entry a list', () => {
    expect(collectEnvOverrides({ PR_UPLOADS__ALLOWED_MIME: 'image/png' })).toEqual({
      uploads: { allowed_mime: ['image/png'] },
    });
  });

  it('passes unconvertible values on so the schema reports them', () => {
    const overrides = collectEnvOverrides({ PR_SERVER__PORT: 'eighty' });

    expect(overrides).toEqual({ server: { port: 'eighty' } });
    expect(() => parseConfig(overrides)).toThrow(ConfigError);
  });

  it('rejects a malformed override name', () => {
    expect(() => collectEnvOverrides({ PR_PORT: '9000' })).toThrow(ConfigError);
  });

  it('rejects an unknown section or key', () => {
    expect(() => collectEnvOverrides({ PR_DATABASE__PATH: '/srv/app.db' })).toThrow(
      /Unknown configuration section/,
    );
    expect(() => collectEnvOverrides({ PR_PATHS__DATABSE: '/srv/app.db' })).toThrow(
      /Unknown configuration key/,
    );
  });
});
