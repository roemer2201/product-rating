import { describe, expect, it } from 'vitest';
import { parseCliOverrides } from './cli.js';
import { ConfigError } from './errors.js';

describe('command line overrides', () => {
  it('reads the configuration path in both spellings', () => {
    expect(parseCliOverrides(['--config', '/etc/app.toml']).configPath).toBe('/etc/app.toml');
    expect(parseCliOverrides(['--config=/etc/app.toml']).configPath).toBe('/etc/app.toml');
  });

  it('maps convenience flags onto configuration keys', () => {
    expect(parseCliOverrides(['--host', '0.0.0.0', '--port', '9000']).overrides).toEqual({
      server: { host: '0.0.0.0', port: 9000 },
    });
    expect(parseCliOverrides(['--log-level=debug']).overrides).toEqual({ log: { level: 'debug' } });
  });

  it('supports the generic --set form', () => {
    expect(parseCliOverrides(['--set', 'paths.uploads=/srv/photos']).overrides).toEqual({
      paths: { uploads: '/srv/photos' },
    });
    expect(parseCliOverrides(['--set', 'UPLOADS.STRIP_EXIF=false']).overrides).toEqual({
      uploads: { strip_exif: false },
    });
  });

  it('ignores arguments that belong to the command line interface', () => {
    const parsed = parseCliOverrides(['serve', '--verbose', '--port', '9000']);

    expect(parsed.overrides).toEqual({ server: { port: 9000 } });
    expect(parsed.configPath).toBeUndefined();
  });

  it('rejects a missing value, an unknown key and a malformed --set', () => {
    expect(() => parseCliOverrides(['--port'])).toThrow(/Missing value/);
    expect(() => parseCliOverrides(['--set', 'paths.databse=/srv/app.db'])).toThrow(ConfigError);
    expect(() => parseCliOverrides(['--set', 'nonsense'])).toThrow(/Invalid --set/);
  });
});
