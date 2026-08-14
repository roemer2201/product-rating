/**
 * A small in-memory rate limiter for the login route.
 *
 * The application is a single process with a handful of users, so a shared
 * store would be needless machinery. Counters are kept per key in a fixed
 * window of one minute; failed attempts count, successful logins reset the
 * key so a legitimate user is never locked out by their own typing.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets; only meaningful when blocked. */
  retryAfterSeconds: number;
  /** Attempts left in the current window. */
  remaining: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(limit: number, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Checks a key without counting an attempt against it. */
  check(key: string, now: number = Date.now()): RateLimitDecision {
    const bucket = this.buckets.get(key);

    if (bucket === undefined || bucket.resetAt <= now) {
      return { allowed: true, retryAfterSeconds: 0, remaining: this.limit };
    }

    const remaining = Math.max(0, this.limit - bucket.count);
    return {
      allowed: remaining > 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining,
    };
  }

  /** Counts a failed attempt and reports the state afterwards. */
  consume(key: string, now: number = Date.now()): RateLimitDecision {
    const bucket = this.buckets.get(key);

    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0, remaining: this.limit - 1 };
    }

    bucket.count += 1;
    const remaining = Math.max(0, this.limit - bucket.count);
    return {
      allowed: remaining > 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining,
    };
  }

  /** Clears a key, used after a successful login. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Drops expired buckets so the map cannot grow without bound. */
  sweep(now: number = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** Number of tracked keys; used by tests and the sweep job. */
  get size(): number {
    return this.buckets.size;
  }
}
