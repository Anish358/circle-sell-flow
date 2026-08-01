import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { verifiableFields } from "./verification"

/**
 * What the database guarantees about verified values, independently of the code that
 * writes them.
 *
 * This matters more here than anywhere else in the project. A verified attribute is the
 * platform vouching for a fact about someone else's property — if that can be written by
 * an admin script, a future mobile client or a psql session without the same checks the
 * API applies, the badge on the product page means nothing. So the assertions below all
 * bypass the application entirely and go straight at Postgres.
 *
 * Run with `npm run db:seed && npm run test:db`.
 */

/** Category slugs come from the sample data, which is why this file may name them. */
const HANDSET = "mobile-phone"

const PREFIX = "ZZVerify"

let listingId: string
let verifierId: string

/** A listing of our own, so nothing here depends on the sample rows staying put. */
beforeAll(async () => {
  const [seller] = await db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE role = 'seller' LIMIT 1`,
  )
  const [admin] = await db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
  )
  if (!seller || !admin) throw new Error("Needs a seeded database. Run npm run db:seed.")
  verifierId = admin.id

  const [row] = await db.execute<{ id: string }>(sql`
    INSERT INTO listings (slug, category_id, seller_id, title, price_paise, condition, city,
                          status, attributes, schema_version)
    SELECT ${`${PREFIX.toLowerCase()}-subject`}, c.id, ${seller.id}, ${`${PREFIX} Subject`},
           100000, 'good', 'Bengaluru', 'active',
           '{"brand": "apple", "model": "Test", "storage": "128gb", "ram": "8gb",
             "battery-health": 92, "purchase-date": "2024-01-01"}'::jsonb,
           c.config_version
      FROM categories c WHERE c.slug = ${HANDSET}
    RETURNING id
  `)
  if (!row) throw new Error("Could not create the test listing.")
  listingId = row.id
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM listings WHERE title LIKE ${`${PREFIX}%`}`)
})

/**
 * Writes verified values the way a script bypassing the API would, and returns the
 * database's complaint — or null if it allowed the write.
 *
 * Drizzle wraps driver errors, so the message that names the constraint or the trigger
 * sits on `.cause`.
 */
async function verifyDirectly(values: object, provenance = true): Promise<string | null> {
  try {
    await db.execute(sql`
      UPDATE listings
         SET verified_attributes = ${JSON.stringify(values)}::jsonb,
             verified_at = ${provenance ? sql`now()` : sql`NULL`},
             verified_by = ${provenance ? sql`${verifierId}` : sql`NULL`}
       WHERE id = ${listingId}
    `)
    return null
  } catch (error) {
    return String((error as { cause?: { message?: string } }).cause?.message ?? error)
  }
}

describe("the database's guarantees about verified values", () => {
  it("stores a well-formed verification", async () => {
    expect(await verifyDirectly({ "battery-health": 86, storage: "128gb" })).toBeNull()

    const [row] = await db.execute<{ verified: Record<string, unknown>; at: Date | null }>(
      sql`SELECT verified_attributes AS verified, verified_at AS at FROM listings WHERE id = ${listingId}`,
    )
    expect(row?.verified["battery-health"]).toBe(86)
    expect(row?.at).not.toBeNull()
  })

  it("leaves the seller's own claim untouched", async () => {
    // The comparison the product page shows only exists because the two documents are
    // separate. An implementation that "corrected" the seller would destroy it.
    const [row] = await db.execute<{ attributes: Record<string, unknown> }>(
      sql`SELECT attributes FROM listings WHERE id = ${listingId}`,
    )
    expect(row?.attributes["battery-health"]).toBe(92)
  })

  it("refuses a verified value of the wrong type", async () => {
    const error = await verifyDirectly({ "battery-health": "eighty-six" })
    expect(error).toContain("invalid verified attributes")
    expect(error).toContain("must be a number")
  })

  it("refuses a verified value for a field this category does not collect", async () => {
    // The field exists — it belongs to a different branch of the tree.
    const error = await verifyDirectly({ material: "fabric" })
    expect(error).toContain("not an active field")
  })

  it("refuses a verified select value that is not a live option", async () => {
    const error = await verifyDirectly({ storage: "999tb" })
    expect(error).toContain("not a live option")
  })

  it("refuses a verified value with no provenance", async () => {
    // A measurement that cannot say who took it and when is the unfalsifiable claim
    // this feature exists to replace.
    const error = await verifyDirectly({ "battery-health": 86 }, false)
    expect(error).toContain("listings_verified_provenance")
  })

  it("refuses a timestamp with no actor", async () => {
    let error: string | null = null
    try {
      await db.execute(sql`
        UPDATE listings SET verified_attributes = '{"battery-health": 86}'::jsonb,
                            verified_at = now(), verified_by = NULL
         WHERE id = ${listingId}
      `)
    } catch (caught) {
      error = String((caught as { cause?: { message?: string } }).cause?.message ?? caught)
    }
    expect(error).toContain("listings_verified_provenance")
  })

  it("accepts clearing a verification back to wholly unverified", async () => {
    expect(await verifyDirectly({}, false)).toBeNull()

    const [row] = await db.execute<{ at: Date | null; by: string | null }>(
      sql`SELECT verified_at AS at, verified_by AS by FROM listings WHERE id = ${listingId}`,
    )
    expect(row?.at).toBeNull()
    expect(row?.by).toBeNull()
  })

  it("does not retro-invalidate a verification when the configuration moves", async () => {
    expect(await verifyDirectly({ storage: "128gb" })).toBeNull()

    // Retire the option the hub recorded, then touch the row for an unrelated reason.
    await db.execute(sql`
      UPDATE field_options SET archived_at = now()
       WHERE value_slug = '128gb'
         AND field_id = (SELECT id FROM fields WHERE slug = 'storage')
    `)

    try {
      await expect(
        db.execute(sql`UPDATE listings SET city = 'Pune' WHERE id = ${listingId}`),
      ).resolves.toBeDefined()
    } finally {
      await db.execute(sql`
        UPDATE field_options SET archived_at = NULL
         WHERE value_slug = '128gb'
           AND field_id = (SELECT id FROM fields WHERE slug = 'storage')
      `)
    }
  })
})

describe("which questions the hub is asked", () => {
  it("comes from the resolved schema, inheritance included", async () => {
    const schema = await resolveFormSchema(HANDSET)
    expect(schema).not.toBeNull()
    if (!schema) return

    const fields = verifiableFields(schema, {})
    expect(fields.length).toBeGreaterThan(0)
    // Every one of them is a field the category actually collects, and the hub's form
    // never contains a question the seller's did not.
    for (const field of fields) {
      expect(field.verifiable).toBe(true)
    }
  })
})
