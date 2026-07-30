import { describe, expect, it } from "vitest"

import { listingCondition } from "@/db/schema"
import { CONDITIONS, basicsStepSchema, priceStepSchema } from "./input-schema"

describe("CONDITIONS", () => {
  it("matches the database enum exactly, in the same order", () => {
    // The list is duplicated so the client bundle does not have to import the query
    // builder. This test is what makes the duplication safe: add a value to the
    // Postgres enum without adding it here and the suite fails.
    expect(CONDITIONS.map((condition) => condition.value)).toEqual([...listingCondition.enumValues])
  })

  it("gives every value wording a seller can act on", () => {
    for (const condition of CONDITIONS) {
      expect(condition.label.length).toBeGreaterThan(0)
      expect(condition.hint.length).toBeGreaterThan(0)
    }
  })
})

describe("step schemas", () => {
  it("rejects a whitespace-only title, which a NOT NULL check would accept", () => {
    const result = basicsStepSchema.safeParse({ title: "   ", city: "Pune" })
    expect(result.success).toBe(false)
  })

  it("requires a city, because a marketplace listing without one cannot be collected", () => {
    expect(basicsStepSchema.safeParse({ title: "A good sofa", city: "" }).success).toBe(false)
  })

  it("treats description as optional", () => {
    expect(basicsStepSchema.safeParse({ title: "A good sofa", city: "Pune" }).success).toBe(true)
  })

  it("rejects a price of zero or less", () => {
    for (const priceRupees of [0, -1]) {
      expect(priceStepSchema.safeParse({ condition: "good", priceRupees }).success).toBe(false)
    }
  })

  it("rejects a condition that is not one of the offered values", () => {
    const result = priceStepSchema.safeParse({ condition: "pristine", priceRupees: 100 })
    expect(result.success).toBe(false)
  })
})
