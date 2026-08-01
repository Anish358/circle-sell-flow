import { sql } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"

import { db } from "@/db"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { buildFacets, readSelections, toAttributeFilters, type SearchParams } from "./facets"
import { getListingPage } from "./read"

/**
 * The buyer path end to end, against real data: URL → registry validation → SQL.
 *
 * Worth an integration test rather than a unit one because the substance is in the
 * database — jsonb containment reaching inside an array, a recursive walk *down* the
 * category tree, and a range that has to survive listings which never answered the
 * field at all. None of that is observable with a mocked query builder.
 *
 * Run with `npm run test:db`, against the seeded sample data.
 */

async function browse(categorySlug: string, params: SearchParams = {}) {
  const schema = await resolveFormSchema(categorySlug)
  if (!schema) throw new Error(`Needs a seeded database (no category "${categorySlug}").`)

  const facets = buildFacets(schema)
  const selections = readSelections(facets, params)
  const page = await getListingPage({ categorySlug, filters: toAttributeFilters(selections) })

  return { facets, page }
}

async function slugs(categorySlug: string, params: SearchParams = {}) {
  const { page } = await browse(categorySlug, params)
  return page.listings.map((listing) => listing.slug).sort()
}

/** What an admin ticking the `filterable` box on an assignment does — nothing more. */
async function setFilterable(categorySlug: string, fieldSlug: string, filterable: boolean) {
  await db.execute(sql`
    UPDATE category_fields cf
       SET filterable = ${filterable}
      FROM categories c, fields f
     WHERE cf.category_id = c.id
       AND cf.field_id = f.id
       AND c.slug = ${categorySlug}
       AND f.slug = ${fieldSlug}
  `)
}

// Every flag this file flips, put back — the next test run and the next manual look
// at the app should both see the registry the seed describes.
afterAll(async () => {
  await setFilterable("mobile-phone", "accessories", false)
  await setFilterable("mobile-phone", "purchase-date", false)
  await setFilterable("laptop", "battery-health", false)
})

describe("category browsing", () => {
  it("shows a tier's listings by walking down to its leaves", async () => {
    // Nothing is listed against "electronics" itself; every row lives two levels below.
    const found = await slugs("electronics")

    expect(found.length).toBeGreaterThan(0)
    expect(found).toContain("apple-iphone-13-128gb-midnight")
    expect(found).toContain("dell-xps-13-i7-16gb")
  })

  it("keeps drafts off browse however it is filtered", async () => {
    const found = await slugs("mobile-phone")

    expect(found.some((slug) => slug.includes("draft"))).toBe(false)
  })

  it("offers facets from the category's own resolved schema", async () => {
    const phone = await browse("mobile-phone")
    const sofa = await browse("sofa")

    expect(phone.facets.map((facet) => facet.slug)).toEqual(["storage", "ram", "battery-health"])
    expect(sofa.facets.map((facet) => facet.slug)).toEqual([
      "material",
      "seating-capacity",
      "pet-friendly",
    ])
  })

  it("offers no facets on a tier that assigns no filterable field of its own", async () => {
    // Inheritance runs downward, so a middle tier does not acquire its children's
    // fields — and a URL naming one of them filters nothing rather than erroring.
    const { facets } = await browse("electronics")
    const unchanged = await slugs("electronics", { "f.ram": "8gb" })

    expect(facets).toEqual([])
    expect(unchanged).toEqual(await slugs("electronics"))
  })
})

describe("attribute filters", () => {
  it("matches a single-select value by containment", async () => {
    expect(await slugs("mobile-phone", { "f.ram": "8gb" })).toEqual([
      "google-pixel-7a-128gb-charcoal",
      "oneplus-11r-128gb-black",
      "samsung-galaxy-s22-256gb-green",
    ])
  })

  it("ORs values within a facet and ANDs across facets", async () => {
    const anyRam = await slugs("mobile-phone", { "f.ram": "4gb,8gb" })
    const andStorage = await slugs("mobile-phone", { "f.ram": "4gb,8gb", "f.storage": "128gb" })

    expect(anyRam).toHaveLength(4)
    expect(andStorage).toEqual([
      "apple-iphone-13-128gb-midnight",
      "google-pixel-7a-128gb-charcoal",
      "oneplus-11r-128gb-black",
    ])
    // Adding a facet can only narrow: every result still satisfies the first one.
    expect(anyRam).toEqual(expect.arrayContaining(andStorage))
  })

  it("filters a number by range", async () => {
    expect(await slugs("mobile-phone", { "f.battery-health.min": "90" })).toEqual([
      "apple-iphone-15-256gb-blue",
      "google-pixel-7a-128gb-charcoal",
      "oneplus-11r-128gb-black",
      "samsung-galaxy-s22-256gb-green",
    ])
    expect(await slugs("mobile-phone", { "f.battery-health.max": "90" })).toEqual([
      "apple-iphone-13-128gb-midnight",
      "nothing-phone-2-256gb-white",
    ])
  })

  it("does not match a listing that never answered the field", async () => {
    // The same field, optional on this category, and two of its listings left it
    // blank. A bound has to mean "answered, and within" — "unknown" is not "0".
    await setFilterable("laptop", "battery-health", true)

    expect(await slugs("laptop", { "f.battery-health.min": "0" })).toEqual([
      "apple-macbook-air-m2-16gb-512gb",
      "lenovo-thinkpad-t14-i5-16gb",
    ])
    expect((await slugs("laptop")).length).toBeGreaterThan(2)
  })

  it("filters a boolean", async () => {
    expect(await slugs("sofa", { "f.pet-friendly": "true" })).toEqual([
      "cane-two-seater-with-cushions",
      "two-seater-leather-recliner",
    ])
    // Both sides selected is not a filter at all, and must not silently exclude a
    // listing that answered either way.
    expect(await slugs("sofa", { "f.pet-friendly": "true,false" })).toEqual(await slugs("sofa"))
  })

  it("ignores a value the registry no longer offers, and keeps the rest", async () => {
    expect(await slugs("mobile-phone", { "f.ram": "8gb,999gb" })).toEqual(
      await slugs("mobile-phone", { "f.ram": "8gb" }),
    )
    expect(await slugs("mobile-phone", { "f.ram": "999gb" })).toEqual(await slugs("mobile-phone"))
  })

  it("never lets a parameter reach SQL as a column or a key of its own", async () => {
    // The URL is untrusted input: an unknown key is dropped by the same registry check
    // that guards a write, so this is an unfiltered page rather than an error or a leak.
    const injected = await slugs("mobile-phone", {
      "f.seller-id": "x",
      "f.status": "draft",
      "f.ram'--": "8gb",
    })

    expect(injected).toEqual(await slugs("mobile-phone"))
  })
})

describe("a filter appearing because an admin ticked a box", () => {
  it("facets a multi-select through the array, with no schema change", async () => {
    expect((await browse("mobile-phone")).facets.map((f) => f.slug)).not.toContain("accessories")

    await setFilterable("mobile-phone", "accessories", true)
    const { facets } = await browse("mobile-phone")

    expect(facets.map((facet) => facet.slug)).toContain("accessories")
    // Containment reaches inside the stored array: "includes a case" needs no
    // different operator from "is 8 GB", and uses the same index.
    expect(await slugs("mobile-phone", { "f.accessories": "case" })).toEqual([
      "google-pixel-7a-128gb-charcoal",
      "samsung-galaxy-s22-256gb-green",
    ])
    expect(await slugs("mobile-phone", { "f.accessories": "charger" })).toEqual([
      "apple-iphone-13-128gb-midnight",
      "nothing-phone-2-256gb-white",
      "oneplus-11r-128gb-black",
      "samsung-galaxy-s22-256gb-green",
    ])
  })

  it("facets a date as a range", async () => {
    await setFilterable("mobile-phone", "purchase-date", true)

    expect(await slugs("mobile-phone", { "f.purchase-date.min": "2024-01-01" })).toEqual([
      "apple-iphone-15-256gb-blue",
      "google-pixel-7a-128gb-charcoal",
      "oneplus-11r-128gb-black",
      "samsung-galaxy-s22-256gb-green",
    ])
  })
})

describe("paging a filtered view", () => {
  it("carries the filter across pages without repeating a listing", async () => {
    const schema = await resolveFormSchema("mobile-phone")
    const filters = toAttributeFilters(
      readSelections(buildFacets(schema!), { "f.storage": "128gb,256gb" }),
    )

    // Every handset in the sample data holds one of those two capacities, so the
    // filtered set is the whole category and the page boundary is the only variable.
    const whole = await getListingPage({ categorySlug: "mobile-phone", filters, limit: 50 })
    expect(whole.listings.length).toBeGreaterThan(2)

    const first = await getListingPage({ categorySlug: "mobile-phone", filters, limit: 2 })
    expect(first.nextCursor).not.toBeNull()

    const second = await getListingPage({
      categorySlug: "mobile-phone",
      filters,
      limit: 50,
      cursor: first.nextCursor!,
    })

    const seen = [...first.listings, ...second.listings].map((listing) => listing.slug)
    // Nothing repeated across the boundary, and nothing lost at it — the two halves
    // reassemble into exactly the unpaged result, in the same order.
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toEqual(whole.listings.map((listing) => listing.slug))
  })
})
