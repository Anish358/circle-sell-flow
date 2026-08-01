import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { ADMIN_EMAIL } from "@/db/seed/sample-listings"

/**
 * Re-categorising a listing, against a real database — which is the only place this can
 * be tested, because the rule being checked is enforced by a trigger.
 *
 * The interesting property is the asymmetry with every other registry change: archiving a
 * field keeps its values, detaching keeps them, but moving a listing **must** drop the
 * answers its new category does not collect, because the attribute trigger revalidates
 * every key when `category_id` changes. If the action ever stopped filtering, this test
 * fails on a database exception rather than on an assertion — which is the enforcement
 * working.
 *
 * Uses its own listing rather than a seeded one, so the sample data other tests read
 * stays exactly as the seed left it.
 *
 * Run with `npm run test:db`.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: ADMIN_EMAIL }) }),
}))

vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

const { previewRecategorise, recategoriseListing } = await import("./listings")

const SLUG = "zztest-recategorise-me"

/** Two of these are collected by both roots, and three only by the origin. */
const ATTRIBUTES = {
  brand: "apple",
  model: "Test Handset",
  storage: "128gb",
  "purchase-date": "2024-01-01",
  "known-issues": "None worth mentioning.",
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM listings WHERE slug = ${SLUG}`)
  await db.execute(sql`
    INSERT INTO listings (slug, category_id, seller_id, title, price_paise, condition, city,
                          status, attributes, schema_version)
    SELECT ${SLUG},
           c.id,
           (SELECT id FROM users WHERE role = 'seller' ORDER BY email LIMIT 1),
           'ZZTest listing for re-categorisation',
           100000,
           'good',
           'Bengaluru',
           'active',
           ${JSON.stringify(ATTRIBUTES)}::jsonb,
           c.config_version
      FROM categories c
     WHERE c.slug = 'mobile-phone'
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM audit_log WHERE entity_type = 'listing'
                        AND after ->> 'categoryName' IS NOT NULL
                        AND entity_id IN (SELECT id::text FROM listings WHERE slug = ${SLUG})`)
  await db.execute(sql`DELETE FROM listings WHERE slug = ${SLUG}`)
})

async function currentState() {
  const [row] = await db.execute<{
    category: string
    attributes: Record<string, unknown>
    schemaVersion: number
  }>(sql`
    SELECT c.slug AS category, l.attributes, l.schema_version AS "schemaVersion"
      FROM listings l JOIN categories c ON c.id = l.category_id
     WHERE l.slug = ${SLUG}
  `)
  return row
}

describe("previewRecategorise", () => {
  it("separates what survives the move from what does not", async () => {
    const result = await previewRecategorise({ listingSlug: SLUG, categorySlug: "sofa" })
    if (!result.ok) throw new Error(result.error)

    const kept = result.data.kept.map((value) => value.slug).sort()
    const dropped = result.data.dropped.map((value) => value.slug).sort()

    // Both roots assign these, so the shared field library carries them across for free.
    expect(kept).toEqual(["known-issues", "purchase-date"])
    // These belong to the device tiers and have no meaning in the destination.
    expect(dropped).toEqual(["brand", "model", "storage"])
  })

  it("shows values as a person reads them, not as they are stored", async () => {
    const result = await previewRecategorise({ listingSlug: SLUG, categorySlug: "sofa" })
    if (!result.ok) throw new Error(result.error)

    const storage = result.data.dropped.find((value) => value.slug === "storage")
    expect(storage?.display).toBe("128 GB")
  })

  it("names what the destination requires and this listing cannot answer", async () => {
    const result = await previewRecategorise({ listingSlug: SLUG, categorySlug: "sofa" })
    if (!result.ok) throw new Error(result.error)

    // Informational only — the listing stays live either way.
    expect(result.data.missingRequired.map((field) => field.slug)).toContain("material")
  })
})

describe("recategoriseListing", () => {
  it("moves the listing, keeps the shared answers and drops the rest", async () => {
    const result = await recategoriseListing({ listingSlug: SLUG, categorySlug: "sofa" })
    expect(result.ok).toBe(true)

    const after = await currentState()
    expect(after?.category).toBe("sofa")
    expect(Object.keys(after?.attributes ?? {}).sort()).toEqual(["known-issues", "purchase-date"])
  })

  it("records the removed values in the audit log, which is the only copy left", async () => {
    const [entry] = await db.execute<{ before: { attributes: Record<string, unknown> } }>(sql`
      SELECT before FROM audit_log
       WHERE action = 'listing.recategorise'
       ORDER BY at DESC, id DESC
       LIMIT 1
    `)

    expect(entry?.before.attributes).toMatchObject({ storage: "128gb", brand: "apple" })
  })

  it("re-stamps the schema version against the category it now belongs to", async () => {
    const [target] = await db.execute<{ configVersion: number }>(
      sql`SELECT config_version AS "configVersion" FROM categories WHERE slug = 'sofa'`,
    )
    const after = await currentState()

    expect(after?.schemaVersion).toBe(target?.configVersion)
  })

  it("refuses a category that cannot be listed in", async () => {
    const result = await recategoriseListing({ listingSlug: SLUG, categorySlug: "no-such-thing" })
    expect(result.ok).toBe(false)
  })
})
