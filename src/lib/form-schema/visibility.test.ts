import { describe, expect, it } from "vitest"

import type { FormField, VisibilityCondition, VisibilityRule } from "./types"
import {
  computeVisibleFields,
  evaluateVisibility,
  isEffectivelyRequired,
  stripHiddenValues,
} from "./visibility"

/**
 * Tests are written against field *types* and rule shapes, never against a
 * product category — there is no fixed schema to test, so the behaviours are what
 * generalise.
 */

/** Minimal field, since only slug, required and visibleWhen matter here. */
function field(slug: string, extra: Partial<FormField> = {}): FormField {
  return {
    slug,
    label: slug,
    type: "text",
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
    ...extra,
  }
}

const shownWhen = (rule: VisibilityRule) => ({ visibleWhen: rule })

describe("evaluateVisibility — operators", () => {
  const cases: Array<[string, VisibilityRule, unknown, boolean]> = [
    ["eq matches", { all: [{ field: "a", op: "eq", value: true }] }, true, true],
    ["eq rejects", { all: [{ field: "a", op: "eq", value: true }] }, false, false],
    ["eq is not loose", { all: [{ field: "a", op: "eq", value: 1 }] }, "1", false],
    ["neq matches", { all: [{ field: "a", op: "neq", value: "x" }] }, "y", true],
    ["in matches a scalar", { all: [{ field: "a", op: "in", value: ["x", "y"] }] }, "y", true],
    ["in rejects a scalar", { all: [{ field: "a", op: "in", value: ["x"] }] }, "z", false],
    [
      "in matches any of a multi-select",
      { all: [{ field: "a", op: "in", value: ["x", "y"] }] },
      ["q", "y"],
      true,
    ],
    ["gte matches", { all: [{ field: "a", op: "gte", value: 85 }] }, 90, true],
    ["gte rejects", { all: [{ field: "a", op: "gte", value: 85 }] }, 80, false],
    [
      "numeric strings are compared as numbers",
      { all: [{ field: "a", op: "lt", value: 10 }] },
      "9",
      true,
    ],
    [
      "ordering against a non-number fails rather than coercing",
      { all: [{ field: "a", op: "gt", value: 5 }] },
      "abc",
      false,
    ],
  ]

  it.each(cases)("%s", (_name, rule, value, expected) => {
    expect(evaluateVisibility(rule, { a: value })).toBe(expected)
  })

  it("treats undefined, null and empty string alike as unanswered", () => {
    const rule: VisibilityRule = { all: [{ field: "a", op: "eq", value: "x" }] }
    for (const blank of [undefined, null, ""]) {
      expect(evaluateVisibility(rule, { a: blank })).toBe(false)
    }
  })

  it("distinguishes false from unanswered", () => {
    const rule: VisibilityRule = { all: [{ field: "a", op: "eq", value: false }] }
    expect(evaluateVisibility(rule, { a: false })).toBe(true)
    expect(evaluateVisibility(rule, {})).toBe(false)
  })
})

describe("evaluateVisibility — all vs any", () => {
  const both: VisibilityCondition[] = [
    { field: "a", op: "eq", value: 1 },
    { field: "b", op: "eq", value: 2 },
  ]

  it("requires every condition under `all`", () => {
    expect(evaluateVisibility({ all: both }, { a: 1, b: 2 })).toBe(true)
    expect(evaluateVisibility({ all: both }, { a: 1, b: 9 })).toBe(false)
  })

  it("requires one condition under `any`", () => {
    expect(evaluateVisibility({ any: both }, { a: 1, b: 9 })).toBe(true)
    expect(evaluateVisibility({ any: both }, { a: 9, b: 9 })).toBe(false)
  })

  it("treats an empty condition list as no constraint", () => {
    expect(evaluateVisibility({ all: [] }, {})).toBe(true)
  })
})

describe("computeVisibleFields", () => {
  it("shows a conditional field only once its trigger is satisfied", () => {
    const fields = [
      field("trigger", { type: "boolean" }),
      field("dependent", shownWhen({ all: [{ field: "trigger", op: "eq", value: true }] })),
    ]

    expect(computeVisibleFields(fields, { trigger: false })).not.toContain("dependent")
    expect(computeVisibleFields(fields, { trigger: true })).toContain("dependent")
  })

  it("cascades down a chain to a fixpoint", () => {
    // c depends on b, b depends on a. Clearing a must hide both, not just b.
    const fields = [
      field("a", { type: "boolean" }),
      field("b", shownWhen({ all: [{ field: "a", op: "eq", value: true }] })),
      field("c", shownWhen({ all: [{ field: "b", op: "eq", value: "go" }] })),
    ]

    const all = computeVisibleFields(fields, { a: true, b: "go" })
    expect([...all].sort()).toEqual(["a", "b", "c"])

    // `b` still holds the value that would satisfy c's condition, but b is hidden,
    // so c must be hidden too.
    const cascaded = computeVisibleFields(fields, { a: false, b: "go" })
    expect([...cascaded]).toEqual(["a"])
  })

  it("terminates on a cycle instead of looping forever", () => {
    // Rejected at config-save time; the evaluator still must not hang.
    const fields = [
      field("a", shownWhen({ all: [{ field: "b", op: "eq", value: true }] })),
      field("b", shownWhen({ all: [{ field: "a", op: "eq", value: true }] })),
    ]
    expect(computeVisibleFields(fields, { a: true, b: true })).toBeInstanceOf(Set)
  })
})

describe("stripHiddenValues", () => {
  const fields = [
    field("trigger", { type: "boolean" }),
    field("dependent", shownWhen({ all: [{ field: "trigger", op: "eq", value: true }] })),
  ]

  it("discards the value of a field that ended up hidden", () => {
    // The seller answered yes, filled the dependent field, then changed to no.
    const stored = stripHiddenValues(fields, { trigger: false, dependent: "2027-03-01" })
    expect(stored).toEqual({ trigger: false })
  })

  it("keeps the value while the field is visible", () => {
    const stored = stripHiddenValues(fields, { trigger: true, dependent: "2027-03-01" })
    expect(stored).toEqual({ trigger: true, dependent: "2027-03-01" })
  })

  it("leaves keys belonging to no field alone, for validation to reject", () => {
    const stored = stripHiddenValues(fields, { trigger: true, "not-a-field": "x" })
    expect(stored).toHaveProperty("not-a-field")
  })
})

describe("isEffectivelyRequired", () => {
  const conditionallyRequired = field("dependent", {
    required: true,
    visibleWhen: { all: [{ field: "trigger", op: "eq", value: true }] },
  })
  const fields = [field("trigger", { type: "boolean" }), conditionallyRequired]

  it("is not required while hidden, however it is configured", () => {
    const visible = computeVisibleFields(fields, { trigger: false })
    expect(isEffectivelyRequired(conditionallyRequired, visible)).toBe(false)
  })

  it("is required once visible", () => {
    const visible = computeVisibleFields(fields, { trigger: true })
    expect(isEffectivelyRequired(conditionallyRequired, visible)).toBe(true)
  })
})
