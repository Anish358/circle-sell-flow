import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { createListing } from "./create"

/**
 * Integration tests for the write path, against a seeded database.
 *
 * They cover the two things unit tests cannot: that the values which survive
 * validation are the values Postgres actually stores, and that the database refuses
 * a write which bypasses the API entirely.
 *
 * Run with `npm run test:db`.
 */

/** Test rows are titled with this prefix and removed afterwards. */
const PREFIX = "ZZTest"

/** Category slugs come from the sample data, which is why this file may name them. */
const HANDSET = "mobile-phone"
const SEATING = "sofa"

let sellerId: string

const common = {
  categorySlug: HANDSET,
  priceRupees: 19_999,
  condition: "good" as const,
  city: "Bengaluru",
}

/** A complete set of answers for the sample handset category. */
const complete = {
  brand: "apple",
  model: "Test Model",
  storage: "128gb",
  ram: "8gb",
  "battery-health": 90,
  "purchase-date": "2024-01-01",
}

async function storedAttributes(slug: string) {
  const [row] = await db.execute<{ attributes: Record<string, unknown> }>(
    sql`SELECT attributes FROM listings WHERE slug = ${slug}`,
  )
  return row?.attributes
}

beforeAll(async () => {
  const [seller] = await db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE role = 'seller' LIMIT 1`,
  )
  if (!seller) throw new Error("Needs a seeded database. Run npm run db:seed.")
  sellerId = seller.id
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM listings WHERE title LIKE ${`${PREFIX}%`}`)
})

describe("createListing", () => {
  it("stores a valid listing and records the schema version it was answered against", async () => {
    const result = await createListing(
      { ...common, title: `${PREFIX} Valid`, publish: true, attributes: complete },
      sellerId,
    )

    expect(result.ok, result.ok ? "" : result.message).toBe(true)
    if (!result.ok) return

    expect(result.listing.status).toBe("active")
    expect(result.listing.schemaVersion).toBeGreaterThan(0)
    // Rupees in, paise stored.
    expect(result.listing.pricePaise).toBe(1_999_900)
    expect(result.listing.sellerId).toBe(sellerId)
  })

  it("does not store the value of a field hidden by its condition", async () => {
    // Warranty answered "no", but an expiry date supplied anyway — as happens when a
    // seller fills it in and then changes their mind.
    const result = await createListing(
      {
        ...common,
        title: `${PREFIX} Hidden Value`,
        publish: true,
        attributes: {
          ...complete,
          "under-warranty": false,
          "warranty-expiry": "2027-03-01",
        },
      },
      sellerId,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const attributes = await storedAttributes(result.listing.slug)
    // Absent from the row entirely, not stored as null.
    expect(attributes && "warranty-expiry" in attributes).toBe(false)
    expect(attributes?.["under-warranty"]).toBe(false)
  })

  it("keeps the value while the condition holds", async () => {
    const result = await createListing(
      {
        ...common,
        title: `${PREFIX} Visible Value`,
        publish: true,
        attributes: { ...complete, "under-warranty": true, "warranty-expiry": "2027-03-01" },
      },
      sellerId,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const attributes = await storedAttributes(result.listing.slug)
    expect(attributes?.["warranty-expiry"]).toBe("2027-03-01")
  })

  it("rejects an attribute the category does not collect", async () => {
    const result = await createListing(
      {
        ...common,
        title: `${PREFIX} Foreign Field`,
        publish: true,
        // A field that exists, but belongs to a different branch of the tree.
        attributes: { ...complete, material: "fabric" },
      },
      sellerId,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("invalid_attributes")
    expect(result.fieldErrors?._form).toContain("material")
  })

  it("refuses fields the client must not set", async () => {
    const result = await createListing(
      {
        ...common,
        title: `${PREFIX} Mass Assignment`,
        attributes: complete,
        // Neither of these is part of the accepted body.
        status: "active",
        sellerId: "00000000-0000-0000-0000-000000000000",
      } as unknown,
      sellerId,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid_request")
  })

  it("saves an incomplete draft but refuses to publish it", async () => {
    const partial = { ...common, attributes: { brand: "apple" } }

    const draft = await createListing(
      { ...partial, title: `${PREFIX} Draft`, publish: false },
      sellerId,
    )
    expect(draft.ok).toBe(true)
    if (draft.ok) expect(draft.listing.status).toBe("draft")

    const published = await createListing(
      { ...partial, title: `${PREFIX} Publish Attempt`, publish: true },
      sellerId,
    )
    expect(published.ok).toBe(false)
    if (!published.ok) expect(published.fieldErrors?.model).toBe("Required")
  })

  it("returns the original listing when a submit is retried", async () => {
    const idempotencyKey = `${PREFIX}-retry-key-0001`
    const body = {
      ...common,
      title: `${PREFIX} Retried`,
      publish: true,
      attributes: complete,
      idempotencyKey,
    }

    const first = await createListing(body, sellerId)
    const second = await createListing(body, sellerId)

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    expect(second.reused).toBe(true)
    expect(second.listing.id).toBe(first.listing.id)

    const [row] = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM listings WHERE idempotency_key = ${idempotencyKey}`,
    )
    const count = row?.count
    expect(count).toBe(1)
  })

  it("gives listings with the same title distinct links", async () => {
    const body = {
      ...common,
      title: `${PREFIX} Identical Title`,
      publish: true,
      attributes: complete,
    }

    const a = await createListing(body, sellerId)
    const b = await createListing(body, sellerId)

    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.listing.slug).not.toBe(a.listing.slug)
  })

  it("rejects an unknown category", async () => {
    const result = await createListing(
      { ...common, categorySlug: "no-such-category", title: `${PREFIX} Nowhere`, attributes: {} },
      sellerId,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it("flags that the form changed while it was being filled in", async () => {
    const result = await createListing(
      {
        ...common,
        title: `${PREFIX} Stale Schema`,
        publish: true,
        // Deliberately behind, plus a value that fails, so the response has a reason
        // to explain itself.
        configVersion: 1,
        attributes: { ...complete, "battery-health": 500 },
      },
      sellerId,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.schemaChanged).toBe(true)
  })
})

describe("the database refuses what the API never sees", () => {
  /**
   * These bypass the application entirely. They are the reason the trigger exists:
   * validation that lives only in the API protects only the paths that go through it.
   */
  async function directWrite(statement: ReturnType<typeof sql>) {
    try {
      await db.execute(statement)
      return null
    } catch (error) {
      return String((error as { cause?: { message?: string } }).cause?.message ?? error)
    }
  }

  const target = sql`(SELECT id FROM listings WHERE status = 'active' AND attributes ? 'storage' LIMIT 1)`

  it("refuses an attribute that is not a field of the category", async () => {
    const error = await directWrite(
      sql`UPDATE listings SET attributes = attributes || '{"invented": 1}'::jsonb WHERE id = ${target}`,
    )
    expect(error).toContain("not an active field")
  })

  it("refuses a value of the wrong type", async () => {
    const error = await directWrite(
      sql`UPDATE listings SET attributes = attributes || '{"battery-health": "ninety"}'::jsonb WHERE id = ${target}`,
    )
    expect(error).toContain("must be a number")
  })

  it("refuses a select value that is not a live option", async () => {
    const error = await directWrite(
      sql`UPDATE listings SET attributes = attributes || '{"storage": "999gb"}'::jsonb WHERE id = ${target}`,
    )
    expect(error).toContain("not a live option")
  })

  it("refuses an option's label where its slug belongs", async () => {
    const error = await directWrite(
      sql`UPDATE listings SET attributes = attributes || '{"storage": "128 GB"}'::jsonb WHERE id = ${target}`,
    )
    expect(error).toContain("not a live option")
  })

  it("revalidates every attribute when a listing changes category", async () => {
    // Nothing in `attributes` changed, so a naive "only check what changed" rule
    // would let a handset move into furniture carrying its storage and RAM.
    const error = await directWrite(
      sql`UPDATE listings
             SET category_id = (SELECT id FROM categories WHERE slug = ${SEATING})
           WHERE id = ${target}`,
    )
    expect(error).toContain("not an active field")
  })

  it("still allows edits that touch only common columns", async () => {
    const error = await directWrite(sql`UPDATE listings SET city = 'Nashik' WHERE id = ${target}`)
    expect(error).toBeNull()
  })
})
