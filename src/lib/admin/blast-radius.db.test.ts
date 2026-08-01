import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { getReparentImpact } from "./blast-radius"

/**
 * What re-parenting would do, before it is done.
 *
 * Re-parenting is the one edit whose consequence is invisible from the row being edited:
 * the category's own assignments do not change at all, and the entire inherited set is
 * swapped underneath them. These tests pin the arithmetic of that swap, because the
 * confirmation dialog is only worth showing if the numbers in it are right.
 *
 * Nothing here writes: the impact is computed from hypothetical ancestry, so an admin can
 * try a destination and change their mind.
 *
 * Category slugs come from the sample data, which is why this file may name them.
 * Run with `npm run db:seed && npm run test:db`.
 */

const SEATING = "sofa"
const HANDSET = "mobile-phone"
const MIDDLE = "devices"
const FURNISHINGS = "furniture"

const ids = new Map<string, number>()

beforeAll(async () => {
  const rows = await db.execute<{ slug: string; id: number }>(sql`SELECT slug, id FROM categories`)
  for (const row of rows) ids.set(row.slug, row.id)
  for (const slug of [SEATING, HANDSET, MIDDLE, FURNISHINGS]) {
    if (!ids.has(slug)) throw new Error(`Needs a seeded database (no category "${slug}").`)
  }
})

function idOf(slug: string): number {
  const id = ids.get(slug)
  if (id === undefined) throw new Error(`Unknown category "${slug}"`)
  return id
}

const slugsOf = (fields: Array<{ slug: string }>) => fields.map((field) => field.slug).sort()

describe("getReparentImpact", () => {
  it("reports nothing lost or gained for a move between equivalent parents", async () => {
    // Both roots assign the same two fields, so a leaf moving between them keeps the
    // same resolved form. Worth stating: the dialog should say "no change" rather than
    // inventing reassurance, and that only works if the comparison is by field.
    const impact = await getReparentImpact(idOf(SEATING), idOf(FURNISHINGS))
    expect(impact.gained).toEqual([])
    expect(impact.lost).toEqual([])
    expect(impact.affectedListingCount).toBe(0)
  })

  it("counts what a category starts collecting when it moves deeper", async () => {
    // Moving into the middle tier picks up everything that tier and its own parent
    // assign, on top of what the category already inherited.
    const impact = await getReparentImpact(idOf(SEATING), idOf(MIDDLE))

    expect(slugsOf(impact.gained)).toEqual(
      ["brand", "colour", "model", "under-warranty", "warranty-expiry"].sort(),
    )
    // The two fields it already inherited are assigned further up the new chain too, so
    // nothing departs.
    expect(impact.lost).toEqual([])
  })

  it("counts what a category stops collecting when it moves to the top level", async () => {
    const impact = await getReparentImpact(idOf(SEATING), null)

    expect(impact.gained).toEqual([])
    expect(slugsOf(impact.lost)).toEqual(["known-issues", "purchase-date"].sort())

    // The number that makes the warning worth reading: listings that hold a value for a
    // departing field. They keep it — the product page moves it under "Additional
    // details" — but an admin should know before, not after.
    expect(impact.affectedListingCount).toBeGreaterThan(0)
  })

  it("never counts a listing twice, however many fields depart", async () => {
    const impact = await getReparentImpact(idOf(HANDSET), idOf(FURNISHINGS))
    expect(impact.lost.length).toBeGreaterThan(1)

    const [row] = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM listings WHERE category_id = ${idOf(HANDSET)}
    `)
    // A listing holding five departing fields is still one listing.
    expect(impact.affectedListingCount).toBeLessThanOrEqual(row?.count ?? 0)
  })

  it("ignores a category's own assignments, which a move never touches", async () => {
    // The handset assigns storage, RAM and battery health itself. No destination can
    // take those away, so they must never appear in `lost`.
    const impact = await getReparentImpact(idOf(HANDSET), null)
    expect(slugsOf(impact.lost)).not.toContain("storage")
    expect(slugsOf(impact.lost)).not.toContain("battery-health")
  })

  it("changes nothing in the database", async () => {
    const before = await db.execute<{ id: number; parentId: number | null }>(
      sql`SELECT id, parent_id AS "parentId" FROM categories ORDER BY id`,
    )
    await getReparentImpact(idOf(SEATING), idOf(MIDDLE))
    const after = await db.execute<{ id: number; parentId: number | null }>(
      sql`SELECT id, parent_id AS "parentId" FROM categories ORDER BY id`,
    )
    expect([...after]).toEqual([...before])
  })
})
