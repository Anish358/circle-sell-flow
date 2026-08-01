import { describe, expect, it } from "vitest"

import type { FormField } from "@/lib/form-schema/types"
import { missingRequiredFields } from "./completeness"

/**
 * Completeness has to agree exactly with what publishing would have demanded, or it
 * becomes a page telling a seller to fix something the form never asked for.
 *
 * So the interesting cases are the ones where "required" is not the whole story: a field
 * behind an unmet condition, and an empty multi-select that *is* an answer.
 */

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
    origin: { categorySlug: "c", categoryName: "C", inherited: false },
    ...overrides,
  }
}

const slugsOf = (fields: FormField[]) => fields.map((f) => f.slug)

describe("missingRequiredFields", () => {
  it("reports a required field with no answer", () => {
    const fields = [field({ slug: "brand", required: true })]

    expect(slugsOf(missingRequiredFields(fields, {}))).toEqual(["brand"])
    expect(missingRequiredFields(fields, { brand: "apple" })).toEqual([])
  })

  it("says nothing about optional fields", () => {
    expect(missingRequiredFields([field({ slug: "colour" })], {})).toEqual([])
  })

  it("does not report a required field the seller was never shown", () => {
    // Required only when under warranty, and this listing is not — so it was never
    // asked, and it is not missing.
    const fields = [
      field({ slug: "under-warranty", type: "boolean" }),
      field({
        slug: "warranty-expiry",
        type: "date",
        required: true,
        visibleWhen: { all: [{ field: "under-warranty", op: "eq", value: true }] },
      }),
    ]

    expect(missingRequiredFields(fields, { "under-warranty": false })).toEqual([])
    expect(slugsOf(missingRequiredFields(fields, { "under-warranty": true }))).toEqual([
      "warranty-expiry",
    ])
  })

  it("treats an empty multi-select as answered, exactly as the write path does", () => {
    const fields = [field({ slug: "accessories", type: "multi_select", required: true })]

    expect(missingRequiredFields(fields, { accessories: [] })).toEqual([])
  })

  it("treats null and empty string as unanswered", () => {
    const fields = [field({ slug: "model", required: true })]

    expect(slugsOf(missingRequiredFields(fields, { model: null }))).toEqual(["model"])
    expect(slugsOf(missingRequiredFields(fields, { model: "" }))).toEqual(["model"])
  })
})
