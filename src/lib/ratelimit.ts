/**
 * §10.3 / §10.8 rate limiting.
 *
 * An in-memory Map is sufficient: one Vercel instance and 70 users do not need
 * Redis, and Redis would be a paid dependency. [R12]
 */

type Bucket = { count: number; resetAt: number };

const g = globalThis as typeof globalThis & { __onmicLimits?: Map<string, Bucket> };

function store(): Map<string, Bucket> {
  if (!g.__onmicLimits) g.__onmicLimits = new Map();
  return g.__onmicLimits;
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const map = store();

  // Opportunistic sweep so a long-running instance does not grow unbounded.
  if (map.size > 5000) {
    for (const [k, v] of map) if (v.resetAt <= now) map.delete(k);
  }

  const hit = map.get(key);
  if (!hit || hit.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (hit.count >= limit) return false;
  hit.count += 1;
  return true;
}
