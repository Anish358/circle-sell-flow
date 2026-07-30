import { describe, expect, it } from "vitest"

import { RENDER_OPTIONS, fieldType, type FieldType } from "@/db/schema"
import { ASSIGNMENTS, CATEGORIES, FIELDS, FIELD_GROUPS } from "./registry"

/**
 * The sample data is a graded deliverable and the seed inserts it in one
 * transaction, so a typo surfaces as an opaque foreign-key error at 2am. These
 * checks run without a database and fail with a sentence instead.
 *
 * They also pin two properties the seed is *supposed* to demonstrate: that every
 * field type is exercised, and that fields are genuinely reused across categories
 * rather than duplicated per category.
 */

const SELECT_TYPES: FieldType[] = ["single_select", "multi_select"]

const categorySlugs = new Set(CATEGORIES.map((c) => c.slug))
const fieldSlugs = new Set(FIELDS.map((f) => f.slug))
const groupSlugs = new Set(FIELD_GROUPS.map((g) => g.slug))

function duplicates(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => (seen.has(value) ? true : (seen.add(value), false)))
}

describe("seed categories", () => {
  it("has unique slugs", () => {
    expect(duplicates(CATEGORIES.map((c) => c.slug))).toEqual([])
  })

  it("lists every parent before its children, which the insert order relies on", () => {
    const inserted = new Set<string>()
    for (const category of CATEGORIES) {
      if (category.parent !== null) {
        expect(inserted, `"${category.slug}" is listed before its parent`).toContain(
          category.parent,
        )
      }
      inserted.add(category.slug)
    }
  })
})

describe("seed fields", () => {
  it("has unique slugs", () => {
    expect(duplicates(FIELDS.map((f) => f.slug))).toEqual([])
  })

  it("gives every select field options, and every other field none", () => {
    for (const field of FIELDS) {
      const optionCount = field.options?.length ?? 0
      if (SELECT_TYPES.includes(field.type)) {
        expect(optionCount, `${field.slug} is a select with no options`).toBeGreaterThan(1)
      } else {
        expect(optionCount, `${field.slug} is not a select but has options`).toBe(0)
      }
    }
  })

  it("has unique option slugs within each field", () => {
    for (const field of FIELDS) {
      const slugs = (field.options ?? []).map((o) => o.slug)
      expect(duplicates(slugs), `${field.slug} has duplicate options`).toEqual([])
    }
  })

  it("pairs render_as with a type that permits it", () => {
    for (const field of FIELDS) {
      expect(
        RENDER_OPTIONS[field.type],
        `${field.slug}: ${field.type} cannot render as ${field.renderAs}`,
      ).toContain(field.renderAs)
    }
  })

  it("demonstrates every field type at least once", () => {
    const used = new Set(FIELDS.map((f) => f.type))
    expect([...fieldType.enumValues].filter((type) => !used.has(type))).toEqual([])
  })

  it("assigns every field to at least one category", () => {
    const assigned = new Set(ASSIGNMENTS.map((a) => a.field))
    expect(FIELDS.map((f) => f.slug).filter((slug) => !assigned.has(slug))).toEqual([])
  })
})

describe("seed assignments", () => {
  it("references only categories, fields and groups that exist", () => {
    for (const assignment of ASSIGNMENTS) {
      expect(categorySlugs, `unknown category "${assignment.category}"`).toContain(
        assignment.category,
      )
      expect(fieldSlugs, `unknown field "${assignment.field}"`).toContain(assignment.field)
      if (assignment.group) {
        expect(groupSlugs, `unknown group "${assignment.group}"`).toContain(assignment.group)
      }
    }
  })

  it("assigns each field to a category at most once, matching the composite key", () => {
    const pairs = ASSIGNMENTS.map((a) => `${a.category}/${a.field}`)
    expect(duplicates(pairs)).toEqual([])
  })

  it("points every visibility rule at a field that exists", () => {
    // That the referenced field is actually *resolvable in that category* needs
    // the inheritance resolver, so it is checked once that exists.
    for (const assignment of ASSIGNMENTS) {
      for (const clause of Object.values(assignment.visibleWhen ?? {})) {
        for (const condition of clause as Array<{ field: string }>) {
          expect(fieldSlugs, `unknown field "${condition.field}" in a visibility rule`).toContain(
            condition.field,
          )
        }
      }
    }
  })

  it("reuses fields across categories rather than duplicating them", () => {
    // The claim the whole design rests on: if this ever drops to zero, someone
    // has started defining a field per category.
    const counts = new Map<string, number>()
    for (const { field } of ASSIGNMENTS) counts.set(field, (counts.get(field) ?? 0) + 1)
    const shared = [...counts.values()].filter((count) => count > 1)
    expect(shared.length).toBeGreaterThanOrEqual(3)
  })
})
