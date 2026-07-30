import { sql } from "drizzle-orm"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { resolveListingDisplay } from "./display"

/**
 * The display resolver answers a question about the *past*: what does this listing
 * hold? That is not the same question the form resolver answers, and the difference
 * only shows up once the configuration has moved on from the listing.
 *
 * So these tests archive fields and options, then check that the listing keeps
 * rendering. A config change must never rewrite history.
 *
 * Run with `npm run test:db`.
 */

/**
 * One specific listing from the sample data, not "whichever comes first" — the
 * expectations below name its actual answers, so the fixture has to be deterministic.
 */
const LISTING = "apple-iphone-13-128gb-midnight"

let categoryId: number
let attributes: Record<string, unknown>

beforeAll(async () => {
  const [row] = await db.execute<{ id: number; attributes: Record<string, unknown> }>(sql`
    SELECT category_id AS id, attributes FROM listings WHERE slug = ${LISTING}
  `)
  if (!row) throw new Error(`Needs a seeded database (no listing "${LISTING}").`)
  categoryId = row.id
  attributes = row.attributes
})

// Every test mutates the registry, so put it back rather than leaving the next test
// (or a later manual look at the app) with a surprise.
afterEach(async () => {
  await db.execute(sql`UPDATE fields SET archived_at = NULL WHERE archived_at IS NOT NULL`)
  await db.execute(sql`UPDATE field_options SET archived_at = NULL WHERE archived_at IS NOT NULL`)
})

function flatten(display: Awaited<ReturnType<typeof resolveListingDisplay>>) {
  return [...display.groups.flatMap((group) => group.attributes), ...display.orphaned]
}

describe("resolveListingDisplay", () => {
  it("groups attributes as the registry configures, in order", async () => {
    const display = await resolveListingDisplay(categoryId, attributes)

    expect(display.groups.length).toBeGreaterThan(1)
    // Every group has a heading and at least one row; an empty group would render as a
    // stray label.
    for (const group of display.groups) {
      expect(group.attributes.length).toBeGreaterThan(0)
    }
  })

  it("renders option labels, not the slugs that are stored", async () => {
    const display = await resolveListingDisplay(categoryId, attributes)
    const storage = flatten(display).find((attribute) => attribute.slug === "storage")

    // The row holds "128gb"; a person should read "128 GB".
    expect(storage?.value).toBe("128gb")
    expect(storage?.display).toBe("128 GB")
  })

  it("renders booleans as words and numbers with their unit", async () => {
    const display = await resolveListingDisplay(categoryId, attributes)
    const all = flatten(display)

    expect(all.find((a) => a.slug === "under-warranty")?.display).toBe("No")
    expect(all.find((a) => a.slug === "battery-health")?.display).toBe("89 %")
  })

  it("marks the configured prominent fields as highlights", async () => {
    const display = await resolveListingDisplay(categoryId, attributes)
    expect(display.highlights.length).toBeGreaterThan(0)
    for (const highlight of display.highlights) expect(highlight.prominent).toBe(true)
  })

  it("keeps rendering a value whose field has been archived", async () => {
    await db.execute(sql`UPDATE fields SET archived_at = now() WHERE slug = 'original-box'`)

    const display = await resolveListingDisplay(categoryId, attributes)
    const orphan = display.orphaned.find((attribute) => attribute.slug === "original-box")

    // Present, moved out of its group, and flagged — not silently dropped.
    expect(orphan).toBeDefined()
    expect(orphan?.display).toBe("Yes")
    expect(display.groups.flatMap((g) => g.attributes).map((a) => a.slug)).not.toContain(
      "original-box",
    )
  })

  it("keeps rendering a chosen option after that option is archived", async () => {
    await db.execute(sql`
      UPDATE field_options SET archived_at = now()
       WHERE value_slug = '128gb'
         AND field_id = (SELECT id FROM fields WHERE slug = 'storage')
    `)

    const display = await resolveListingDisplay(categoryId, attributes)
    const storage = flatten(display).find((attribute) => attribute.slug === "storage")

    // The label lookup deliberately ignores archived_at, or this would degrade to the
    // raw slug the moment an option is retired.
    expect(storage?.display).toBe("128 GB")
  })

  it("shows a value whose field is no longer assigned to the category", async () => {
    // Detaching is not archiving: the field still exists, it just is not collected here
    // any more. The listing's answer must survive either way.
    await db.execute(sql`
      DELETE FROM category_fields
       WHERE field_id = (SELECT id FROM fields WHERE slug = 'accessories')
         AND category_id = ${categoryId}
    `)
    try {
      const display = await resolveListingDisplay(categoryId, attributes)
      const orphan = display.orphaned.find((attribute) => attribute.slug === "accessories")
      expect(orphan).toBeDefined()
      expect(orphan?.display).toContain("Charger")
    } finally {
      // Restored by hand: the afterEach only un-archives, and this test deleted a row.
      await db.execute(sql`
        INSERT INTO category_fields (category_id, field_id, group_id, sort)
        SELECT ${categoryId}, f.id, g.id, 60
          FROM fields f, field_groups g
         WHERE f.slug = 'accessories' AND g.slug = 'history'
      `)
    }
  })

  it("omits keys whose value is absent rather than rendering an empty row", async () => {
    const display = await resolveListingDisplay(categoryId, {
      ...attributes,
      colour: null,
      model: "",
    })
    const slugs = flatten(display).map((attribute) => attribute.slug)

    expect(slugs).not.toContain("colour")
    expect(slugs).not.toContain("model")
  })

  it("returns nothing for a listing with no attributes at all", async () => {
    const display = await resolveListingDisplay(categoryId, {})
    expect(display).toEqual({ highlights: [], groups: [], orphaned: [] })
  })

  it("still shows a key that matches no field row at all", async () => {
    // Should be impossible — fields cannot be hard-deleted while in use — but a
    // listing's own data must not vanish because of a bookkeeping gap.
    const display = await resolveListingDisplay(categoryId, { "gone-entirely": "kept anyway" })
    expect(display.orphaned).toHaveLength(1)
    expect(display.orphaned[0]?.display).toBe("kept anyway")
  })
})
