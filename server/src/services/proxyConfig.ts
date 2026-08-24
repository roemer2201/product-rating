import type { AppConfig } from '../config/index.js';

/**
 * The reverse proxy configuration of one instance, written out for the web
 * server in front of it.
 *
 * `packaging/examples/` ships the same four configurations as documented
 * templates: they explain every setting and expect the reader to replace the
 * host name, the certificate paths and the port by hand. What is generated
 * here is the other half of that - the same configuration, but already filled
 * in with what this installation is actually configured with, so the copy that
 * ends up in /etc/nginx has no placeholder left in it.
 *
 * Everything that is not passed on the command line is taken from the
 * configuration: the host name and the path from `server.base_url`, the
 * address of the application from `server.host` and `server.port`, and the
 * size limit from `uploads.max_file_size_mb`. That is deliberate - those three
 * are exactly the settings a mismatch between application and proxy shows up
 * in, and the proxy is the side that is written twice.
 */

export const PROXY_TARGETS = ['nginx', 'apache', 'caddy', 'traefik'] as const;
export type ProxyTarget = (typeof PROXY_TARGETS)[number];

/**
 * Every spelling of a web server accepted on the command line, including the
 * target names themselves - Apache answers to three of them because the
 * package, the binary and the project each use a different one.
 *
 * The insertion order is the order the names are offered in, so a target and
 * its other spellings stay next to each other.
 */
const TARGET_ALIASES: Record<string, ProxyTarget> = {
  nginx: 'nginx',
  apache: 'apache',
  apache2: 'apache',
  httpd: 'apache',
  caddy: 'caddy',
  traefik: 'traefik',
};

/** The accepted names, for the help text and for error messages. */
export const PROXY_TARGET_NAMES = Object.keys(TARGET_ALIASES);

/** Recognises a target name, `undefined` for anything else. */
export function parseProxyTarget(name: string): ProxyTarget | undefined {
  return TARGET_ALIASES[name.trim().toLowerCase()];
}

/**
 * Head room the proxy limit gets over the limit of the application. A
 * multipart body carries the boundaries, the field names and the base64 of
 * nothing else, and a request that is a little over the application's limit
 * should be refused by the application - with a readable error - and not by
 * the proxy, which can only answer 413 into a broken upload.
 */
const BODY_OVERHEAD_MB = 5;

/** Where certbot puts a certificate, and the default for nginx and Apache. */
export function letsEncryptCertificate(domain: string): { certificate: string; key: string } {
  return {
    certificate: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
    key: `/etc/letsencrypt/live/${domain}/privkey.pem`,
  };
}

export interface ProxyConfigOptions {
  target: ProxyTarget;
  /** Host name the browser uses; `server.base_url` decides if it is missing. */
  domain?: string | undefined;
  /** Path prefix, `/produkte` style. Empty means an own host name. */
  basePath?: string | undefined;
  /** Address of the application, `host:port`. */
  upstreamHost?: string | undefined;
  upstreamPort?: number | undefined;
  /** Certificate chain and private key. */
  certificate?: string | undefined;
  certificateKey?: string | undefined;
  /** Largest request the proxy lets through, in megabytes. */
  maxBodyMb?: number | undefined;
  /** Write the plain HTTP virtual host that sends the browser to HTTPS. */
  httpRedirect?: boolean | undefined;
}

export interface ResolvedProxyConfig {
  target: ProxyTarget;
  domain: string;
  basePath: string;
  upstreamHost: string;
  upstreamPort: number;
  /** `null` for Caddy and Traefik, which can obtain a certificate themselves. */
  certificate: string | null;
  certificateKey: string | null;
  maxBodyMb: number;
  /** `uploads.max_file_size_mb`, quoted in the comments of the output. */
  uploadLimitMb: number;
  httpRedirect: boolean;
  /** The public address, the value `server.base_url` has to carry. */
  baseUrl: string;
}

/** Strips the trailing slash; `/` and an empty value mean an own host name. */
export function normaliseBasePath(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * An address for a URL, with the brackets an IPv6 literal needs. `0.0.0.0` and
 * `::` are what the application binds to, not an address the proxy can talk
 * to; the loopback interface is what is meant there.
 */
function upstreamAuthority(host: string, port: number): string {
  const address = host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host;
  const bracketed = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
  return `${bracketed}:${String(port)}`;
}

/** Fills the gaps in the options from the configuration of this instance. */
export function resolveProxyConfig(
  config: AppConfig,
  options: ProxyConfigOptions,
): ResolvedProxyConfig {
  const configured = new URL(config.server.base_url);
  const domain = options.domain?.trim() ?? configured.hostname;
  const basePath = normaliseBasePath(options.basePath ?? configured.pathname);

  // Caddy and Traefik obtain a certificate themselves, so a missing path stays
  // missing there. nginx and Apache cannot, and would be written out with a
  // hole in them; certbot's layout is the one guess worth making.
  const fallback =
    options.target === 'nginx' || options.target === 'apache'
      ? letsEncryptCertificate(domain)
      : null;

  return {
    target: options.target,
    domain,
    basePath,
    upstreamHost: options.upstreamHost ?? config.server.host,
    upstreamPort: options.upstreamPort ?? config.server.port,
    certificate: options.certificate ?? fallback?.certificate ?? null,
    certificateKey: options.certificateKey ?? fallback?.key ?? null,
    maxBodyMb: options.maxBodyMb ?? config.uploads.max_file_size_mb + BODY_OVERHEAD_MB,
    uploadLimitMb: config.uploads.max_file_size_mb,
    httpRedirect: options.httpRedirect ?? true,
    baseUrl: `https://${domain}${basePath}`,
  };
}

export interface GeneratedProxyConfig {
  /** Name the file gets when `--out` names a directory. */
  filename: string;
  content: string;
}

/** The three settings that have to agree, as comment lines of the target. */
function agreementNotes(resolved: ResolvedProxyConfig, comment: string, limit: string): string {
  return [
    `${comment} Three settings have to match what the application is configured with:`,
    `${comment}`,
    `${comment}   * server.base_url = ${resolved.baseUrl}`,
    `${comment}     Every writing request is checked against it, so a mismatch lets the`,
    `${comment}     interface load and then makes every save fail with 403.`,
    `${comment}   * server.trust_proxy = true, otherwise the log and the login rate limit`,
    `${comment}     see this proxy instead of the client.`,
    `${comment}   * ${limit} is at least uploads.max_file_size_mb`,
    `${comment}     (${String(resolved.uploadLimitMb)} MB in this installation).`,
  ].join('\n');
}

/** The header every generated file carries, above the target's own hints. */
function header(resolved: ResolvedProxyConfig, comment: string): string {
  return [
    `${comment} product-rating behind ${resolved.target}, generated by`,
    `${comment} "product-rating proxy-config --server ${resolved.target}".`,
    `${comment}`,
    `${comment} The values come from the configuration of this instance. Edits made here`,
    `${comment} are not written back into it - change the configuration and generate the`,
    `${comment} file again rather than keeping the two apart by hand.`,
  ].join('\n');
}

function renderNginx(resolved: ResolvedProxyConfig): string {
  const upstream = upstreamAuthority(resolved.upstreamHost, resolved.upstreamPort);
  const subPath = resolved.basePath !== '';
  const location = subPath ? `${resolved.basePath}/` : '/';
  // The trailing slash is what strips the prefix: nginx replaces the matched
  // location with it, so the application keeps answering on / and /api/v1.
  const target = subPath ? 'http://product_rating/' : 'http://product_rating';

  const proxyBlock = [
    `    location ${location} {`,
    `        proxy_pass ${target};`,
    '',
    '        # Required for the keepalive of the upstream block: HTTP/1.1 and an',
    '        # empty Connection header, so nginx does not forward "close".',
    '        proxy_http_version 1.1;',
    '        proxy_set_header Connection "";',
    '',
    '        proxy_set_header Host              $host;',
    '        proxy_set_header X-Real-IP         $remote_addr;',
    '        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '        proxy_set_header X-Forwarded-Host  $host;',
    '',
    '        # Photos are the largest thing that travels here, and a phone sends them',
    '        # over a slow uplink; the application re-encodes them afterwards. Both',
    '        # outlast the default of 60 seconds.',
    `        client_max_body_size ${String(resolved.maxBodyMb)}m;`,
    '        client_body_timeout  120s;',
    '        proxy_read_timeout   120s;',
    '        proxy_send_timeout   120s;',
    '',
    '        # No cache rules here, on purpose: the application sets Cache-Control',
    '        # itself and is the only place that can tell an immutable file under',
    '        # /assets/ from index.html, sw.js and the manifest, which keep their',
    '        # names across releases and have to stay revalidated.',
    subPath
      ? [
          '',
          '        # Repeated on purpose: a single add_header in this block would',
          '        # otherwise replace the list of the enclosing server block for it.',
          '        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
        ].join('\n')
      : null,
    '    }',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const redirect = [
    '# Plain HTTP exists only to send the browser to HTTPS. The camera of the',
    '# scanner is unavailable without a secure context, so an instance reached over',
    '# HTTP is not merely unencrypted, it is missing its main function.',
    'server {',
    '    listen 80;',
    '    listen [::]:80;',
    `    server_name ${resolved.domain};`,
    '',
    '    # Leave this in place if certbot renews the certificate over HTTP-01.',
    '    location /.well-known/acme-challenge/ {',
    '        root /var/www/html;',
    '    }',
    '',
    '    location / {',
    '        return 308 https://$host$request_uri;',
    '    }',
    '}',
    '',
    '',
  ].join('\n');

  return `${header(resolved, '#')}
#
#   cp product-rating.conf /etc/nginx/sites-available/product-rating
#   ln -s ../sites-available/product-rating /etc/nginx/sites-enabled/
#   nginx -t && systemctl reload nginx
#
${
  subPath
    ? `# This instance runs under ${resolved.basePath} of an existing host. The server
# block below carries only that location: if ${resolved.domain} already has a
# configuration, move the location into it instead of enabling this file next
# to it - two server blocks for one name are one too many.
#
# The prefix has to be BUILT into the client as well; it sits in index.html, the
# manifest, the service worker and the API address, and no proxy can rewrite it
# afterwards:
#
#   PRODUCT_RATING_BASE_PATH=${resolved.basePath} npm run package:deb
#
`
    : `# The application answers the interface and /api/v1 from the same process, so
# there is exactly one proxy_pass and no split between a static root and an API
# location. TLS ends here; the application speaks plain HTTP on ${upstream}.
#
`
}${agreementNotes(resolved, '#', 'client_max_body_size')}

upstream product_rating {
    server ${upstream};

    # Keeps connections open between nginx and the application instead of
    # opening a new one per request. Needs the two proxy_http_version and
    # Connection settings in the location below.
    keepalive 16;
}

${resolved.httpRedirect && !subPath ? redirect : ''}server {
    listen 443 ssl;
    listen [::]:443 ssl;
    # Separate directive since nginx 1.25.1. Older versions (Debian 12 with
    # 1.22, Ubuntu 24.04 with 1.24) want the option on the listen directives
    # instead: "listen 443 ssl http2;".
    http2 on;
    server_name ${resolved.domain};

    ssl_certificate     ${resolved.certificate ?? letsEncryptCertificate(resolved.domain).certificate};
    ssl_certificate_key ${resolved.certificateKey ?? letsEncryptCertificate(resolved.domain).key};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_timeout 1d;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_tickets off;

    # Compression for the bundle and the API answers. Proxied responses are
    # excluded by default, which is why gzip_proxied is needed. Images are WebP
    # and already compressed, so they stay out.
    gzip             on;
    gzip_proxied     any;
    gzip_vary        on;
    gzip_min_length  1024;
    gzip_types       text/css text/plain application/javascript application/json
                     application/manifest+json image/svg+xml;

    # Only HSTS, and "always" so it is also set on the error pages nginx
    # produces when the application is down. The remaining hardening headers -
    # Content-Security-Policy, X-Content-Type-Options, Referrer-Policy,
    # X-Frame-Options, Permissions-Policy - are set by the application itself:
    # it is the one place that knows its own bundle, and add_header appends
    # rather than replaces, so a second copy would reach the browser twice.
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    access_log /var/log/nginx/product-rating.access.log;
    error_log  /var/log/nginx/product-rating.error.log;
${
  subPath
    ? `
    # Without this a link to ${resolved.basePath} lands one directory too high: the
    # client resolves its own addresses against the prefix and needs the slash.
    location = ${resolved.basePath} {
        return 308 https://$host${resolved.basePath}/;
    }
`
    : ''
}
${proxyBlock}
}
`;
}

function renderApache(resolved: ResolvedProxyConfig): string {
  const upstream = upstreamAuthority(resolved.upstreamHost, resolved.upstreamPort);
  const subPath = resolved.basePath !== '';
  const prefix = subPath ? `${resolved.basePath}/` : '/';
  const bytes = resolved.maxBodyMb * 1024 * 1024;
  const certificate = resolved.certificate ?? letsEncryptCertificate(resolved.domain).certificate;
  const certificateKey = resolved.certificateKey ?? letsEncryptCertificate(resolved.domain).key;

  const redirect = `<VirtualHost *:80>
    ServerName ${resolved.domain}

    # Leave in place if certbot renews the certificate over HTTP-01.
    DocumentRoot /var/www/html
    <Location "/.well-known/acme-challenge/">
        ProxyPass "!"
    </Location>

    RedirectMatch permanent "^/(?!\\.well-known/acme-challenge/)(.*)" \\
        "https://${resolved.domain}/$1"
</VirtualHost>

`;

  return `${header(resolved, '#')}
#
#   a2enmod proxy proxy_http headers ssl deflate rewrite
#   cp product-rating.conf /etc/apache2/sites-available/product-rating.conf
#   a2ensite product-rating
#   apache2ctl configtest && systemctl reload apache2
#
${
  subPath
    ? `# This instance runs under ${resolved.basePath} of an existing host. If
# ${resolved.domain} already has a virtual host, move the directives between
# the ProxyPass lines into it instead of enabling a second one for the same
# name.
#
# The prefix has to be BUILT into the client as well; it sits in index.html, the
# manifest, the service worker and the API address, and no proxy can rewrite it
# afterwards:
#
#   PRODUCT_RATING_BASE_PATH=${resolved.basePath} npm run package:deb
#
`
    : `# The application answers the interface and /api/v1 from one process, so there
# is a single ProxyPass and no split into a static root and an API location.
# TLS ends here; the application speaks plain HTTP on ${upstream}.
#
`
}${agreementNotes(resolved, '#', 'the size limit below')}

${resolved.httpRedirect && !subPath ? redirect : ''}<VirtualHost *:443>
    ServerName ${resolved.domain}

    SSLEngine on
    SSLCertificateFile    ${certificate}
    SSLCertificateKeyFile ${certificateKey}
    SSLProtocol -all +TLSv1.2 +TLSv1.3

    ErrorLog  \${APACHE_LOG_DIR}/product-rating.error.log
    CustomLog \${APACHE_LOG_DIR}/product-rating.access.log combined

    # LimitRequestBody alone is NOT enough in front of a proxy: a request
    # handled by mod_proxy passes it by, at the virtual host as well as inside
    # a Location - the body is streamed to the backend without the core ever
    # counting it. It stays because it does cover what Apache serves itself.
    LimitRequestBody ${String(bytes)}

    # ... and this is what actually stops an oversized upload. The announced
    # length is checked before the body is read, and the answer is the 413 the
    # interface expects. Needs mod_rewrite. A client that sends no
    # Content-Length (chunked) slips past it; that is what the limit inside the
    # application is for, which then answers with a readable error.
    RewriteEngine On
    RewriteCond expr "-T req('Content-Length') && %{HTTP:Content-Length} -gt ${String(bytes)}"
    RewriteRule ^ - [R=413,L]

    # A photo travels over a slow uplink and is re-encoded by the application
    # afterwards. Both together outlast the default of 60 seconds.
    ProxyTimeout 120

    # The Host header of the browser is passed through, so the application logs
    # and links the name the client actually used.
    ProxyPreserveHost On

    # mod_proxy sets X-Forwarded-For and X-Forwarded-Host by itself, but not
    # this one - and without it the application would take the connection to
    # itself for plain HTTP.
    RequestHeader set X-Forwarded-Proto "https"

    # An id or a code in an address may be percent encoded, and a %2F in it has
    # to survive: NoDecode leaves it alone here, nocanon below stops mod_proxy
    # from normalising the address before it forwards.
    AllowEncodedSlashes NoDecode
${
  subPath
    ? `
    # Without this a link to ${resolved.basePath} lands one directory too high: the
    # client resolves its own addresses against the prefix and needs the slash.
    RedirectMatch permanent "^${resolved.basePath}$" "https://${resolved.domain}${resolved.basePath}/"
`
    : ''
}
${
  subPath
    ? `    # The trailing slash on the target is what strips the prefix: the
    # application keeps answering on / and /api/v1.
`
    : ''
}    ProxyPass        ${prefix} http://${upstream}/ nocanon timeout=120
    ProxyPassReverse ${prefix} http://${upstream}/

    # Compression for the bundle and the API answers. Images are WebP and
    # already compressed, so they stay out. Needs mod_deflate.
    AddOutputFilterByType DEFLATE text/html text/plain text/css \\
        application/javascript application/json application/manifest+json \\
        image/svg+xml

    # "always" so the header is set on error responses as well. Only HSTS is
    # left here: Content-Security-Policy, X-Content-Type-Options,
    # Referrer-Policy, X-Frame-Options and Permissions-Policy are set by the
    # application itself, which is the one place that knows its own bundle.
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"

    # No cache rules here, on purpose: the application sets Cache-Control
    # itself and is the only place that can tell an immutable file under
    # /assets/ from index.html, sw.js and the manifest, which keep their names
    # across releases and have to stay revalidated.
</VirtualHost>
`;
}

function renderCaddy(resolved: ResolvedProxyConfig): string {
  const upstream = upstreamAuthority(resolved.upstreamHost, resolved.upstreamPort);
  const subPath = resolved.basePath !== '';

  const tls =
    resolved.certificate === null
      ? `	# No certificate given, so Caddy obtains and renews one itself. That needs
	# the name to resolve to this host and ports 80 and 443 to reach it from
	# the internet. An instance that is only reachable inside the home network
	# gets "tls internal" instead - the root certificate then has to be trusted
	# on every device once, or the browser refuses access to the camera.`
      : `	# The certificate is provided, so Caddy neither obtains nor renews one. The
	# first file has to carry the full chain, and Caddy has to be able to read
	# both - it drops privileges to the caddy user.
	tls ${resolved.certificate} ${resolved.certificateKey ?? ''}`;

  const proxy = subPath
    ? `	# handle_path strips ${resolved.basePath} before forwarding, so the application
	# keeps answering on / and /api/v1.
	redir ${resolved.basePath} ${resolved.basePath}/ 308
	handle_path ${resolved.basePath}/* {
		reverse_proxy ${upstream} {
			health_uri /healthz
		}
	}`
    : `	reverse_proxy ${upstream} {
		health_uri /healthz
	}`;

  return `${header(resolved, '#')}
#
#   cp product-rating.caddy /etc/caddy/conf.d/product-rating.caddy
#   # and in /etc/caddy/Caddyfile, once:  import conf.d/*.caddy
#   caddy validate --config /etc/caddy/Caddyfile
#   systemctl reload caddy
#
# A host that serves nothing else can take this file as the whole Caddyfile.
${
  subPath
    ? `#
# The prefix has to be BUILT into the client as well; it sits in index.html, the
# manifest, the service worker and the API address:
#
#   PRODUCT_RATING_BASE_PATH=${resolved.basePath} npm run package:deb
`
    : ''
}#
# TLS ends here; the application speaks plain HTTP on ${upstream} and answers
# the interface and /api/v1 from one process. Caddy redirects HTTP to HTTPS and
# sets X-Forwarded-For, -Proto and -Host without being asked.
#
${agreementNotes(resolved, '#', 'request_body max_size')}

${resolved.domain} {
${tls}

${proxy}

	# At least uploads.max_file_size_mb of the application plus the overhead of
	# the multipart body. Too small a value ends the upload in the proxy, and
	# the interface only sees a broken connection.
	request_body {
		max_size ${String(resolved.maxBodyMb)}MB
	}

	# Images are WebP and already compressed; the bundle and the JSON answers
	# are what this is for.
	encode zstd gzip

	# Only HSTS. The remaining hardening headers and Cache-Control are set by
	# the application itself: it is the one place that knows its own bundle,
	# and the only one that can tell an immutable file under /assets/ from
	# index.html, sw.js and the manifest.
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
	}

	log {
		output file /var/log/caddy/product-rating.log
		format console
	}
}
`;
}

function renderTraefik(resolved: ResolvedProxyConfig): string {
  const upstream = upstreamAuthority(resolved.upstreamHost, resolved.upstreamPort);
  const subPath = resolved.basePath !== '';
  const bytes = resolved.maxBodyMb * 1024 * 1024;

  const rule = subPath
    ? `'Host(\`${resolved.domain}\`) && PathPrefix(\`${resolved.basePath}\`)'`
    : `'Host(\`${resolved.domain}\`)'`;

  const middlewares = ['product-rating-headers', 'product-rating-body'];
  if (subPath) middlewares.unshift('product-rating-prefix');

  const tlsRouter =
    resolved.certificate === null
      ? `      tls:
        certResolver: letsencrypt`
      : `      # The certificate comes from the tls section at the end of this file;
      # an empty tls block is what turns the router into an HTTPS one.
      tls: {}`;

  const tlsSection =
    resolved.certificate === null
      ? `
# No certificate given, so the router above asks a certificate resolver named
# letsencrypt. It has to exist in the STATIC configuration
# (/etc/traefik/traefik.yml):
#
#   certificatesResolvers:
#     letsencrypt:
#       acme:
#         email: admin@${resolved.domain}
#         storage: /var/lib/traefik/acme.json
#         httpChallenge:
#           entryPoint: web
`
      : `
tls:
  certificates:
    - certFile: ${resolved.certificate}
      keyFile: ${resolved.certificateKey ?? ''}
      stores:
        - default
`;

  const prefixMiddleware = subPath
    ? `
    # Strips ${resolved.basePath} before forwarding, so the application keeps
    # answering on / and /api/v1.
    product-rating-prefix:
      stripPrefix:
        prefixes:
          - '${resolved.basePath}'
`
    : '';

  return `${header(resolved, '#')}
#
#   cp product-rating.yml /etc/traefik/dynamic/product-rating.yml
#
# Traefik watches the directory and picks the file up without a restart; a
# mistake in it is reported in the log and leaves the previous state running.
#
# The matching part of the STATIC configuration, which cannot come from a
# dynamic file:
#
#   entryPoints:
#     web:
#       address: ":80"
#       http:
#         redirections:
#           entryPoint:
#             to: websecure
#             scheme: https
#     websecure:
#       address: ":443"
#   providers:
#     file:
#       directory: /etc/traefik/dynamic
#       watch: true
${
  subPath
    ? `#
# The prefix has to be BUILT into the client as well; it sits in index.html, the
# manifest, the service worker and the API address:
#
#   PRODUCT_RATING_BASE_PATH=${resolved.basePath} npm run package:deb
`
    : ''
}#
# TLS ends in Traefik; the application speaks plain HTTP on ${upstream}.
# Traefik sets X-Forwarded-For, -Proto and -Host by itself.
#
${agreementNotes(resolved, '#', 'buffering maxRequestBodyBytes')}
#
# For containers next to Traefik the same settings exist as labels; see
# packaging/examples/traefik/docker-compose.labels.yml.

http:
  routers:
    product-rating:
      rule: ${rule}
      entryPoints:
        - websecure
      service: product-rating
      middlewares:
${middlewares.map((name) => `        - ${name}`).join('\n')}
${tlsRouter}

  services:
    product-rating:
      loadBalancer:
        servers:
          - url: 'http://${upstream}'
        # The Host header of the browser reaches the application, so it logs
        # and links the name the client actually used.
        passHostHeader: true
        healthCheck:
          path: /healthz
          interval: '30s'
          timeout: '5s'

  middlewares:${prefixMiddleware}
    # Only HSTS. The remaining hardening headers and Cache-Control are set by
    # the application itself: it is the one place that knows its own bundle,
    # and the only one that can tell an immutable file under /assets/ from
    # index.html, sw.js and the manifest.
    product-rating-headers:
      headers:
        stsSeconds: 31536000
        stsIncludeSubdomains: true

    # At least uploads.max_file_size_mb of the application plus the overhead of
    # the multipart body; anything above is answered with 413 before the
    # application sees it. Buffering means Traefik holds the request until it
    # is complete: up to memRequestBodyBytes in memory, the rest in a temporary
    # file. That is the price of the limit.
    product-rating-body:
      buffering:
        maxRequestBodyBytes: ${String(bytes)}
        memRequestBodyBytes: 2097152
${tlsSection}`;
}

/** The name a generated file gets when `--out` names a directory. */
const FILENAMES: Record<ProxyTarget, string> = {
  nginx: 'product-rating.conf',
  apache: 'product-rating.conf',
  caddy: 'product-rating.caddy',
  traefik: 'product-rating.yml',
};

/** Writes out the configuration of one target. */
export function renderProxyConfig(resolved: ResolvedProxyConfig): GeneratedProxyConfig {
  const renderers: Record<ProxyTarget, (value: ResolvedProxyConfig) => string> = {
    nginx: renderNginx,
    apache: renderApache,
    caddy: renderCaddy,
    traefik: renderTraefik,
  };

  return {
    filename: FILENAMES[resolved.target],
    content: renderers[resolved.target](resolved),
  };
}
