import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config/index.js';
import type { AppConfig } from '../config/index.js';
import {
  normaliseBasePath,
  parseProxyTarget,
  renderProxyConfig,
  resolveProxyConfig,
  type ProxyConfigOptions,
  type ProxyTarget,
} from './proxyConfig.js';

/**
 * The generated proxy configurations. What matters is that the values of the
 * instance really arrive in the file — a template with a placeholder left in
 * it is worse than no template, because it looks finished.
 */

function configuration(overrides: Record<string, unknown> = {}): AppConfig {
  return parseConfig({
    server: { base_url: 'https://produkte.example.org', port: 8080, ...overrides },
    uploads: { max_file_size_mb: 15 },
  });
}

function render(options: ProxyConfigOptions, config: AppConfig = configuration()): string {
  return renderProxyConfig(resolveProxyConfig(config, options)).content;
}

describe('the target names', () => {
  it('knows the four web servers and the usual other spellings', () => {
    expect(parseProxyTarget('nginx')).toBe('nginx');
    expect(parseProxyTarget('Apache2')).toBe('apache');
    expect(parseProxyTarget(' httpd ')).toBe('apache');
    expect(parseProxyTarget('caddy')).toBe('caddy');
    expect(parseProxyTarget('traefik')).toBe('traefik');
    expect(parseProxyTarget('lighttpd')).toBeUndefined();
  });
});

describe('the values taken from the configuration', () => {
  it('reads host name, path, address and size limit out of it', () => {
    const resolved = resolveProxyConfig(
      configuration({ base_url: 'https://heim.example.org/produkte', host: '0.0.0.0', port: 9090 }),
      { target: 'nginx' },
    );

    expect(resolved.domain).toBe('heim.example.org');
    expect(resolved.basePath).toBe('/produkte');
    expect(resolved.upstreamPort).toBe(9090);
    // Five megabytes of head room over the limit of the application, so an
    // upload that is a little too large is refused by the application with a
    // readable error instead of by the proxy with a bare 413.
    expect(resolved.maxBodyMb).toBe(20);
    expect(resolved.baseUrl).toBe('https://heim.example.org/produkte');
  });

  it('lets every value be overridden', () => {
    const resolved = resolveProxyConfig(configuration(), {
      target: 'nginx',
      domain: 'anders.example.org',
      basePath: '/app/',
      upstreamHost: '10.0.0.5',
      upstreamPort: 8081,
      certificate: '/etc/ssl/certs/own.pem',
      certificateKey: '/etc/ssl/private/own.key',
      maxBodyMb: 64,
    });

    expect(resolved).toMatchObject({
      domain: 'anders.example.org',
      basePath: '/app',
      upstreamHost: '10.0.0.5',
      upstreamPort: 8081,
      certificate: '/etc/ssl/certs/own.pem',
      maxBodyMb: 64,
      baseUrl: 'https://anders.example.org/app',
    });
  });

  it('normalises a base path and treats the root as no path at all', () => {
    expect(normaliseBasePath('/')).toBe('');
    expect(normaliseBasePath('')).toBe('');
    expect(normaliseBasePath('produkte/')).toBe('/produkte');
    expect(normaliseBasePath('/produkte/')).toBe('/produkte');
  });

  it('guesses the certbot paths for nginx and Apache, and nothing for the other two', () => {
    const nginx = resolveProxyConfig(configuration(), { target: 'nginx' });
    expect(nginx.certificate).toBe('/etc/letsencrypt/live/produkte.example.org/fullchain.pem');
    expect(nginx.certificateKey).toBe('/etc/letsencrypt/live/produkte.example.org/privkey.pem');

    // Caddy and Traefik obtain one themselves; a guess would take that away.
    expect(resolveProxyConfig(configuration(), { target: 'caddy' }).certificate).toBeNull();
    expect(resolveProxyConfig(configuration(), { target: 'traefik' }).certificate).toBeNull();
  });
});

describe('nginx', () => {
  it('carries host name, certificate, address and limit', () => {
    const content = render({
      target: 'nginx',
      certificate: '/etc/ssl/certs/own.pem',
      certificateKey: '/etc/ssl/private/own.key',
    });

    expect(content).toContain('server_name produkte.example.org;');
    expect(content).toContain('ssl_certificate     /etc/ssl/certs/own.pem;');
    expect(content).toContain('ssl_certificate_key /etc/ssl/private/own.key;');
    expect(content).toContain('server 127.0.0.1:8080;');
    expect(content).toContain('client_max_body_size 20m;');
    expect(content).toContain('proxy_pass http://product_rating;');
    // The plain HTTP host that sends the browser on, and the challenge of
    // certbot that has to stay reachable on it.
    expect(content).toContain('listen 80;');
    expect(content).toContain('/.well-known/acme-challenge/');
  });

  it('leaves the plain HTTP host out when it is not wanted', () => {
    expect(render({ target: 'nginx', httpRedirect: false })).not.toContain('listen 80;');
  });

  it('strips the prefix under a base path and sends the bare path on', () => {
    const content = render({ target: 'nginx', basePath: '/produkte' });

    expect(content).toContain('location /produkte/ {');
    // The trailing slash of proxy_pass is what removes /produkte again.
    expect(content).toContain('proxy_pass http://product_rating/;');
    expect(content).toContain('location = /produkte {');
    expect(content).toContain('return 308 https://$host/produkte/;');
    // The prefix belongs to a host that exists already, so no redirect host of
    // our own is written for it.
    expect(content).not.toContain('listen 80;');
  });
});

describe('apache', () => {
  it('carries the certificate, the two size limits and the proxy settings', () => {
    const content = render({
      target: 'apache',
      certificate: '/etc/ssl/certs/own.pem',
      certificateKey: '/etc/ssl/private/own.key',
    });

    expect(content).toContain('SSLCertificateFile    /etc/ssl/certs/own.pem');
    expect(content).toContain('SSLCertificateKeyFile /etc/ssl/private/own.key');
    expect(content).toContain('LimitRequestBody 20971520');
    // LimitRequestBody does not apply to a proxied request; the rewrite is
    // what actually answers 413.
    expect(content).toContain('-gt 20971520');
    expect(content).toContain('ProxyPass        / http://127.0.0.1:8080/ nocanon timeout=120');
    expect(content).toContain('RequestHeader set X-Forwarded-Proto "https"');
    expect(content).toContain('${APACHE_LOG_DIR}/product-rating.error.log');
  });

  it('proxies the prefix under a base path', () => {
    const content = render({ target: 'apache', basePath: '/produkte' });

    expect(content).toContain('ProxyPass        /produkte/ http://127.0.0.1:8080/');
    expect(content).toContain('ProxyPassReverse /produkte/ http://127.0.0.1:8080/');
    expect(content).not.toContain('<VirtualHost *:80>');
  });
});

describe('caddy', () => {
  it('leaves the certificate to Caddy when none is given', () => {
    const content = render({ target: 'caddy' });

    expect(content).toContain('produkte.example.org {');
    expect(content).toContain('reverse_proxy 127.0.0.1:8080 {');
    expect(content).toContain('max_size 20MB');
    expect(content).not.toContain('\ttls ');
  });

  it('uses the given files instead of asking a certificate authority', () => {
    const content = render({
      target: 'caddy',
      certificate: '/etc/ssl/certs/own.pem',
      certificateKey: '/etc/ssl/private/own.key',
    });

    expect(content).toContain('tls /etc/ssl/certs/own.pem /etc/ssl/private/own.key');
  });

  it('strips the prefix with handle_path under a base path', () => {
    const content = render({ target: 'caddy', basePath: '/produkte' });

    expect(content).toContain('handle_path /produkte/* {');
    expect(content).toContain('redir /produkte /produkte/ 308');
  });
});

describe('traefik', () => {
  it('asks the certificate resolver when no file is given', () => {
    const content = render({ target: 'traefik' });

    expect(content).toContain("rule: 'Host(`produkte.example.org`)'");
    expect(content).toContain("- url: 'http://127.0.0.1:8080'");
    expect(content).toContain('maxRequestBodyBytes: 20971520');
    expect(content).toContain('certResolver: letsencrypt');
    expect(content).not.toContain('certFile:');
  });

  it('names the certificate files when they are given', () => {
    const content = render({
      target: 'traefik',
      certificate: '/etc/ssl/certs/own.pem',
      certificateKey: '/etc/ssl/private/own.key',
    });

    expect(content).toContain('certFile: /etc/ssl/certs/own.pem');
    expect(content).toContain('keyFile: /etc/ssl/private/own.key');
    // An empty tls block is what makes the router an HTTPS one; the
    // certificate itself comes out of the store.
    expect(content).toContain('tls: {}');
    expect(content).not.toContain('certResolver');
  });

  it('matches the prefix and strips it again', () => {
    const content = render({ target: 'traefik', basePath: '/produkte' });

    expect(content).toContain('PathPrefix(`/produkte`)');
    expect(content).toContain('stripPrefix:');
    expect(content).toContain('- product-rating-prefix');
  });
});

describe('every target', () => {
  const targets: ProxyTarget[] = ['nginx', 'apache', 'caddy', 'traefik'];

  it('says what the application has to be configured with, and gets a file name', () => {
    for (const target of targets) {
      const generated = renderProxyConfig(resolveProxyConfig(configuration(), { target }));

      expect(generated.filename).toMatch(/^(product-rating\.(conf|caddy|yml))$/);
      expect(generated.content).toContain('server.base_url = https://produkte.example.org');
      expect(generated.content).toContain('server.trust_proxy = true');
      // Only HSTS - Traefik spells it as an option, the other three as the
      // header. Every other hardening header belongs to the application.
      expect(
        generated.content.includes('Strict-Transport-Security') ||
          generated.content.includes('stsSeconds'),
      ).toBe(true);
      expect(generated.content).not.toContain('Content-Security-Policy:');
      // Nothing that is left to be filled in by hand.
      expect(generated.content).not.toContain('example.com');
      expect(generated.content.endsWith('\n')).toBe(true);
    }
  });

  it('brackets an IPv6 address of the application', () => {
    for (const target of targets) {
      const content = render({ target, upstreamHost: '::1', upstreamPort: 8080 });
      expect(content).toContain('[::1]:8080');
    }
  });
});
