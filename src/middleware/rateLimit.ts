import type { Request, Response, NextFunction } from "express";

/**
 * Minimal dependency-free per-IP fixed-window rate limiter for the public,
 * unauthenticated endpoints (challenge/register/sign-in). Bounds abuse such as
 * challenge-map growth, registration spam, and gas-drip pressure. State is
 * in-memory and per-process, which is sufficient for these low-volume routes;
 * move to Redis if the node is horizontally scaled.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Namespace so different route groups get independent buckets. */
  name?: string;
}

/**
 * Rate limiting is disabled under test (the suite drives many requests from one
 * IP in-process) and via an explicit env override for local/dev use.
 */
function rateLimitDisabled(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.RATE_LIMIT_DISABLED === "true" ||
    process.env.RATE_LIMIT_DISABLED === "1"
  );
}

export function rateLimit(opts: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  const sweep = (now: number): void => {
    if (now - lastSweep < opts.windowMs) return;
    lastSweep = now;
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (rateLimitDisabled()) {
      next();
      return;
    }
    const now = Date.now();
    sweep(now);

    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const key = `${opts.name ?? "rl"}:${ip}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res
        .status(429)
        .json({ error: "Too many requests. Please slow down and try again." });
      return;
    }

    next();
  };
}
