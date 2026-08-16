import { describe, expect, it } from 'vitest';
import {
  numberOption,
  parseArguments,
  requiredOption,
  stringOption,
  UsageError,
} from './options.js';

describe('command line options', () => {
  const spec = { help: 'boolean', to: 'string', repair: 'boolean' } as const;

  it('reads boolean and string options in both spellings', () => {
    const parsed = parseArguments(['--repair', '--to', '/backup'], { ...spec });
    expect(parsed.options).toEqual({ repair: true, to: '/backup' });

    const equals = parseArguments(['--to=/backup'], { ...spec });
    expect(equals.options.to).toBe('/backup');
  });

  it('hands configuration flags through untouched', () => {
    const parsed = parseArguments(
      ['--config', '/etc/app.toml', '--to', '/backup', '--set', 'server.port=9090'],
      { ...spec },
    );

    expect(parsed.configArgs).toEqual(['--config', '/etc/app.toml', '--set', 'server.port=9090']);
    expect(parsed.options.to).toBe('/backup');
  });

  it('lets a command claim a flag the configuration also knows', () => {
    const parsed = parseArguments(['--uploads', '--repair'], {
      uploads: 'boolean',
      repair: 'boolean',
    });

    expect(parsed.options.uploads).toBe(true);
    expect(parsed.configArgs).toEqual([]);
    expect(parsed.positionals).toEqual([]);
  });

  it('collects positional arguments and stops parsing after --', () => {
    const parsed = parseArguments(['add', 'anna', '--', '--not-an-option'], {});

    expect(parsed.positionals).toEqual(['add', 'anna', '--not-an-option']);
  });

  it('rejects unknown options and missing values', () => {
    expect(() => parseArguments(['--nonsense'], { ...spec })).toThrow(UsageError);
    expect(() => parseArguments(['--to'], { ...spec })).toThrow(/missing value/);
    expect(() => parseArguments(['--repair=yes'], { ...spec })).toThrow(/takes no value/);
  });

  it('converts and validates option values', () => {
    expect(numberOption({ 'keep-days': '30' }, 'keep-days', 0)).toBe(30);
    expect(numberOption({}, 'keep-days', 7)).toBe(7);
    expect(() => numberOption({ 'keep-days': 'soon' }, 'keep-days', 0)).toThrow(UsageError);
    expect(() => numberOption({ ttl: '0' }, 'ttl', 1, 1)).toThrow(UsageError);

    expect(stringOption({ to: '/backup' }, 'to')).toBe('/backup');
    expect(stringOption({ to: true }, 'to')).toBeUndefined();
    expect(requiredOption({ to: '/backup' }, 'to')).toBe('/backup');
    expect(() => requiredOption({}, 'to')).toThrow(/--to is required/);
  });
});
