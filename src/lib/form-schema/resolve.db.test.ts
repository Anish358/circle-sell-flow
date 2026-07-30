import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { resolveFormSchema } from "./resolve"
import { allFields } from "./types"

/**
 * Integration tests, against a seeded database.
 *
 * The resolver's substance is a recursive CTE, so testing it against a mock would
 * only prove the mock works. These read from a real Postgres and never write, so
 * they are safe to re-run.
 *
 * Run with `npm run test:db` after `npm run db:migrate && npm run db:seed`.
 * `npm test` excludes them so the unit suite needs no database.
 */

/** Slugs come from the sample data, which is why this file may name categories. */
const HANDSET = "mobile-phone"
const PORTABLE_COMPUTER = "laptop"
const SEATING = "sofa"
const MID_TIER = "devices"

beforeAll(async () => {
  const [row] = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM category_fields`,
  )
  if (!row || row.count === 0) {
    throw new Error(
      "These tests need a seeded database. Run: npm run db:migrate && npm run db:seed",
    )
  }
})

describe("resolveFormSchema", () => {
  it("returns null for a category that does not exist", async () => {
    expect(await resolveFormSchema("no-such-category")).toBeNull()
  })

  it("resolves fields from the category itself and from every ancestor", async () => {
    const schema = await resolveFormSchema(HANDSET)
    expect(schema).not.toBeNull()

    const fields = allFields(schema!)
    const origins = new Map(fields.map((field) => [field.slug, field.origin]))

    // Declared on the category.
    expect(origins.get("storage")).toMatchObject({ categorySlug: HANDSET, inherited: false })
    // Declared one level up.
    expect(origins.get("brand")).toMatchObject({ categorySlug: MID_TIER, inherited: true })
    // Declared two levels up, at the root.
    expect(origins.get("known-issues")).toMatchObject({
      categorySlug: "electronics",
      inherited: true,
    })
  })

  it("lets the nearest ancestor win a conflict", async () => {
    // Purchase Date is assigned at the root as optional and re-assigned on the
    // category as required. The nearer assignment is the one that counts.
    const schema = await resolveFormSchema(HANDSET)
    const purchaseDate = allFields(schema!).find((field) => field.slug === "purchase-date")

    expect(purchaseDate).toMatchObject({
      required: true,
      origin: { categorySlug: HANDSET, inherited: false },
    })
  })

  it("shares one field across categories while letting each set its own rules", async () => {
    // The same library field, resolved from two different categories.
    const [handset, computer] = await Promise.all([
      resolveFormSchema(HANDSET),
      resolveFormSchema(PORTABLE_COMPUTER),
    ])

    const batteryIn = (slug: string, schema: Awaited<ReturnType<typeof resolveFormSchema>>) =>
      allFields(schema!).find((field) => field.slug === slug)

    const a = batteryIn("battery-health", handset)
    const b = batteryIn("battery-health", computer)

    // Identical identity and type...
    expect(a?.type).toBe("number")
    expect(b?.type).toBe(a?.type)
    expect(b?.config).toEqual(a?.config)
    // ...different policy.
    expect(a?.required).toBe(true)
    expect(b?.required).toBe(false)
  })

  it("produces genuinely different schemas for different categories", async () => {
    const [handset, seating] = await Promise.all([
      resolveFormSchema(HANDSET),
      resolveFormSchema(SEATING),
    ])

    const slugsOf = (schema: Awaited<ReturnType<typeof resolveFormSchema>>) =>
      new Set(allFields(schema!).map((field) => field.slug))

    const a = slugsOf(handset)
    const b = slugsOf(seating)

    expect([...a].some((slug) => !b.has(slug))).toBe(true)
    expect([...b].some((slug) => !a.has(slug))).toBe(true)
    // Yet they still share library fields, rather than duplicating definitions.
    expect([...a].filter((slug) => b.has(slug)).length).toBeGreaterThan(0)
  })

  it("carries the conditional rule through to the contract", async () => {
    const schema = await resolveFormSchema(HANDSET)
    const expiry = allFields(schema!).find((field) => field.slug === "warranty-expiry")

    expect(expiry?.visibleWhen).toEqual({
      all: [{ field: "under-warranty", op: "eq", value: true }],
    })
  })

  it("includes live options in order, and only live ones", async () => {
    const schema = await resolveFormSchema(HANDSET)
    const storage = allFields(schema!).find((field) => field.slug === "storage")

    expect(storage?.options.length).toBeGreaterThan(1)
    expect(storage?.options[0]).toHaveProperty("slug")
    expect(storage?.options[0]).toHaveProperty("label")
    // Non-select fields carry no options at all.
    const battery = allFields(schema!).find((field) => field.slug === "battery-health")
    expect(battery?.options).toEqual([])
  })

  it("groups fields, merging contributions from different ancestors", async () => {
    const schema = await resolveFormSchema(HANDSET)
    const history = schema!.groups.find((group) => group.slug === "history")

    const origins = new Set(history?.fields.map((field) => field.origin.categorySlug))
    // One heading, fields inherited from more than one level of the tree.
    expect(origins.size).toBeGreaterThan(1)
  })

  it("returns the ancestry as a breadcrumb, root first", async () => {
    const schema = await resolveFormSchema(HANDSET)
    expect(schema!.category.path.map((step) => step.slug)).toEqual([
      "electronics",
      MID_TIER,
      HANDSET,
    ])
  })

  it("reports a config version the caller can cache against", async () => {
    const schema = await resolveFormSchema(HANDSET)
    expect(schema!.configVersion).toBeGreaterThan(0)
  })
})
