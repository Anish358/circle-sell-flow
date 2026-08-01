import { describe, expect, it } from "vitest"

import type { FormField, VisibilityRule } from "./types"
import {
  validateFieldDefinition,
  validateResolvedSchema,
  type FieldDefinition,
} from "./config-validation"

/**
 * Every one of these configurations saves cleanly if nobody checks it, and every
 * one produces a form a seller cannot submit. Each test is one way an admin can
 * lock the front door from the inside.
 */

function definition(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    slug: "subject",
    type: "number",
    renderAs: "input",
    config: {},
    options: [],
    ...overrides,
  }
}

function field(overrides: Partial<FormField> & Pick<FormField, "slug">): FormField {
  return {
    label: overrides.slug,
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
    ...overrides,
  }
}

const codesOf = (issues: Array<{ code: string }>) => issues.map((issue) => issue.code)

describe("validateFieldDefinition", () => {
  it("accepts a sane definition", () => {
    expect(validateFieldDefinition(definition({ config: { min: 0, max: 100 } }))).toEqual([])
  })

  it("rejects a minimum above its maximum", () => {
    const issues = validateFieldDefinition(definition({ config: { min: 100, max: 0 } }))
    expect(codesOf(issues)).toContain("min_above_max")
  })

  it("rejects a minimum length above its maximum length", () => {
    const issues = validateFieldDefinition(
      definition({ type: "text", config: { minLength: 50, maxLength: 10 } }),
    )
    expect(codesOf(issues)).toContain("min_length_above_max_length")
  })

  it("rejects a step of zero, which no value could land on", () => {
    expect(codesOf(validateFieldDefinition(definition({ config: { step: 0 } })))).toContain(
      "non_positive_step",
    )
  })

  it("rejects a step that cannot reach the stated maximum", () => {
    // 0–100 in threes stops at 99, and the browser's number input then refuses the
    // maximum the label promises.
    const issues = validateFieldDefinition(definition({ config: { min: 0, max: 100, step: 3 } }))
    expect(codesOf(issues)).toContain("step_misses_max")

    expect(
      codesOf(validateFieldDefinition(definition({ config: { min: 0, max: 100, step: 5 } }))),
    ).not.toContain("step_misses_max")
    // Floating-point steps must not be rejected by a naive modulo: 1.5 divides 0–3.
    expect(
      codesOf(validateFieldDefinition(definition({ config: { min: 0, max: 3, step: 1.5 } }))),
    ).not.toContain("step_misses_max")
  })

  it("rejects a presentation the type cannot use", () => {
    const issues = validateFieldDefinition(definition({ type: "date", renderAs: "checkboxes" }))
    expect(codesOf(issues)).toContain("render_as_not_permitted")
  })

  it("rejects a select with nothing to select", () => {
    const issues = validateFieldDefinition(
      definition({ type: "single_select", renderAs: "dropdown", options: [] }),
    )
    expect(codesOf(issues)).toContain("select_without_options")
  })

  it("rejects options on a type that has no options", () => {
    const issues = validateFieldDefinition(definition({ options: [{ slug: "x" }] }))
    expect(codesOf(issues)).toContain("options_on_non_select")
  })
})

describe("validateResolvedSchema — defaults", () => {
  it("accepts a default that satisfies its own field", () => {
    const issues = validateResolvedSchema([
      field({ slug: "a", type: "number", config: { min: 0, max: 100 }, defaultValue: 50 }),
    ])
    expect(issues).toEqual([])
  })

  it("rejects a default outside its own field's range", () => {
    const issues = validateResolvedSchema([
      field({ slug: "a", type: "number", config: { min: 0, max: 100 }, defaultValue: 500 }),
    ])
    expect(codesOf(issues)).toContain("invalid_default")
  })

  it("rejects a default that is not one of the field's options", () => {
    const issues = validateResolvedSchema([
      field({
        slug: "a",
        type: "single_select",
        renderAs: "dropdown",
        options: [{ slug: "small", label: "Small" }],
        defaultValue: "enormous",
      }),
    ])
    expect(codesOf(issues)).toContain("invalid_default")
  })
})

describe("validateResolvedSchema — unanswerable fields", () => {
  it("rejects a required select whose options have all been archived", () => {
    const issues = validateResolvedSchema([
      field({
        slug: "a",
        type: "single_select",
        renderAs: "dropdown",
        required: true,
        options: [],
      }),
    ])
    expect(codesOf(issues)).toContain("required_without_options")
  })

  it("rejects a condition on a field the category does not collect", () => {
    const issues = validateResolvedSchema([
      field({
        slug: "a",
        visibleWhen: { all: [{ field: "not-here", op: "eq", value: true }] },
      }),
    ])
    expect(codesOf(issues)).toContain("condition_on_unknown_field")
  })

  it("rejects contradictory conditions in an `all` group", () => {
    const issues = validateResolvedSchema([
      field({ slug: "trigger", type: "text" }),
      field({
        slug: "a",
        visibleWhen: {
          all: [
            { field: "trigger", op: "eq", value: "x" },
            { field: "trigger", op: "eq", value: "y" },
          ],
        },
      }),
    ])
    expect(codesOf(issues)).toContain("contradictory_conditions")
  })

  it("allows differing values under `any`, where they are alternatives", () => {
    const issues = validateResolvedSchema([
      field({ slug: "trigger", type: "text" }),
      field({
        slug: "a",
        visibleWhen: {
          any: [
            { field: "trigger", op: "eq", value: "x" },
            { field: "trigger", op: "eq", value: "y" },
          ],
        },
      }),
    ])
    expect(issues).toEqual([])
  })

  it("rejects a condition against an option that no longer exists", () => {
    // The usual cause: someone archived the option a rule still refers to.
    const issues = validateResolvedSchema([
      field({
        slug: "trigger",
        type: "single_select",
        renderAs: "dropdown",
        options: [{ slug: "small", label: "Small" }],
      }),
      field({
        slug: "a",
        required: true,
        visibleWhen: { all: [{ field: "trigger", op: "eq", value: "archived-option" }] },
      }),
    ])
    expect(codesOf(issues)).toContain("dead_required_field")
  })

  it("rejects a required field whose trigger can itself never be shown", () => {
    // b depends on a, a can never be true, so b is unreachable — and it is required,
    // which makes the whole form permanently unsubmittable.
    const issues = validateResolvedSchema([
      field({ slug: "gate", type: "boolean" }),
      field({
        slug: "a",
        type: "boolean",
        visibleWhen: { all: [{ field: "gate", op: "eq", value: "not-a-boolean" }] },
      }),
      field({
        slug: "b",
        required: true,
        visibleWhen: { all: [{ field: "a", op: "eq", value: true }] },
      }),
    ])
    expect(codesOf(issues)).toContain("dead_required_field")
  })

  it("does not flag an optional field behind an impossible condition", () => {
    // Pointless, but harmless: the form is still submittable.
    const issues = validateResolvedSchema([
      field({ slug: "gate", type: "boolean" }),
      field({
        slug: "a",
        visibleWhen: { all: [{ field: "gate", op: "eq", value: "not-a-boolean" }] },
      }),
    ])
    expect(codesOf(issues)).not.toContain("dead_required_field")
  })
})

describe("validateResolvedSchema — cycles", () => {
  const mutual: VisibilityRule = { all: [{ field: "b", op: "eq", value: true }] }

  it("rejects two fields that depend on each other", () => {
    const issues = validateResolvedSchema([
      field({ slug: "a", type: "boolean", visibleWhen: mutual }),
      field({
        slug: "b",
        type: "boolean",
        visibleWhen: { all: [{ field: "a", op: "eq", value: true }] },
      }),
    ])
    expect(codesOf(issues)).toContain("visibility_cycle")
  })

  it("rejects a longer loop", () => {
    const issues = validateResolvedSchema([
      field({
        slug: "a",
        type: "boolean",
        visibleWhen: { all: [{ field: "c", op: "eq", value: true }] },
      }),
      field({
        slug: "b",
        type: "boolean",
        visibleWhen: { all: [{ field: "a", op: "eq", value: true }] },
      }),
      field({
        slug: "c",
        type: "boolean",
        visibleWhen: { all: [{ field: "b", op: "eq", value: true }] },
      }),
    ])
    expect(codesOf(issues)).toContain("visibility_cycle")
  })

  it("accepts a chain that does not loop back", () => {
    const issues = validateResolvedSchema([
      field({ slug: "a", type: "boolean" }),
      field({
        slug: "b",
        type: "boolean",
        visibleWhen: { all: [{ field: "a", op: "eq", value: true }] },
      }),
      field({
        slug: "c",
        visibleWhen: { all: [{ field: "b", op: "eq", value: true }] },
      }),
    ])
    expect(issues).toEqual([])
  })

  it("accepts two fields depending on the same trigger", () => {
    // A diamond is not a cycle; a naive visited-set check would call it one.
    const trigger = { all: [{ field: "gate", op: "eq" as const, value: true }] }
    const issues = validateResolvedSchema([
      field({ slug: "gate", type: "boolean" }),
      field({ slug: "a", visibleWhen: trigger }),
      field({ slug: "b", visibleWhen: trigger }),
    ])
    expect(issues).toEqual([])
  })
})
