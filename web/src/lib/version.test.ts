import { describe, expect, it } from 'vitest';
import { APP_VERSION, compareVersions } from '@/lib/version';
import { repositorySourceUrl } from '@/lib/sourceUrl';
import webPackage from '../../package.json';

describe('source address', () => {
  it('links to the repository of this project', () => {
    expect(repositorySourceUrl(webPackage.repository.url)).toBe(
      'https://github.com/roemer2201/product-rating',
    );
  });

  it('links to the repository of a fork', () => {
    expect(repositorySourceUrl('git+https://example.org/household/catalogue.git')).toBe(
      'https://example.org/household/catalogue',
    );
  });
});

describe('version', () => {
  it('is the version of the web package', () => {
    expect(APP_VERSION).toBe(webPackage.version);
  });

  it('compares versions by number, not by text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0', '0.5.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3-rc.1', '1.2.3')).toBe(0);
  });
});
