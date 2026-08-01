import { describe, expect, it } from "vitest"

import { createRateLimiter } from "./rate-limit"

/**
 * Time is injected rather than mocked globally, so these are ordinary synchronous
 * assertions about a sliding window — no timers, no waiting, and no flakiness on a
 * loaded CI machine.
 */

describe("createRateLimiter", () => {
  it("allows up to the limit and refuses the next one", () => {
    const check = createRateLimiter({ limit: 3, windowMs: 1000 })

    expect(check("a", 0).ok).toBe(true)
    expect(check("a", 100).ok).toBe(true)
    expect(check("a", 200).ok).toBe(true)
    expect(check("a", 300).ok).toBe(false)
  })

  it("keeps one caller's budget away from another's", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 1000 })

    expect(check("a", 0).ok).toBe(true)
    expect(check("b", 0).ok).toBe(true)
    expect(check("a", 1).ok).toBe(false)
  })

  it("slides: the oldest hit expiring frees exactly one slot", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 1000 })

    check("a", 0)
    check("a", 900)
    expect(check("a", 950).ok).toBe(false)

    // 1001 is past the first hit's window but not the second's, so one slot is free.
    expect(check("a", 1001).ok).toBe(true)
    expect(check("a", 1002).ok).toBe(false)
  })

  it("reports when to come back, rounded up so an obedient client is not refused twice", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 1000 })

    check("a", 0)
    const refused = check("a", 100)

    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.retryAfterSeconds).toBe(1)
  })

  it("bounds its memory, evicting the least recently used key", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 })

    check("a", 0)
    check("b", 1)
    // "a" is the least recently used, so admitting "c" evicts it.
    check("c", 2)

    // The keys still held keep their spent budget...
    expect(check("c", 3).ok).toBe(false)
    // ...and the evicted one starts again, which is the cost of bounding memory and
    // the reason the limit is a safety valve rather than a guarantee.
    expect(check("a", 4).ok).toBe(true)
  })
})
