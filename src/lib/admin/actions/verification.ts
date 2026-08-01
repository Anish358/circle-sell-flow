"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { categories, listings } from "@/db/schema"
import { recordAudit } from "@/lib/admin/audit"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import type { AttributeValues } from "@/lib/form-schema/types"
import { validateAttributes } from "@/lib/form-schema/validation"
import { verifiableFields } from "@/lib/listings/verification"
import { failure, success, withAdmin, type ActionResult } from "./result"

/**
 * Recording what the hub measured.
 *
 * This is the third surface the registry drives, after the seller's form and the
 * product page — and it needed no new form code, no new validator and no new storage
 * shape. Which is the argument for making the schema data in the first place: a
 * feature the original design never anticipated turns out to be a filter over the
 * same rows.
 *
 * The write path mirrors `createListing` exactly, and for the same reason: the values
 * arrive from a browser, so they are coerced and validated against the registry rather
 * than trusted. Two differences, both deliberate:
 *
 *   - only fields the assignment marks `verifiable` are accepted, so an admin console
 *     bug cannot quietly overwrite a category's whole attribute set through this route;
 *   - required-ness is not enforced. A partial verification is a normal outcome; a hub
 *     records what it could measure.
 *
 * The seller's `attributes` are never touched. Correcting a seller's claim in place
 * would destroy the very comparison this feature exists to show.
 */

export type VerificationResult = ActionResult<{ cleared: boolean }>

export async function recordVerification(input: {
  listingId: string
  values: AttributeValues
}): Promise<VerificationResult> {
  return withAdmin(async (admin) => {
    const [listing] = await db
      .select({
        id: listings.id,
        slug: listings.slug,
        categorySlug: categories.slug,
        attributes: listings.attributes,
        verifiedAttributes: listings.verifiedAttributes,
      })
      .from(listings)
      .innerJoin(categories, eq(categories.id, listings.categoryId))
      .where(eq(listings.id, input.listingId))
      .limit(1)

    if (!listing) return failure("That listing no longer exists.")

    const schema = await resolveFormSchema(listing.categorySlug)
    if (!schema) {
      return failure(
        "This listing's category is deactivated, so there is nothing to verify against.",
      )
    }

    const claimed = (listing.attributes ?? {}) as AttributeValues
    const fields = verifiableFields(schema, claimed)

    if (fields.length === 0) {
      return failure(
        "No field in this category is marked for hub verification. Mark one in the category editor first.",
      )
    }

    // `draft` mode: required-ness belongs to the seller's submission, not to a
    // measurement. Everything else — coercion, ranges, live options, unknown keys —
    // applies exactly as it does on the sell path, because it is the same function.
    const validated = validateAttributes(fields, input.values, "draft")
    if (!validated.ok) {
      return failure(validated.errors._form ?? firstError(validated.errors))
    }

    // An empty record is how a verification is undone, and the row has to return to
    // being wholly unverified — a timestamp with no values would claim a measurement
    // that does not exist. The provenance check constraint enforces the same thing.
    const cleared = Object.keys(validated.attributes).length === 0

    const [after] = await db
      .update(listings)
      .set({
        verifiedAttributes: validated.attributes,
        verifiedAt: cleared ? null : new Date(),
        verifiedBy: cleared ? null : admin.id,
      })
      .where(eq(listings.id, listing.id))
      .returning({
        verifiedAttributes: listings.verifiedAttributes,
        verifiedAt: listings.verifiedAt,
      })

    await recordAudit({
      actorId: admin.id,
      action: cleared ? "listing.verification_cleared" : "listing.verified",
      entityType: "listing",
      entityId: listing.slug,
      before: { verifiedAttributes: listing.verifiedAttributes },
      after,
    })

    // The product page renders the verified values, and the queue's counts change.
    revalidatePath(`/listings/${listing.slug}`)
    revalidatePath("/admin/verification", "layout")

    return success({ cleared })
  })
}

/** Zod reports per-field messages; a server action returns one string. */
function firstError(errors: Record<string, string>): string {
  const [slug, message] = Object.entries(errors)[0] ?? []
  return slug ? `${slug}: ${message}` : "Those measurements are not valid."
}
