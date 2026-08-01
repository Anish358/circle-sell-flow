"use server"

import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { listings } from "@/db/schema"
import { getRecategoriseImpact, type RecategoriseImpact } from "@/lib/admin/blast-radius"
import { recordAudit } from "@/lib/admin/audit"
import { requireAdmin } from "@/lib/auth"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { allFields } from "@/lib/form-schema/types"
import { getListingBySlug } from "@/lib/listings/read"
import { matchesAllTerms } from "@/lib/search"
import { failure, success, withAdmin, type ActionResult } from "./result"

/**
 * Moving a listing to a different category — the operation Circle's own admin console
 * calls category remapping.
 *
 * Mis-categorised listings are not an edge case on a C2C marketplace; they are a daily
 * occurrence, and the reason the destination matters is that a listing's category decides
 * what it is allowed to say about itself. Which makes this the one admin action that
 * removes data, and the whole design here is about doing that visibly:
 *
 *   - the dialog names every value that will not survive, with its formatted value;
 *   - the drop happens in the same statement as the move, so a listing is never briefly
 *     holding attributes its category forbids;
 *   - the audit row records the attributes as they were, so the values are recoverable by
 *     a person even though the move is not undoable by a click.
 *
 * The alternative — carrying foreign attributes along as "orphaned but displayable", the
 * way archiving a field does — was rejected by the schema before it was rejected here:
 * the attribute trigger revalidates every key when `category_id` changes. Archiving says
 * "we stopped asking this question"; re-categorising says "this was never that kind of
 * thing", and a listing asserting a measurement its category has no concept of is not
 * history worth preserving.
 */

export async function previewRecategorise(input: {
  listingSlug: string
  categorySlug: string
}): Promise<ActionResult<RecategoriseImpact>> {
  return withAdmin(async () => {
    const impact = await getRecategoriseImpact(input.listingSlug, input.categorySlug)
    if (!impact) return failure("That listing or category is no longer available.")
    return success(impact)
  })
}

export async function recategoriseListing(input: {
  listingSlug: string
  categorySlug: string
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const listing = await getListingBySlug(input.listingSlug)
    if (!listing) return failure("That listing no longer exists.")

    const target = await resolveFormSchema(input.categorySlug)
    if (!target) return failure("That category is not available to move listings into.")
    if (target.category.id === listing.categoryId) return success(null)

    const collected = new Set(allFields(target).map((field) => field.slug))
    const keep = (document: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(document).filter(([slug]) => collected.has(slug)))

    const attributes = keep(listing.attributes)
    const verifiedAttributes = keep(listing.verifiedAttributes)

    // One statement: category and both documents move together, so the row is never in a
    // state the trigger would have refused.
    await db
      .update(listings)
      .set({
        categoryId: target.category.id,
        attributes,
        verifiedAttributes,
        // The listing now describes itself in the destination's terms, so the version it
        // is measured against is the destination's. What it used to hold is in the audit
        // row rather than implied by a number from another category's counter.
        schemaVersion: target.configVersion,
        // A verification is a fact about the item, not about the category, so it stands.
        // If every measured field was dropped, the provenance constraint would be left
        // holding a timestamp with an empty document — legal, and honest: the hub did
        // check it, and nothing it checked belongs to this category any more.
      })
      .where(eq(listings.id, listing.id))

    await recordAudit({
      actorId: admin.id,
      action: "listing.recategorise",
      entityType: "listing",
      entityId: listing.id,
      // The full previous documents, deliberately: this is the only copy of the values
      // the move removes.
      before: {
        categoryId: listing.categoryId,
        categoryName: listing.categoryName,
        attributes: listing.attributes,
        verifiedAttributes: listing.verifiedAttributes,
        schemaVersion: listing.schemaVersion,
      },
      after: {
        categoryId: target.category.id,
        categoryName: target.category.name,
        attributes,
        verifiedAttributes,
        schemaVersion: target.configVersion,
      },
    })

    revalidatePath("/", "layout")
    return success(null)
  })
}

/** Listings an admin can act on, newest first. */
export type AdminListingRow = {
  id: string
  slug: string
  title: string
  status: string
  categoryName: string
  categorySlug: string
  sellerName: string
  attributeCount: number
}

export async function listAdminListings(
  /**
   * Words the listing must match, across the three things an operator has in mind when
   * they go looking: what it is called, who is selling it, and what it is filed under.
   */
  terms: readonly string[] = [],
): Promise<AdminListingRow[]> {
  // Everything exported from a `"use server"` module is a callable endpoint, reads
  // included — so this checks the role itself rather than relying on the page that
  // happens to call it.
  await requireAdmin()

  const rows = await db.execute<AdminListingRow>(sql`
    SELECT l.id,
           l.slug,
           l.title,
           l.status,
           c.name AS "categoryName",
           c.slug AS "categorySlug",
           u.name AS "sellerName",
           (SELECT count(*)::int FROM jsonb_object_keys(l.attributes)) AS "attributeCount"
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      JOIN users u ON u.id = l.seller_id
     WHERE l.status <> 'removed'
       AND ${matchesAllTerms(terms, [sql`l.title`, sql`u.name`, sql`c.name`]) ?? sql`true`}
     ORDER BY l.created_at DESC, l.slug DESC
     LIMIT 100
  `)

  return [...rows]
}
