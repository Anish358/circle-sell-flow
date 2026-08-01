import { describe, expect, it } from "vitest"

import type { AuditEntry } from "./audit"
import { collectReferences, describeAudit, type ActivityNames } from "./activity"

/**
 * The activity feed is read by whoever edits the registry, who is not an engineer. These
 * tests are therefore about *wording*, which is unusual to test and worth it here: the
 * failure mode is not a crash, it is a line that says `category.create · category 7` and
 * quietly makes the log useless.
 *
 * Two properties matter most and are asserted for every action: no entry leaks a raw
 * action key or a bare id into what a person reads, and no entry is left without a
 * sentence at all.
 */

const names: ActivityNames = {
  categories: new Map([
    [1, "Electronics"],
    [2, "Devices"],
    [7, "Washing Machine"],
  ]),
  fields: new Map([[5, "Battery Health"]]),
  groups: new Map([[3, "Specifications"]]),
  listings: new Map([["listing-uuid", "iPhone 13 128GB"]]),
}

function entry(overrides: Partial<AuditEntry> & Pick<AuditEntry, "action">): AuditEntry {
  return {
    id: 1,
    entityType: "category",
    entityId: "7",
    before: null,
    after: null,
    at: new Date("2026-08-01T10:32:00Z"),
    actorName: "Circle Admin",
    ...overrides,
  }
}

describe("describeAudit — the sentences an admin reads", () => {
  it("names a new category and where it went, instead of its id", () => {
    const item = describeAudit(
      entry({
        action: "category.create",
        after: { id: 7, name: "Washing Machine", parentId: 1, slug: "washing-machine" },
      }),
      names,
    )

    expect(item.headline).toBe("New category “Washing Machine”")
    expect(item.detail).toContain("inside “Electronics”")
    expect(item.tone).toBe("added")
  })

  it("says top level when a category has no parent", () => {
    const item = describeAudit(
      entry({ action: "category.create", after: { name: "Appliances", parentId: null } }),
      names,
    )

    expect(item.detail).toContain("top-level")
  })

  it("reads a rename as a rename, with both names", () => {
    const item = describeAudit(
      entry({
        action: "category.update",
        before: { name: "Washing Machines" },
        after: { name: "Washing Machine" },
      }),
      names,
    )

    expect(item.headline).toBe("Renamed the category “Washing Machines” to “Washing Machine”")
    // The point of immutable slugs, said in words the reader cares about.
    expect(item.detail).toContain("links and listings follow the category")
  })

  it("names both ends of a move", () => {
    const item = describeAudit(
      entry({
        action: "category.reparent",
        before: { name: "Washing Machine", parentId: 1 },
        after: { name: "Washing Machine", parentId: 2 },
      }),
      names,
    )

    expect(item.headline).toBe(
      "Moved the category “Washing Machine” from “Electronics” to “Devices”",
    )
    expect(item.detail).toContain("inherits a different set of fields")
  })

  it("explains what archiving a field does to listings that already answered it", () => {
    const item = describeAudit(
      entry({
        action: "field.archive",
        entityType: "field",
        entityId: "5",
        before: { label: "Battery Health" },
        after: { label: "Battery Health", archivedAt: "2026-08-01" },
      }),
      names,
    )

    expect(item.headline).toBe("Archived the field “Battery Health”")
    expect(item.detail).toContain("keep showing it")
    expect(item.tone).toBe("removed")
  })

  it("describes a new field by what it collects, not by its enum values", () => {
    const item = describeAudit(
      entry({
        action: "field.create",
        entityType: "field",
        entityId: "5",
        after: { label: "Spin Speed", type: "number", renderAs: "input" },
      }),
      names,
    )

    expect(item.detail).toBe(
      "Collected as a number, shown as a single-line box. It can now be added to any category.",
    )
  })

  it("reads an assignment as a sentence about the category and the field", () => {
    const attached = describeAudit(
      entry({
        action: "assignment.attach",
        entityType: "assignment",
        entityId: "7:5",
        after: { categoryId: 7, fieldId: 5, required: true },
      }),
      names,
    )

    expect(attached.headline).toBe("“Washing Machine” now collects “Battery Health”")
    expect(attached.detail).toContain("anything inside it")
  })

  it("names the category and field for a detach, whose row no longer exists", () => {
    // The document is the deleted row; the ids in `entityId` are what remain reliable.
    const item = describeAudit(
      entry({
        action: "assignment.detach",
        entityType: "assignment",
        entityId: "7:5",
        before: { categoryId: 7, fieldId: 5 },
      }),
      names,
    )

    expect(item.headline).toBe("“Washing Machine” no longer collects “Battery Health”")
  })

  it("turns an assignment edit into labelled before-and-after values", () => {
    const item = describeAudit(
      entry({
        action: "assignment.update",
        entityType: "assignment",
        entityId: "7:5",
        before: { categoryId: 7, fieldId: 5, required: false, groupId: null, filterable: false },
        after: { categoryId: 7, fieldId: 5, required: true, groupId: 3, filterable: false },
      }),
      names,
    )

    expect(item.changes).toEqual([
      { label: "Required", from: "no", to: "yes" },
      { label: "Group", from: "nothing", to: "Specifications" },
    ])
  })

  it("counts the answers a re-categorisation removed", () => {
    const item = describeAudit(
      entry({
        action: "listing.recategorise",
        entityType: "listing",
        entityId: "listing-uuid",
        before: {
          categoryName: "Mobile Phone",
          attributes: { storage: "128gb", ram: "8gb", "purchase-date": "2024-01-01" },
        },
        after: { categoryName: "Laptop", attributes: { "purchase-date": "2024-01-01" } },
      }),
      names,
    )

    expect(item.headline).toBe(
      "Moved the listing “iPhone 13 128GB” from “Mobile Phone” to “Laptop”",
    )
    expect(item.detail).toContain("2 answers")
    expect(item.detail).toContain("only remaining copy")
  })

  it("says nothing was lost when every answer survives the move", () => {
    const item = describeAudit(
      entry({
        action: "listing.recategorise",
        entityType: "listing",
        entityId: "listing-uuid",
        before: { categoryName: "Mobile Phone", attributes: { "purchase-date": "2024-01-01" } },
        after: { categoryName: "Laptop", attributes: { "purchase-date": "2024-01-01" } },
      }),
      names,
    )

    expect(item.detail).toContain("nothing was lost")
  })

  it("distinguishes retiring an option from bringing it back", () => {
    const retired = describeAudit(
      entry({
        action: "option.archive",
        entityType: "field_option",
        entityId: "9",
        after: { label: "512 GB", fieldId: 5 },
      }),
      names,
    )
    const restored = describeAudit(
      entry({
        action: "option.restore",
        entityType: "field_option",
        entityId: "9",
        after: { label: "512 GB", fieldId: 5 },
      }),
      names,
    )

    expect(retired.headline).toBe("Retired the answer “512 GB” on the field “Battery Health”")
    expect(restored.headline).toBe("Brought back the answer “512 GB” on the field “Battery Health”")
  })

  it("admits when a name is not knowable instead of printing a placeholder", () => {
    // An entry can outlive the row it points at — a development reset is the usual way.
    // The first version of this printed `on the field “a field”`, a fallback wearing a
    // name's clothes, which reads as a bug and hides a real one.
    const item = describeAudit(
      entry({
        action: "option.archive",
        entityType: "field_option",
        entityId: "9",
        after: { label: "Brushed steel", fieldId: 999 },
      }),
      names,
    )

    expect(item.headline).toBe(
      "Retired the answer “Brushed steel” on a field that is no longer in the registry",
    )
    expect(item.headline).not.toContain("“a field”")
  })

  it("degrades to a readable sentence for an action added later", () => {
    const item = describeAudit(
      entry({ action: "category.something_new", entityType: "field_option" }),
      names,
    )

    expect(item.headline).toBe("Changed a field option")
    // Still traceable for whoever is debugging, just not in the reader's way.
    expect(item.action).toBe("category.something_new")
  })

  it("never shows a raw action key or a bare id in what a person reads", () => {
    const actions = [
      "category.create",
      "category.update",
      "category.reparent",
      "category.deactivate",
      "category.activate",
      "category.reorder",
      "field.create",
      "field.update",
      "field.archive",
      "field.restore",
      "option.create",
      "option.update",
      "option.archive",
      "option.restore",
      "assignment.attach",
      "assignment.update",
      "assignment.detach",
      "listing.verified",
      "listing.verification_cleared",
      "listing.recategorise",
    ]

    for (const action of actions) {
      const item = describeAudit(
        entry({
          action,
          entityId: "7:5",
          before: { name: "A", label: "A", parentId: 1, fieldId: 5, categoryId: 7, sort: 10 },
          after: { name: "B", label: "B", parentId: 2, fieldId: 5, categoryId: 7, sort: 20 },
        }),
        names,
      )

      const readable = `${item.headline} ${item.detail ?? ""}`
      expect(readable, action).not.toMatch(/[a-z]+\.[a-z_]+/)
      expect(item.headline.length, action).toBeGreaterThan(10)
    }
  })
})

describe("collectReferences", () => {
  it("gathers every id the feed will need to turn into a name", () => {
    const refs = collectReferences([
      entry({ action: "category.create", entityId: "7", after: { parentId: 1 } }),
      entry({
        action: "assignment.update",
        entityType: "assignment",
        entityId: "7:5",
        after: { groupId: 3 },
      }),
      entry({ action: "listing.verified", entityType: "listing", entityId: "some-slug" }),
    ])

    expect(refs.categoryIds.sort()).toEqual([1, 7])
    expect(refs.fieldIds).toEqual([5])
    expect(refs.groupIds).toEqual([3])
    expect(refs.listingRefs).toEqual(["some-slug"])
  })

  it("ignores ids that are not ids, so a malformed row cannot break the query", () => {
    const refs = collectReferences([
      entry({ action: "listing.verified", entityType: "field", entityId: "not-a-number" }),
    ])

    expect(refs.fieldIds).toEqual([])
  })
})
