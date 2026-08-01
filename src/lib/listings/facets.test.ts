import { describe, expect, it } from "vitest"

import type { FormField, FormSchema } from "@/lib/form-schema/types"
import {
  buildFacets,
  facetChips,
  readSelections,
  toAttributeFilters,
  withoutFacets,
  withoutValue,
} from "./facets"

/**
 * The facet layer's job is to be the buyer-side twin of the write path: a URL is
 * untrusted input, and it may only ask the database for things this category's
 * registry actually offers.
 *
 * So these tests are mostly about what does *not* survive parsing — a field that is
 * not filterable, an option that no longer exists, a bound that is not a number — plus
 * the one case that earns the storage decision: a multi-select filter becoming an
 * array containment rather than a special operator.
 */

function field(overrides: Partial<FormField> & Pick<FormField, "slug" | "type">): FormField {
  return {
    label: overrides.slug,
    renderAs: "input",
    required: false,
    config: {},
    placeholder: null,
    helpText: null,
    defaultValue: null,
    visibleWhen: null,
    options: [],
    filterable: true,
    prominent: false,
    verifiable: false,
    origin: { categorySlug: "c", categoryName: "C", inherited: false },
    ...overrides,
  }
}

function schemaOf(fields: FormField[]): FormSchema {
  return {
    category: { id: 1, slug: "c", name: "C", path: [{ slug: "c", name: "C" }] },
    configVersion: 1,
    groups: [{ slug: null, label: null, fields }],
  }
}

const SIZE = field({
  slug: "size",
  label: "Size",
  type: "single_select",
  options: [
    { slug: "small", label: "Small" },
    { slug: "large", label: "Large" },
  ],
})

const EXTRAS = field({
  slug: "extras",
  label: "Extras",
  type: "multi_select",
  options: [
    { slug: "cable", label: "Cable" },
    { slug: "case", label: "Case" },
  ],
})

const HEALTH = field({
  slug: "health",
  label: "Health",
  type: "number",
  config: { min: 0, max: 100, unit: "%" },
})

const BOXED = field({ slug: "boxed", label: "Boxed", type: "boolean" })

describe("buildFacets", () => {
  it("offers a facet only for fields the assignment marks filterable", () => {
    const facets = buildFacets(
      schemaOf([SIZE, field({ slug: "colour", type: "text", filterable: false })]),
    )

    expect(facets.map((facet) => facet.slug)).toEqual(["size"])
  })

  it("maps each field type to how it can actually be queried", () => {
    const facets = buildFacets(schemaOf([SIZE, EXTRAS, HEALTH, BOXED]))

    expect(facets.map((facet) => [facet.slug, facet.kind])).toEqual([
      ["size", "match"],
      ["extras", "match"],
      ["health", "range"],
      ["boxed", "match"],
    ])
    // A boolean becomes a two-option group, not a switch: "either" has to be sayable.
    expect(facets.at(-1)?.options.map((option) => option.value)).toEqual(["true", "false"])
  })

  it("skips free text, which containment cannot answer", () => {
    const facets = buildFacets(
      schemaOf([
        field({ slug: "notes", type: "textarea" }),
        field({ slug: "model", type: "text" }),
      ]),
    )

    expect(facets).toEqual([])
  })

  it("skips a select whose options have all been archived", () => {
    const facets = buildFacets(schemaOf([field({ slug: "size", type: "single_select" })]))

    expect(facets).toEqual([])
  })
})

describe("readSelections", () => {
  const facets = buildFacets(schemaOf([SIZE, EXTRAS, HEALTH, BOXED]))
  const read = (params: Record<string, string | string[]>) => readSelections(facets, params)

  it("accepts both repeated and comma-separated values", () => {
    expect(read({ "f.size": ["small", "large"] })).toEqual(read({ "f.size": "small,large" }))
  })

  it("normalises to the registry's option order, so one selection is one link", () => {
    const [selection] = read({ "f.size": "large,small,large" })

    expect(selection).toMatchObject({ kind: "match", tokens: ["small", "large"] })
  })

  it("drops an option that is no longer offered rather than failing the page", () => {
    // A link shared before the option was archived: the rest of the filter still works.
    expect(read({ "f.size": "small,medium" })).toMatchObject([{ tokens: ["small"] }])
    expect(read({ "f.size": "medium" })).toEqual([])
  })

  it("ignores a parameter naming a field this category does not filter on", () => {
    expect(read({ "f.unknown": "x", "f.notes": "hello" })).toEqual([])
  })

  it("ignores a bound that is not a number", () => {
    expect(read({ "f.health.min": "eighty" })).toEqual([])
    expect(read({ "f.health.min": "80" })).toMatchObject([{ min: "80", max: null }])
  })

  it("reads a bound the field's own config would not allow, because history is real", () => {
    // Tightening a field's max later must not hide the listings stored before it.
    expect(read({ "f.health.max": "150" })).toMatchObject([{ min: null, max: "150" }])
  })

  it("swaps a reversed range instead of returning nothing", () => {
    expect(read({ "f.health.min": "90", "f.health.max": "10" })).toMatchObject([
      { min: "10", max: "90" },
    ])
  })
})

describe("toAttributeFilters", () => {
  const facets = buildFacets(schemaOf([SIZE, EXTRAS, HEALTH, BOXED]))
  const filters = (params: Record<string, string>) =>
    toAttributeFilters(readSelections(facets, params))

  it("wraps a multi-select value in an array, so containment reaches inside it", () => {
    // `attributes @> '{"extras":["cable"]}'` is true of a listing holding
    // `["cable","case"]` — the reason a multi-select needs no separate operator.
    expect(filters({ "f.extras": "cable" })).toEqual([
      { kind: "match", slug: "extras", values: [["cable"]] },
    ])
  })

  it("turns a boolean token into a real boolean, not the string", () => {
    expect(filters({ "f.boxed": "false" })).toEqual([
      { kind: "match", slug: "boxed", values: [false] },
    ])
  })

  it("keeps several values for one facet together, to be ORed", () => {
    expect(filters({ "f.size": "small,large" })).toEqual([
      { kind: "match", slug: "size", values: ["small", "large"] },
    ])
  })
})

describe("chips and their removal links", () => {
  const facets = buildFacets(schemaOf([SIZE, HEALTH]))
  const params = { "f.size": "small,large", "f.health.min": "80", after: "cursor" }
  const selections = readSelections(facets, params)

  it("labels a value with the option's label, never its stored slug", () => {
    expect(facetChips(selections).map((chip) => chip.label)).toEqual([
      "Size: Small",
      "Size: Large",
      "Health: 80 % and up",
    ])
  })

  it("removes one value while keeping the rest of the filter", () => {
    const chip = facetChips(selections)[0]!

    expect(withoutValue(params, chip.param, chip.value).get("f.size")).toBe("large")
  })

  it("clears both halves of a range from its single chip", () => {
    const chip = facetChips(selections).at(-1)!
    const next = withoutValue(params, chip.param, chip.value)

    expect(next.has("f.health.min")).toBe(false)
    expect(next.has("f.health.max")).toBe(false)
  })

  it("drops the cursor whenever the filters change", () => {
    // A keyset cursor points into the previous result set; carried over, it lands the
    // buyer on an empty page immediately after ticking a box.
    expect(withoutValue(params, "f.size", "small").has("after")).toBe(false)
    expect(withoutFacets(params).has("after")).toBe(false)
  })

  it("keeps the category when clearing filters", () => {
    const next = withoutFacets({ category: "c", "f.size": "small" })

    expect(next.get("category")).toBe("c")
    expect(next.has("f.size")).toBe(false)
  })
})
