import type { ContactRateLimiter, MemoryRateLimiterOptions } from "./types.js";

const DEFAULT_MAX_KEYS = 10_000;

function requirePositiveSafeInteger(name: string, value: unknown): number {
  if (typeof value !== "number") throw new TypeError(`createMemoryRateLimiter: ${name} must be a number`);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`createMemoryRateLimiter: ${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * In-memory sliding-window limiter: one log of use times per key.
 *
 * `check(key)` discards that key's uses at or before `now - windowMs`, then
 * records `now` and answers `true` only while fewer than `limit` remain. A
 * denied check records nothing, so a client that keeps trying recovers on
 * schedule. Single process only: every instance holds its own windows.
 *
 * Bounded by `maxKeys`, never by forgetting a live window. A new key that
 * arrives with the store full first prunes keys whose every use has expired,
 * and is denied if the store is still full. The prune is a scan of the store,
 * so cost at capacity is O(`maxKeys` x `limit`) per new key.
 *
 * A clock that moves backwards never grants extra uses: the log is filtered by
 * time rather than trimmed from the front, so recorded times later than `now`
 * still count. A `now()` that is not a finite number makes `check` throw
 * before anything is read or recorded.
 */
export function createMemoryRateLimiter(options: MemoryRateLimiterOptions): ContactRateLimiter {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("createMemoryRateLimiter: options must be an object");
  }
  const limit = requirePositiveSafeInteger("limit", options.limit);
  const maxKeys = options.maxKeys === undefined ? DEFAULT_MAX_KEYS : requirePositiveSafeInteger("maxKeys", options.maxKeys);
  const windowMs: unknown = options.windowMs;
  if (typeof windowMs !== "number") throw new TypeError("createMemoryRateLimiter: windowMs must be a number");
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError("createMemoryRateLimiter: windowMs must be a positive finite number");
  }
  const now: unknown = options.now;
  if (typeof now !== "function") throw new TypeError("createMemoryRateLimiter: now must be a function");

  const usesByKey = new Map<string, number[]>();

  return {
    check(key) {
      const t: unknown = now();
      if (typeof t !== "number" || !Number.isFinite(t)) {
        throw new TypeError("createMemoryRateLimiter: now() must return a finite number");
      }
      const cutoff = t - windowMs;

      const recorded = usesByKey.get(key);
      if (recorded === undefined) {
        if (usesByKey.size >= maxKeys) {
          for (const [otherKey, otherUses] of usesByKey) {
            if (otherUses.every((use) => use <= cutoff)) usesByKey.delete(otherKey);
          }
          if (usesByKey.size >= maxKeys) return false;
        }
        usesByKey.set(key, [t]);
        return true;
      }

      const live = recorded.filter((use) => use > cutoff);
      if (live.length >= limit) {
        // Denied: keep only what is still live, record nothing.
        usesByKey.set(key, live);
        return false;
      }
      live.push(t);
      usesByKey.set(key, live);
      return true;
    },
  };
}
