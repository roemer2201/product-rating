import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../config/index.js';
import { assertLoggingUsable, createLogger } from './index.js';
import {
  createSyslogStream,
  levelOfLine,
  syslogPriority,
  syslogProblem,
  syslogSeverity,
} from './syslog.js';

/**
 * The logging configuration is only worth anything if `format` and
 * `destination` actually reach the written line, so the tests read the lines
 * back instead of checking that a logger was built.
 */

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'product-rating-log-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Waits for the asynchronous destination to have written the line. */
async function readLog(path: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const content = readFileSync(path, 'utf8');
      if (content.length > 0) return content;
    } catch {
      // The file appears with the first line.
    }
    await delay(10);
  }

  return '';
}

describe('log destinations', () => {
  it('writes JSON lines into the configured file', async () => {
    const file = join(directory, 'app.log');
    const { logger, close } = createLogger(
      parseConfig({ log: { destination: 'file', file, format: 'json' } }),
    );

    logger.info({ event: 'test' }, 'hello');
    await close();

    const entry = JSON.parse((await readLog(file)).trim()) as Record<string, unknown>;
    expect(entry.msg).toBe('hello');
    expect(entry.event).toBe('test');
    expect(entry.name).toBe('product-rating');
  });

  it('writes readable lines when the format is pretty', async () => {
    const file = join(directory, 'pretty.log');
    const { logger, close } = createLogger(
      parseConfig({ log: { destination: 'file', file, format: 'pretty' } }),
    );

    logger.warn('careful');
    await close();

    const content = await readLog(file);
    expect(content).toContain('careful');
    expect(content).toContain('WARN');
    expect(content.trimStart().startsWith('{')).toBe(false);
  });

  it('keeps to the configured level', async () => {
    const file = join(directory, 'level.log');
    const { logger, close } = createLogger(
      parseConfig({ log: { destination: 'file', file, level: 'warn' } }),
    );

    logger.info('not interesting');
    logger.error('interesting');
    await close();

    const content = await readLog(file);
    expect(content).toContain('interesting');
    expect(content).not.toContain('not interesting');
  });
});

describe('syslog', () => {
  it('maps the pino levels onto syslog severities', () => {
    expect(syslogSeverity(60)).toBe(2);
    expect(syslogSeverity(50)).toBe(3);
    expect(syslogSeverity(40)).toBe(4);
    expect(syslogSeverity(30)).toBe(6);
    expect(syslogSeverity(20)).toBe(7);

    // Facility "daemon" is 3, so an error becomes 3 * 8 + 3.
    expect(syslogPriority(50)).toBe(27);
    expect(syslogPriority(30)).toBe(30);
  });

  it('reads the level out of a serialized line', () => {
    expect(levelOfLine('{"level":50,"msg":"broken"}')).toBe(50);
    expect(levelOfLine('a pretty printed line')).toBe(30);
  });

  it('reports a helper that is missing or refuses the line', () => {
    expect(syslogProblem('test', 'product-rating-no-such-helper')).toContain('not found');
    expect(syslogProblem('test', 'false')).toContain('exited with 1');

    // Every destination other than syslog needs nothing checked at all.
    expect(() => {
      assertLoggingUsable(parseConfig({ log: { destination: 'stdout' } }));
    }).not.toThrow();
  });

  it('falls back to stderr when the log helper cannot be started', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    const stream = createSyslogStream({ tag: 'test', command: 'product-rating-no-such-helper' });
    // The failure to spawn arrives as an event, not as a throw.
    await delay(50);
    stream.write('{"level":50,"msg":"broken"}\n');
    stream.end();
    spy.mockRestore();

    expect(written.join('')).toContain('falling back to stderr');
    expect(written.join('')).toContain('<27>{"level":50,"msg":"broken"}');
  });
});
