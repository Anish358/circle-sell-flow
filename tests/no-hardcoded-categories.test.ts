import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Invariant #1 — there is exactly one form renderer.
 *
 * The brief states the prohibition outright: "Avoid creating separate hard-coded
 * forms for individual categories." This test is the mechanical proof that we
 * haven't. If a category name ever appears in application code, someone has
 * started special-casing and the build fails.
 *
 * Sample data and tests are exempt: they are *supposed* to name real categories.
 */
const CATEGORY_NAMES = /\b(phones?|laptops?|sofas?|tablets?|electronics|furniture)\b/i

// Paths (matched as substrings of the repo-relative path) allowed to name categories.
const EXEMPT_PATHS = [
  "src/db/seed", // sample data — the whole point is that it names real categories
  ".test.ts", // fixtures, including this file
]

const SOURCE_EXTENSIONS = [".ts", ".tsx"]

function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext)))
    .map((path) => join(root, path))
}

describe("invariant: no category is named in application code", () => {
  it("finds no category name in src/", () => {
    const offenders = sourceFiles("src")
      .filter((path) => !EXEMPT_PATHS.some((exempt) => path.includes(exempt)))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .map((line, index) => ({ path, line: index + 1, text: line }))
          .filter(({ text }) => CATEGORY_NAMES.test(text))
          .map(({ path: p, line, text }) => `${p}:${line}  ${text.trim()}`),
      )

    expect(offenders).toEqual([])
  })

  it("would catch an offender", () => {
    // Guards the guard: proves the pattern actually matches, so a broken regex
    // can't turn this suite into a silent pass.
    expect(CATEGORY_NAMES.test('if (category.slug === "mobile-phone") {')).toBe(true)
  })
})
