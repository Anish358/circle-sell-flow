import { describe, expect, it } from "vitest"

import { searchTerms } from "./search"

/**
 * The predicate builder itself is exercised against a real Postgres in
 * `search.db.test.ts` — an assertion about generated SQL strings would test the query
 * builder rather than the behaviour, and the behaviour is what the escaping is for.
 *
 * What is worth unit-testing here is the part with no database in it: turning a typed
 * query into the words a row has to contain, and refusing to let a pathological one
 * through.
 */

describe("searchTerms", () => {
  it("splits on whitespace, so word order does not matter", () => {
    expect(searchTerms("13 iphone")).toEqual(["13", "iphone"])
  })

  it("collapses padding and repeated spaces", () => {
    expect(searchTerms("  leather   sofa ")).toEqual(["leather", "sofa"])
  })

  it("treats nothing typed as no search at all", () => {
    // The distinction matters: an empty term list means "no predicate", not "match rows
    // containing an empty string" — which every row does.
    expect(searchTerms("")).toEqual([])
    expect(searchTerms("   ")).toEqual([])
    expect(searchTerms(null)).toEqual([])
    expect(searchTerms(undefined)).toEqual([])
  })

  it("ignores a value that is not a string, since it comes from a URL", () => {
    expect(searchTerms(["a", "b"] as unknown as string)).toEqual([])
  })

  it("bounds how much work one query can ask for", () => {
    // A URL is untrusted input, and each term becomes its own ILIKE across every
    // searched column.
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(6)
    expect(searchTerms("x".repeat(200))[0]).toHaveLength(40)
  })

  it("keeps the characters a person actually types", () => {
    // Escaping happens at the SQL boundary, not here — a term stays what was typed so
    // it can be shown back in "Nothing matches …".
    expect(searchTerms("50% off")).toEqual(["50%", "off"])
  })
})
