import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { countSellerListings, getSellerListings } from "./read"
import { searchTerms } from "@/lib/search"

/**
 * "My listings" is the one read that returns rows browse deliberately hides — drafts,
 * sold items, withdrawn ones. That makes its scoping a security property rather than a
 * feature detail: the page is only safe because the query cannot be asked for somebody
 * else's rows.
 *
 * Run with `npm run test:db`.
 */

let priya: string
let rahul: string

beforeAll(async () => {
  const rows = await db.execute<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email IN ('priya@example.com', 'rahul@example.com')
  `)
  priya = rows.find((row) => row.email === "priya@example.com")!.id
  rahul = rows.find((row) => row.email === "rahul@example.com")!.id
  if (!priya || !rahul) throw new Error("Needs a seeded database.")
})

const page = (sellerId: string, q = "") =>
  getSellerListings({ sellerId, searchTerms: searchTerms(q), limit: 60, offset: 0 })

describe("getSellerListings", () => {
  it("returns only the seller's own listings", async () => {
    const [mine, theirs] = await Promise.all([page(priya), page(rahul)])

    expect(mine.length).toBeGreaterThan(0)
    expect(theirs.length).toBeGreaterThan(0)

    // The decisive assertion: no listing appears on both, and every row of each set
    // belongs to the account that asked.
    const overlap = mine.filter((row) => theirs.some((other) => other.slug === row.slug))
    expect(overlap).toEqual([])

    const owners = await db.execute<{ slug: string; email: string }>(sql`
      SELECT l.slug, u.email FROM listings l JOIN users u ON u.id = l.seller_id
    `)
    for (const row of mine) {
      expect(owners.find((o) => o.slug === row.slug)?.email).toBe("priya@example.com")
    }
  })

  it("includes the states browse hides, which is the point of the page", async () => {
    const mine = await page(priya)
    const states = new Set(mine.map((row) => row.status))

    // The seeded draft and the seeded sold listing both belong to this account.
    expect(states.has("draft")).toBe(true)
    expect(states.has("sold")).toBe(true)
  })

  it("puts drafts first, because they are the rows waiting on the reader", async () => {
    const mine = await page(priya)
    const lastDraft = mine.map((row) => row.status).lastIndexOf("draft")
    const firstOther = mine.findIndex((row) => row.status !== "draft")

    expect(lastDraft).toBeLessThan(firstOther === -1 ? Infinity : firstOther)
  })

  it("searches within the seller's own rows only", async () => {
    // A term that matches the other seller's listings must still return nothing here.
    const theirs = await page(rahul)
    const theirTitle = theirs[0]!.title.split(" ")[0]!

    const mine = await page(priya, theirTitle)
    for (const row of mine) {
      expect(theirs.some((other) => other.slug === row.slug)).toBe(false)
    }
  })

  it("counts the same set it pages", async () => {
    const [total, rows] = await Promise.all([countSellerListings(priya), page(priya)])

    expect(total).toBe(rows.length)
  })

  it("pages without repeating or dropping a row", async () => {
    const all = await page(priya)
    const half = Math.ceil(all.length / 2)

    const [first, second] = await Promise.all([
      getSellerListings({ sellerId: priya, limit: half, offset: 0 }),
      getSellerListings({ sellerId: priya, limit: half, offset: half }),
    ])

    expect([...first, ...second].map((row) => row.slug)).toEqual(all.map((row) => row.slug))
  })
})
