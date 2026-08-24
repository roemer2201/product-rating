import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from '../config/index.js';
import {
  PROXY_TARGET_NAMES,
  parseProxyTarget,
  renderProxyConfig,
  resolveProxyConfig,
  type ProxyTarget,
  type ResolvedProxyConfig,
} from '../services/proxyConfig.js';
import { EXIT_OK, type CliCommand } from './command.js';
import { numberOption, parseArguments, stringOption, UsageError } from './options.js';
import type { CliIo } from './io.js';

const USAGE = `Usage: product-rating proxy-config --server NAME [OPTIONS]

Writes the configuration of the web server in front of this instance, filled
in with what this installation is actually configured with: the host name and
the path from server.base_url, the address of the application from server.host
and server.port, and the size limit from uploads.max_file_size_mb.

Without --out the file goes to standard output, so it can be piped or read
first. Remarks about the result go to standard error and stay out of it.

Options:
      --server NAME   ${PROXY_TARGET_NAMES.join(' | ')}.
                      Required.
      --domain NAME   Host name the browser uses. Taken from server.base_url
                      when it is missing.
      --base-path PATH
                      Run under a path of an existing host, for example
                      --base-path /produkte. Empty (the default) means an own
                      host name. Note that the client has to be BUILT for that
                      path: PRODUCT_RATING_BASE_PATH=/produkte npm run
                      package:deb - no proxy can add it afterwards.
      --cert FILE     Certificate file, and it has to carry the full chain.
      --key FILE      Private key belonging to it. Both go together.
      --upstream HOST:PORT
                      Address of the application, if it is not the one this
                      configuration names.
      --max-body MB   Largest request the proxy lets through. The default is
                      uploads.max_file_size_mb plus five megabytes of head room
                      for the multipart body.
      --no-redirect   Leave out the plain HTTP part that sends the browser to
                      HTTPS (nginx and apache; the other two do it themselves).
      --out FILE      Write into FILE instead of standard output. A directory
                      is accepted as well; the file is then named after the
                      target. Missing parent directories are created.
      --force         Overwrite an existing file. Without it nothing is
                      touched.
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them,
and they are the way to generate for a second instance (--config FILE).

nginx and Apache cannot obtain a certificate themselves, so without --cert the
paths certbot uses are written out:
/etc/letsencrypt/live/<domain>/fullchain.pem and privkey.pem. Caddy and Traefik
without --cert stay on their own certificate handling (ACME); with --cert they
are told to use the given files instead.

The documented templates behind this - the same configurations with every
setting explained - are in packaging/examples/, after an installation under
/usr/share/doc/product-rating/examples/.

Examples:
  product-rating proxy-config --server nginx
  product-rating proxy-config --server apache --domain produkte.example.org \\
    --cert /etc/ssl/certs/produkte.pem --key /etc/ssl/private/produkte.key \\
    --out /etc/apache2/sites-available/product-rating.conf
  product-rating proxy-config --server caddy --base-path /produkte
  product-rating proxy-config --server traefik --out /etc/traefik/dynamic/`;

/** Reads `--server`, with the aliases and a message that lists the names. */
function readTarget(options: Record<string, string | boolean>): ProxyTarget {
  const name = stringOption(options, 'server');
  if (name === undefined) throw new UsageError('--server is required');

  const target = parseProxyTarget(name);
  if (target === undefined) {
    throw new UsageError(`unknown web server: ${name} (known: ${PROXY_TARGET_NAMES.join(', ')})`);
  }

  return target;
}

/** Splits `--upstream host:port`, brackets of an IPv6 literal included. */
function readUpstream(
  options: Record<string, string | boolean>,
): { host: string; port: number } | undefined {
  const value = stringOption(options, 'upstream');
  if (value === undefined) return undefined;

  const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(value.trim());
  const port = Number(match?.[2]);
  if (match?.[1] === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(`--upstream needs HOST:PORT, for example 127.0.0.1:8080 (got: ${value})`);
  }

  return { host: match[1].replace(/^\[|\]$/g, ''), port };
}

/**
 * Everything about the result that is worth saying but has no place in the
 * file: what the application still has to be told, and what is not there yet.
 */
function remarks(resolved: ResolvedProxyConfig, configuredBaseUrl: string, trustProxy: boolean) {
  const notes: string[] = [];

  if (configuredBaseUrl.replace(/\/$/, '') !== resolved.baseUrl) {
    notes.push(
      `warning: server.base_url is ${configuredBaseUrl}, this configuration serves ` +
        `${resolved.baseUrl} - every writing request is checked against base_url, so set ` +
        `it: product-rating ... --set server.base_url=${resolved.baseUrl}`,
    );
  }

  if (!trustProxy) {
    notes.push(
      'warning: server.trust_proxy is false - behind this proxy the log and the login rate ' +
        'limit would see the proxy instead of the client',
    );
  }

  for (const path of [resolved.certificate, resolved.certificateKey]) {
    if (path !== null && !existsSync(path)) {
      notes.push(`note: ${path} does not exist yet - the proxy will not start without it`);
    }
  }

  if (resolved.basePath !== '') {
    notes.push(
      `note: the client has to be built for ${resolved.basePath} as well ` +
        `(PRODUCT_RATING_BASE_PATH=${resolved.basePath}); the path sits in index.html, the ` +
        'manifest, the service worker and the API address and cannot be added by a proxy',
    );
  }

  return notes;
}

/** Resolves `--out`, which may name a file or an existing directory. */
function outputPath(target: string, filename: string): string {
  const absolute = resolve(target);
  const isDirectory =
    target.endsWith('/') || (existsSync(absolute) && statSync(absolute).isDirectory());

  return isDirectory ? join(absolute, filename) : absolute;
}

export const proxyConfigCommand: CliCommand = {
  name: 'proxy-config',
  summary: 'Write the web server configuration for this instance',
  usage: USAGE,

  run({ argv, io }) {
    const { options, configArgs } = parseArguments(argv, {
      help: 'boolean',
      server: 'string',
      domain: 'string',
      'base-path': 'string',
      cert: 'string',
      key: 'string',
      upstream: 'string',
      'max-body': 'string',
      'no-redirect': 'boolean',
      out: 'string',
      force: 'boolean',
    });

    if (options.help === true) {
      io.out(USAGE);
      return Promise.resolve(EXIT_OK);
    }

    const target = readTarget(options);
    const certificate = stringOption(options, 'cert');
    const certificateKey = stringOption(options, 'key');
    if ((certificate === undefined) !== (certificateKey === undefined)) {
      throw new UsageError('--cert and --key go together; give both or neither');
    }

    const upstream = readUpstream(options);
    const basePath = stringOption(options, 'base-path');
    if (basePath !== undefined && basePath !== '' && !basePath.startsWith('/')) {
      throw new UsageError(`--base-path has to start with a slash (got: ${basePath})`);
    }

    // Deliberately not loadRuntimeConfig(): generating a file for a proxy is
    // not a reason to create the data directories of the application, and it
    // has to work as an ordinary user on a machine that has none of them.
    const { config } = loadConfig({ argv: configArgs });

    const resolved = resolveProxyConfig(config, {
      target,
      domain: stringOption(options, 'domain'),
      basePath,
      upstreamHost: upstream?.host,
      upstreamPort: upstream?.port,
      certificate,
      certificateKey,
      maxBodyMb:
        options['max-body'] === undefined ? undefined : numberOption(options, 'max-body', 1, 1),
      httpRedirect: options['no-redirect'] !== true,
    });

    const generated = renderProxyConfig(resolved);
    const out = stringOption(options, 'out');

    if (out === undefined) {
      io.out(generated.content.trimEnd());
    } else {
      writeGenerated(
        outputPath(out, generated.filename),
        generated.content,
        options.force === true,
        io,
      );
    }

    for (const note of remarks(resolved, config.server.base_url, config.server.trust_proxy)) {
      io.err(note);
    }

    return Promise.resolve(EXIT_OK);
  },
};

/** Writes the file, and refuses to replace one that is already there. */
function writeGenerated(path: string, content: string, force: boolean, io: CliIo): void {
  if (existsSync(path) && !force) {
    throw new Error(`${path} exists already; pass --force to replace it`);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o644 });
  io.err(`wrote ${path}`);
}
