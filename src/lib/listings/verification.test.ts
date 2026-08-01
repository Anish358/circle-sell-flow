import { describe, expect, it } from "vitest"

import type { FormField, FormSchema } from "@/lib/form-schema/types"
import { compareToClaims, verifiableFields, verificationSchema } from "./verification"

/**
 * The hub's form is a filter over the seller's, so these tests are about which
 * questions survive the filter and why — never about what any particular category
 * collects. Field types stand in for categories, as everywhere else in this suite.
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
    filterable: false,
    prominent: false,
    verifiable: false,
    origin: { categorySlug: "root", categoryName: "Root", inherited: false },
    ...overrides,
  }
}

function schemaOf(...fields: FormField[]): FormSchema {
  return {
    category: { id: 1, slug: "root", name: "Root", path: [{ slug: "root", name: "Root" }] },
    configVersion: 1,
    groups: [{ slug: "specs", label: "Specs", fields }],
  }
}

const measurable = field({
  slug: "measured",
  type: "number",
  verifiable: true,
  config: { max: 100 },
})
const opinion = field({ slug: "opinion", type: "textarea" })

describe("verifiableFields", () => {
  it("keeps only the fields the assignment marks verifiable", () => {
    const fields = verifiableFields(schemaOf(measurable, opinion), {})
    expect(fields.map((f) => f.slug)).toEqual(["measured"])
  })

  it("drops a verifiable field the seller was never asked about", () => {
    // Its condition is false against the seller's answers, so the question was never
    // posed. Asking the hub to measure it would invent an answer to it.
    const gate = field({ slug: "gate", type: "boolean" })
    const dependent = field({
      slug: "dependent",
      type: "number",
      verifiable: true,
      visibleWhen: { all: [{ field: "gate", op: "eq", value: true }] },
    })

    expect(verifiableFields(schemaOf(gate, dependent), { gate: false })).toHaveLength(0)
    expect(verifiableFields(schemaOf(gate, dependent), { gate: true }).map((f) => f.slug)).toEqual([
      "dependent",
    ])
  })

  it("resolves visibility once and then drops the rule", () => {
    // The hub is not asked about the gate field, so a condition pointing at it would
    // evaluate against a missing value and hide the very field it just admitted.
    const gate = field({ slug: "gate", type: "boolean" })
    const dependent = field({
      slug: "dependent",
      type: "number",
      verifiable: true,
      visibleWhen: { all: [{ field: "gate", op: "eq", value: true }] },
    })

    const [resolved] = verifiableFields(schemaOf(gate, dependent), { gate: true })
    expect(resolved?.visibleWhen).toBeNull()
  })

  it("never carries the seller's obligations across", () => {
    // A partial verification is normal, and a default would be a measurement nobody took.
    const [resolved] = verifiableFields(
      schemaOf(
        field({
          slug: "measured",
          type: "number",
          verifiable: true,
          required: true,
          defaultValue: 50,
        }),
      ),
      {},
    )
    expect(resolved?.required).toBe(false)
    expect(resolved?.defaultValue).toBeNull()
  })

  it("shows the claim being checked as help text", () => {
    const [withClaim] = verifiableFields(schemaOf(measurable), { measured: 92 })
    expect(withClaim?.helpText).toBe("Seller stated: 92")

    const [withoutClaim] = verifiableFields(schemaOf(measurable), {})
    expect(withoutClaim?.helpText).toBe("Seller left this blank.")
  })
})

describe("verificationSchema", () => {
  it("drops groups left with nothing to ask", () => {
    const schema: FormSchema = {
      ...schemaOf(measurable),
      groups: [
        { slug: "specs", label: "Specs", fields: [measurable] },
        { slug: "story", label: "Story", fields: [opinion] },
      ],
    }

    expect(verificationSchema(schema, {}).groups.map((group) => group.slug)).toEqual(["specs"])
  })

  it("keeps the seller's order, so the hub reads the item the way it was listed", () => {
    const second = field({ slug: "second", type: "number", verifiable: true })
    const schema = schemaOf(measurable, opinion, second)
    expect(verificationSchema(schema, {}).groups[0]?.fields.map((f) => f.slug)).toEqual([
      "measured",
      "second",
    ])
  })
})

describe("compareToClaims", () => {
  const options = [
    { slug: "a", label: "Alpha" },
    { slug: "b", label: "Beta" },
  ]
  const choice = field({ slug: "choice", type: "single_select", verifiable: true, options })

  it("formats both sides with the same formatter, so labels never disagree", () => {
    const [row] = compareToClaims([choice], { choice: "a" }, { choice: "b" })
    expect(row).toMatchObject({ claim: "Alpha", verified: "Beta", differs: true })
  })

  it("is not a difference when the hub confirms the claim", () => {
    const [row] = compareToClaims([choice], { choice: "a" }, { choice: "a" })
    expect(row?.differs).toBe(false)
  })

  it("is not a difference when there is nothing to compare against", () => {
    // A measurement of a field the seller left blank adds information; it contradicts
    // nothing, and calling it a discrepancy would be an accusation.
    const [unclaimed] = compareToClaims([choice], {}, { choice: "a" })
    expect(unclaimed).toMatchObject({ claim: null, verified: "Alpha", differs: false })

    const [unmeasured] = compareToClaims([choice], { choice: "a" }, {})
    expect(unmeasured).toMatchObject({ claim: "Alpha", verified: null, differs: false })
  })
})
