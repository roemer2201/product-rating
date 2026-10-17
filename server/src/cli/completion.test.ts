import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_FLAGS,
  CONFIG_SECTIONS,
  keysOfSection,
  LOG_DESTINATIONS,
  LOG_FORMATS,
  LOG_LEVELS,
} from '../config/index.js';
import { PROXY_TARGET_NAMES } from '../services/proxyConfig.js';
import { COMMANDS } from './index.js';

/**
 * The bash completion in `packaging/completion/` against the CLI it completes.
 *
 * The completion is a second description of the command line, written in Bash
 * and kept by hand, so nothing stops it from drifting away from the parser.
 * These tests ask it what it offers and compare that with the command list,
 * the "Options:" section of every help text, the configuration schema and the
 * accepted proxy targets. A new option shows up here as a failure until the
 * completion knows it too.
 *
 * For those questions a stand-in for the bash-completion library is enough;
 * the behaviour with the real helpers - '=', ':', spaces in file names, both
 * helper generations - is what `test-completion.bash` checks, run at the end
 * against the library of this machine.
 */

function packagingFile(name: string): string {
  return fileURLToPath(new URL(`../../../packaging/completion/${name}`, import.meta.url));
}

const COMPLETION = packagingFile('product-rating.bash');
const SYSTEM_LIBRARY = '/usr/share/bash-completion/bash_completion';

/**
 * The two helpers of the library the completion uses, reduced to what the
 * cases here need: words without '=' or ':', and no file names.
 */
const STUB_LIBRARY = `
_init_completion() {
  words=("\${COMP_WORDS[@]}")
  cword=\${COMP_CWORD}
  cur=\${COMP_WORDS[COMP_CWORD]}
  prev=\${COMP_WORDS[COMP_CWORD-1]}
}
_filedir() { :; }
`;

/** The candidates the completion offers for a line ending in `words`. */
function complete(...words: string[]): string[] {
  const script = `${STUB_LIBRARY}
source "$1"; shift
COMP_WORDS=("$@")
COMP_CWORD=$((\${#COMP_WORDS[@]} - 1))
COMP_LINE="$*"
COMP_POINT=\${#COMP_LINE}
_product_rating "$1" "\${COMP_WORDS[COMP_CWORD]}" "\${COMP_WORDS[COMP_CWORD-1]}"
printf '%s\\n' "\${COMPREPLY[@]}"`;

  const output = execFileSync(
    'bash',
    ['--norc', '--noprofile', '-c', script, 'bash', COMPLETION, ...words],
    {
      encoding: 'utf8',
    },
  );
  return output.split('\n').filter((line) => line.length > 0);
}

/** Lines of one section of a help text, up to the next blank line. */
function section(usage: string, heading: string): string[] {
  const lines = usage.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) return [];

  const end = lines.findIndex((line, index) => index > start && line.trim().length === 0);
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** Long options a help text documents, from the start of its option lines. */
function documentedOptions(usage: string): string[] {
  return section(usage, 'Options:').flatMap(
    (line) => /^ {6}(--[a-z][a-z-]*)/.exec(line)?.[1] ?? [],
  );
}

/** Subcommands a help text documents, from its "Subcommands:" section. */
function documentedSubcommands(usage: string): string[] {
  return section(usage, 'Subcommands:').flatMap(
    (line) => /^ {2}([a-z][a-z-]*)/.exec(line)?.[1] ?? [],
  );
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

describe('bash completion', () => {
  it('offers every command, then help and version', () => {
    expect(complete('product-rating', '')).toEqual([
      ...COMMANDS.map((command) => command.name),
      'help',
      'version',
    ]);
  });

  it.each(COMMANDS.map((command) => [command.name, command] as const))(
    'offers the documented options of %s and the configuration flags',
    (name, command) => {
      const documented = documentedOptions(command.usage);
      expect(documented).toContain('--help');

      expect(sorted(complete('product-rating', name, '--'))).toEqual(
        sorted([...documented, ...CONFIG_FLAGS]),
      );
    },
  );

  it.each(['user', 'invite'])('offers the documented subcommands of %s', (name) => {
    const command = COMMANDS.find((entry) => entry.name === name);
    const documented = documentedSubcommands(command?.usage ?? '');
    expect(documented.length).toBeGreaterThan(0);

    expect(complete('product-rating', name, '')).toEqual(documented);
  });

  it('offers every configuration key after --set', () => {
    const keys = CONFIG_SECTIONS.flatMap((name) =>
      keysOfSection(name).map((key) => `${name}.${key}=`),
    );

    expect(sorted(complete('product-rating', 'serve', '--set', ''))).toEqual(sorted(keys));
  });

  it('offers the values the configuration accepts for the log flags', () => {
    expect(complete('product-rating', 'serve', '--log-level', '')).toEqual([...LOG_LEVELS]);
    expect(complete('product-rating', 'serve', '--log-format', '')).toEqual([...LOG_FORMATS]);
    expect(complete('product-rating', 'serve', '--log-destination', '')).toEqual([
      ...LOG_DESTINATIONS,
    ]);
  });

  it('offers every web server name proxy-config accepts', () => {
    expect(complete('product-rating', 'proxy-config', '--server', '')).toEqual(PROXY_TARGET_NAMES);
  });

  it.skipIf(!existsSync(SYSTEM_LIBRARY))('passes its own checks with the real library', () => {
    const result = spawnSync(
      'bash',
      ['--norc', '--noprofile', packagingFile('test-completion.bash'), SYSTEM_LIBRARY, COMPLETION],
      { encoding: 'utf8' },
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^PASS: /);
  });
});
