/**
 * A small sliding-window rate limiter, held in memory.
 *
 * **What this is honestly worth.** The process is a serverless function, so this state is
 * per-instance and vanishes on a cold start: it reliably stops one runaway client — a
 * retry loop, a stuck submit button, someone holding down Enter — and it does not stop a
 * determined attacker spreading requests across instances. That is the difference between
 * a safety valve and a security control, and the right response is to say which one this
 * is rather than to leave the endpoint with nothing on it.
 *
 * The production version is the same shape against a shared store — Redis, or Postgres if
 * a round trip per write is acceptable — and only `hits` changes. Keeping the policy
 * (which key, how many, how long) here rather than in the route means swapping the store
 * touches one file.
 *
 * A sliding window rather than a fixed one: a fixed window lets a client spend its whole
 * allowance at 11:59:59 and the next one at 12:00:00, which is twice the intended rate at
 * exactly the moment a retry storm produces it.
 */

export type RateLimitResult =
  { ok: true; remaining: number } | { ok: false; remaining: 0; retryAfterSeconds: number }

export type RateLimiter = (key: string, now?: number) => RateLimitResult

/**
 * `maxKeys` bounds memory: without it, one key per seller id is one slow leak, and one
 * key per spoofable value would be a way to exhaust the instance. Eviction is
 * least-recently-used by insertion order, which a `Map` gives for free.
 */
export function createRateLimiter(options: {
  limit: number
  windowMs: number
  maxKeys?: number
}): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000 } = options
  const hits = new Map<string, number[]>()

  return function check(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - windowMs
    const recent = (hits.get(key) ?? []).filter((at) => at > cutoff)

    if (recent.length >= limit) {
      // The oldest hit in the window is the one whose expiry frees a slot.
      const oldest = recent[0] ?? now
      hits.set(key, recent)
      return {
        ok: false,
        remaining: 0,
        // Rounded up, so a client that obeys it is never turned away a second time for
        // being a few milliseconds early.
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      }
    }

    recent.push(now)
    // Re-inserting moves the key to the end of the Map's ordering, so eviction below
    // drops genuinely idle keys rather than merely old ones.
    hits.delete(key)
    hits.set(key, recent)

    if (hits.size > maxKeys) {
      const oldestKey = hits.keys().next().value
      if (oldestKey !== undefined) hits.delete(oldestKey)
    }

    return { ok: true, remaining: limit - recent.length }
  }
}

/**
 * Creating listings: generous enough that no honest seller meets it — publishing is a
 * deliberate act at the end of a multi-step form — and low enough that a loop is stopped
 * before it fills the table.
 *
 * Keyed by seller id, not IP: the id comes from the session and cannot be spoofed by a
 * header, and it is the thing being protected. An IP key would also punish everyone
 * behind one mobile carrier NAT.
 */
export const listingCreateLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 })
