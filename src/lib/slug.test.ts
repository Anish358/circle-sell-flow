import { describe, expect, it } from "vitest"

import { slugify } from "./slug"

/** The database constrains slugs to this, so every result must match it. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe("slugify", () => {
  const cases: Array<[string, string, string]> = [
    ["lowercases and hyphenates", "Samsung Galaxy S22", "samsung-galaxy-s22"],
    ["collapses runs of punctuation", "MacBook Air — M2 / 512GB!", "macbook-air-m2-512gb"],
    ["strips accents rather than the letter", "Café Table", "cafe-table"],
    ["drops leading and trailing separators", "  ...Sofa...  ", "sofa"],
    ["keeps digits", "iPhone 13 128GB", "iphone-13-128gb"],
  ]

  it.each(cases)("%s", (_name, title, expected) => {
    expect(slugify(title)).toBe(expected)
  })

  it("produces a legal slug for scripts with no ASCII at all", () => {
    // Sellers write titles in Devanagari; the result must still satisfy the
    // constraint rather than failing the insert.
    expect(slugify("सोफा सेट")).toMatch(SLUG_PATTERN)
  })

  it("produces a legal slug for a title of only emoji", () => {
    // Everything is stripped, so a fallback is the only way to satisfy the pattern.
    expect(slugify("🛋️🛋️🛋️")).toMatch(SLUG_PATTERN)
  })

  it("never ends in a hyphen, including when truncated mid-word", () => {
    // Truncation at 80 characters can land immediately after a separator.
    const title = `${"a".repeat(79)} tail`
    const slug = slugify(title)
    expect(slug.endsWith("-")).toBe(false)
    expect(slug).toMatch(SLUG_PATTERN)
  })

  it("bounds the length", () => {
    expect(slugify("word ".repeat(60)).length).toBeLessThanOrEqual(80)
  })

  it("always returns something the database will accept", () => {
    const awkward = ["", "   ", "---", "!!!", "🙂", "Ω≈ç√", "a", "  a  "]
    for (const title of awkward) {
      expect(slugify(title), `failed for ${JSON.stringify(title)}`).toMatch(SLUG_PATTERN)
    }
  })
})
