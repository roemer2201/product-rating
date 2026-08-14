import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimit.js';

describe('RateLimiter', () => {
  it('blocks once the configured number of attempts is used up', () => {
    const limiter = new RateLimiter(3);

    expect(limiter.check('ip:1').allowed).toBe(true);
    limiter.consume('ip:1');
    limiter.consume('ip:1');
    expect(limiter.check('ip:1').allowed).toBe(true);

    limiter.consume('ip:1');
    const blocked = limiter.check('ip:1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('keeps keys apart', () => {
    const limiter = new RateLimiter(1);
    limiter.consume('ip:1');

    expect(limiter.check('ip:1').allowed).toBe(false);
    expect(limiter.check('ip:2').allowed).toBe(true);
  });

  it('starts a fresh window after a minute', () => {
    const limiter = new RateLimiter(1);
    const start = 1_000_000;

    limiter.consume('user:anna', start);
    expect(limiter.check('user:anna', start + 30_000).allowed).toBe(false);
    expect(limiter.check('user:anna', start + 61_000).allowed).toBe(true);
  });

  it('forgets a key after a successful attempt', () => {
    const limiter = new RateLimiter(2);
    limiter.consume('user:anna');
    limiter.consume('user:anna');
    expect(limiter.check('user:anna').allowed).toBe(false);

    limiter.reset('user:anna');
    expect(limiter.check('user:anna').allowed).toBe(true);
  });

  it('drops stale buckets when swept', () => {
    const limiter = new RateLimiter(5);
    const start = 1_000_000;

    limiter.consume('a', start);
    limiter.consume('b', start + 59_000);
    expect(limiter.size).toBe(2);

    limiter.sweep(start + 61_000);
    expect(limiter.size).toBe(1);
  });
});
