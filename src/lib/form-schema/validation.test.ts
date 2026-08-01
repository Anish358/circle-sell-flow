import { describe, expect, it } from "vitest"

import type { FieldConfig, FormField } from "./types"
import { validateAttributes } from "./validation"

/**
 * How do you test a system with no fixed schema? Table-driven over field *types*
 * and their configuration, never over product categories. These cases hold for any
 * category anyone ever configures, including ones that do not exist yet.
 */

function field(overrides: Partial<FormField> & Pick<FormField, "type">): FormField {
  return {
    slug: "subject",
    label: "Subject",
    renderAs: "input",
    required: false,
    config: {},
    placeholder: null,
    helpText: null,
    defaultValue: null,
    visibleWhen: null,
    options: [],
    filterable: false,
    prominent: false,
    verifiable: false,
    origin: { categorySlug: "root", categoryName: "Root", inherited: false },
    ...overrides,
  }
}

const OPTIONS = [
  { slug: "small", label: "Small" },
  { slug: "large", label: "Large" },
]

/** [name, field, submitted value, expected stored value or "invalid"] */
type Case = [string, FormField, unknown, unknown | "invalid"]

const CASES: Case[] = [
  // ── text ───────────────────────────────────────────────────────────────────
  ["text accepts a string", field({ type: "text" }), "Midnight", "Midnight"],
  ["text trims surrounding space", field({ type: "text" }), "  Midnight  ", "Midnight"],
  [
    "text below minLength is rejected",
    field({ type: "text", config: { minLength: 3 } }),
    "ab",
    "invalid",
  ],
  [
    "text above maxLength is rejected",
    field({ type: "text", config: { maxLength: 4 } }),
    "abcde",
    "invalid",
  ],
  ["text rejects a number", field({ type: "text" }), 42, "invalid"],

  // ── textarea ───────────────────────────────────────────────────────────────
  ["textarea preserves newlines", field({ type: "textarea" }), "a\n\nb", "a\n\nb"],

  // ── number ─────────────────────────────────────────────────────────────────
  ["number accepts a number", field({ type: "number" }), 89, 89],
  ["number coerces a numeric string", field({ type: "number" }), "89", 89],
  ["number coerces Indian digit grouping", field({ type: "number" }), "1,20,000", 120000],
  ["number rejects words", field({ type: "number" }), "eight", "invalid"],
  ["number rejects NaN", field({ type: "number" }), Number.NaN, "invalid"],
  ["number rejects Infinity", field({ type: "number" }), Number.POSITIVE_INFINITY, "invalid"],
  [
    "number below min is rejected",
    field({ type: "number", config: { min: 0, max: 100 } }),
    -1,
    "invalid",
  ],
  [
    "number above max is rejected",
    field({ type: "number", config: { min: 0, max: 100 } }),
    101,
    "invalid",
  ],
  ["number at the boundary is accepted", field({ type: "number", config: { max: 100 } }), 100, 100],
  ["step 1 means integers only", field({ type: "number", config: { step: 1 } }), 2.5, "invalid"],
  ["fractional steps allow decimals", field({ type: "number", config: {} }), 2.5, 2.5],

  // ── boolean ────────────────────────────────────────────────────────────────
  ["boolean accepts false", field({ type: "boolean" }), false, false],
  ["boolean coerces the string 'true'", field({ type: "boolean" }), "true", true],
  ["boolean rejects 1", field({ type: "boolean" }), 1, "invalid"],

  // ── date ───────────────────────────────────────────────────────────────────
  ["date accepts ISO", field({ type: "date" }), "2024-03-01", "2024-03-01"],
  ["date rejects other formats", field({ type: "date" }), "01/03/2024", "invalid"],
  ["date rejects impossible days", field({ type: "date" }), "2024-02-31", "invalid"],
  [
    "date rejects the future when configured",
    field({ type: "date", config: { maxToday: true } }),
    "2099-01-01",
    "invalid",
  ],
  [
    "date allows the future when not configured",
    field({ type: "date" }),
    "2099-01-01",
    "2099-01-01",
  ],

  // ── single_select ───────────────────────────────────────────────────────────
  [
    "single_select accepts a live option",
    field({ type: "single_select", options: OPTIONS }),
    "large",
    "large",
  ],
  [
    "single_select rejects an unknown option",
    field({ type: "single_select", options: OPTIONS }),
    "enormous",
    "invalid",
  ],
  [
    "single_select rejects a label instead of a slug",
    field({ type: "single_select", options: OPTIONS }),
    "Large",
    "invalid",
  ],
  [
    "single_select rejects an array",
    field({ type: "single_select", options: OPTIONS }),
    ["large"],
    "invalid",
  ],

  // ── multi_select ────────────────────────────────────────────────────────────
  [
    "multi_select accepts live options",
    field({ type: "multi_select", options: OPTIONS }),
    ["small", "large"],
    ["small", "large"],
  ],
  [
    "multi_select accepts an empty selection",
    field({ type: "multi_select", options: OPTIONS }),
    [],
    [],
  ],
  [
    "multi_select rejects an unknown option",
    field({ type: "multi_select", options: OPTIONS }),
    ["small", "huge"],
    "invalid",
  ],
  [
    "multi_select rejects duplicates",
    field({ type: "multi_select", options: OPTIONS }),
    ["small", "small"],
    "invalid",
  ],
  [
    "multi_select rejects a bare string",
    field({ type: "multi_select", options: OPTIONS }),
    "small",
    "invalid",
  ],
]

describe("validateAttributes — per field type", () => {
  it.each(CASES)("%s", (_name, subject, submitted, expected) => {
    const result = validateAttributes([subject], { [subject.slug]: submitted })

    if (expected === "invalid") {
      expect(result.ok, "expected this to be rejected").toBe(false)
      return
    }

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true)
    if (result.ok) expect(result.attributes[subject.slug]).toEqual(expected)
  })
})

describe("validateAttributes — empty and absent", () => {
  const cases: Array<[string, FormField["type"], FieldConfig]> = [
    ["text", "text", {}],
    ["number", "number", {}],
    ["boolean", "boolean", {}],
    ["date", "date", {}],
  ]

  it.each(cases)("an optional %s treats null and '' as unanswered", (_name, type, config) => {
    const subject = field({ type, config })
    for (const blank of [null, "", undefined]) {
      const result = validateAttributes([subject], { [subject.slug]: blank })
      expect(result.ok).toBe(true)
      // Absent, not stored as an explicit null.
      if (result.ok) expect(subject.slug in result.attributes).toBe(false)
    }
  })

  it("rejects a required field left blank", () => {
    const subject = field({ type: "text", required: true })
    const result = validateAttributes([subject], { [subject.slug]: "  " })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[subject.slug]).toBe("Required")
  })

  it("accepts a required multi-select answered with nothing selected", () => {
    // `[]` is an answer — "none of these" — and is distinguishable from absence.
    const subject = field({ type: "multi_select", required: true, options: OPTIONS })
    const result = validateAttributes([subject], { [subject.slug]: [] })
    expect(result.ok).toBe(true)
  })
})

describe("validateAttributes — the client is not trusted", () => {
  const known = field({ type: "text" })

  it("rejects keys that belong to no field in this category", () => {
    const result = validateAttributes([known], { subject: "ok", "not-a-field": "x" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors._form).toContain("not-a-field")
  })

  it("names every unknown key, not just the first", () => {
    const result = validateAttributes([known], { alpha: 1, beta: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors._form).toContain("alpha")
      expect(result.errors._form).toContain("beta")
    }
  })
})

describe("validateAttributes — conditional fields", () => {
  const trigger = field({ slug: "has-warranty", type: "boolean" })
  const dependent = field({
    slug: "expires-on",
    type: "date",
    required: true,
    visibleWhen: { all: [{ field: "has-warranty", op: "eq", value: true }] },
  })
  const fields = [trigger, dependent]

  it("does not store the value of a field that ended up hidden", () => {
    // Answered yes, filled the date, then switched to no. The stored row must not
    // contradict itself.
    const result = validateAttributes(fields, {
      "has-warranty": false,
      "expires-on": "2027-03-01",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.attributes).toEqual({ "has-warranty": false })
      expect("expires-on" in result.attributes).toBe(false)
    }
  })

  it("does not require a hidden field, despite it being configured required", () => {
    const result = validateAttributes(fields, { "has-warranty": false })
    expect(result.ok).toBe(true)
  })

  it("requires it once visible", () => {
    const result = validateAttributes(fields, { "has-warranty": true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors["expires-on"]).toBe("Required")
  })

  it("still validates the value of a visible conditional field", () => {
    const result = validateAttributes(fields, {
      "has-warranty": true,
      "expires-on": "not-a-date",
    })
    expect(result.ok).toBe(false)
  })
})

describe("validateAttributes — draft versus publish", () => {
  const fields = [
    field({ slug: "a", type: "text", required: true }),
    field({ slug: "b", type: "number", required: true, config: { min: 0, max: 100 } }),
  ]

  it("lets a draft save while incomplete", () => {
    const result = validateAttributes(fields, { a: "partial" }, "draft")
    expect(result.ok).toBe(true)
  })

  it("still rejects a malformed value in a draft", () => {
    // Incomplete is fine; wrong is not. A draft may not store a number as words.
    const result = validateAttributes(fields, { b: "eighty" }, "draft")
    expect(result.ok).toBe(false)
  })

  it("demands completeness on publish", () => {
    const result = validateAttributes(fields, { a: "partial" }, "publish")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.b).toBe("Required")
  })
})
