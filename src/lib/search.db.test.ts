import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { db } from "@/db"
import { matchesAllTerms, searchTerms } from "./search"

/**
 * Search against a real Postgres, because the two things most likely to be wrong are
 * both SQL-level: whether `ILIKE` wildcards a user typed are escaped, and whether the
 * escape character is declared so that the escaping actually takes effect.
 *
 * Run with `npm run test:db`.
 */

/** Runs a search over a fixed set of literal rows, returning the ones that match. */
async function matching(values: string[], query: string): Promise<string[]> {
  const terms = searchTerms(query)
  const predicate = matchesAllTerms(terms, [sql`v.value`])

  const rows = await db.execute<{ value: string }>(sql`
    SELECT v.value
      FROM (VALUES ${sql.join(
        values.map((value) => sql`(${value})`),
        sql`, `,
      )}) AS v(value)
     WHERE ${predicate ?? sql`true`}
     ORDER BY v.value
  `)

  return rows.map((row) => row.value)
}

const TITLES = [
  "Apple iPhone 13 128GB",
  "Samsung Galaxy S22 256GB",
  "Three-seater fabric sofa",
  "50% cotton throw",
  "iphone_case bundle",
]

describe("matchesAllTerms", () => {
  it("matches a substring, case-insensitively", async () => {
    expect(await matching(TITLES, "iphone")).toEqual([
      "Apple iPhone 13 128GB",
      "iphone_case bundle",
    ])
  })

  it("requires every word, in any order", async () => {
    expect(await matching(TITLES, "13 iphone")).toEqual(["Apple iPhone 13 128GB"])
    expect(await matching(TITLES, "iphone galaxy")).toEqual([])
  })

  it("treats % as a character, not a wildcard", async () => {
    // Unescaped, `%` would match every row — the failure is silent and looks like the
    // search being broken rather than too permissive.
    expect(await matching(TITLES, "50%")).toEqual(["50% cotton throw"])
    expect(await matching(TITLES, "%")).toEqual(["50% cotton throw"])
  })

  it("treats _ as a character, not a single-character wildcard", async () => {
    // `iphone_case` must not be found by "iphone case", and vice versa.
    expect(await matching(TITLES, "iphone_case")).toEqual(["iphone_case bundle"])
    expect(await matching(TITLES, "iphone 13")).toEqual(["Apple iPhone 13 128GB"])
  })

  it("treats a backslash as a character", async () => {
    expect(await matching(["a\\b", "ab"], "a\\b")).toEqual(["a\\b"])
  })

  it("returns no predicate when there is nothing to search for", () => {
    expect(matchesAllTerms([], [sql`x`])).toBeUndefined()
    expect(matchesAllTerms(["a"], [])).toBeUndefined()
  })
})
