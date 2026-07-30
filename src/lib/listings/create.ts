import { eq } from "drizzle-orm"

import { db } from "@/db"
import { listings, type Listing } from "@/db/schema"
import { uniqueViolation } from "@/lib/db-errors"
import { randomSuffix, slugify } from "@/lib/slug"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { allFields } from "@/lib/form-schema/types"
import { validateAttributes, type FieldErrors } from "@/lib/form-schema/validation"
import { createListingSchema, type CreateListingBody } from "./input-schema"

/**
 * Creating a listing.
 *
 * The request body is deliberately narrow. `status`, `seller_id`, `slug` and
 * `schema_version` are all absent from it: they are decided here, from the session
 * and from the registry. A field that a client can set is a field a client can lie
 * about, and this is the one route where mass assignment would be most damaging.
 */

export type CreateListingInput = CreateListingBody

export type CreateListingResult =
  | { ok: true; listing: Listing; reused: boolean }
  | {
      ok: false
      status: 400 | 404 | 409
      code: string
      message: string
      /** Keyed by attribute slug, for the form to render inline. */
      fieldErrors?: FieldErrors
      /** True when the category's configuration moved after the form was rendered. */
      schemaChanged?: boolean
    }

export async function createListing(body: unknown, sellerId: string): Promise<CreateListingResult> {
  const parsed = createListingSchema.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "The request body is not valid.",
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "_form", issue.message]),
      ),
    }
  }

  const input = parsed.data

  // An idempotent retry must not depend on the rest of this succeeding again.
  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(input.idempotencyKey)
    if (existing) return { ok: true, listing: existing, reused: true }
  }

  const schema = await resolveFormSchema(input.categorySlug)
  if (!schema) {
    return {
      ok: false,
      status: 404,
      code: "category_not_found",
      message: `No active category "${input.categorySlug}".`,
    }
  }

  const schemaChanged =
    input.configVersion !== undefined && input.configVersion !== schema.configVersion

  // Coerces, strips values of fields that ended up hidden, rejects unknown keys,
  // and enforces required-ness only when publishing.
  const validated = validateAttributes(
    allFields(schema),
    input.attributes,
    input.publish ? "publish" : "draft",
  )

  if (!validated.ok) {
    return {
      ok: false,
      status: 400,
      code: "invalid_attributes",
      message: schemaChanged
        ? "This category's form changed while you were filling it in. Please review the highlighted fields."
        : "Some answers need attention.",
      fieldErrors: validated.errors,
      schemaChanged,
    }
  }

  let inserted: Listing | undefined
  try {
    inserted = await insertWithUniqueSlug({
      slug: slugify(input.title),
      categoryId: schema.category.id,
      // From the session, never the body.
      sellerId,
      title: input.title,
      description: input.description ?? null,
      pricePaise: Math.round(input.priceRupees * 100),
      condition: input.condition,
      city: input.city,
      status: input.publish ? "active" : "draft",
      attributes: validated.attributes,
      // Records which shape of the schema this seller actually answered.
      schemaVersion: schema.configVersion,
      idempotencyKey: input.idempotencyKey ?? null,
    })
  } catch (error) {
    // Two requests carrying the same key can both get past the lookup above. The
    // unique constraint is what actually guarantees one listing, so the loser of
    // that race resolves to the winner's row rather than reporting a failure.
    if (
      uniqueViolation(error) === "listings_idempotency_key_unique" &&
      input.idempotencyKey !== undefined
    ) {
      const existing = await findByIdempotencyKey(input.idempotencyKey)
      if (existing) return { ok: true, listing: existing, reused: true }
    }
    throw error
  }

  if (!inserted) {
    return {
      ok: false,
      status: 409,
      code: "slug_unavailable",
      message: "Could not allocate a unique link for this listing. Please try again.",
    }
  }

  return { ok: true, listing: inserted, reused: false }
}

async function findByIdempotencyKey(key: string): Promise<Listing | undefined> {
  const [existing] = await db
    .select()
    .from(listings)
    .where(eq(listings.idempotencyKey, key))
    .limit(1)
  return existing
}

/**
 * Listing slugs are SEO-bearing and unique, and titles collide constantly — two
 * people selling an "iPhone 13" is the normal case, not the edge case.
 *
 * The first listing gets the clean slug and later ones get a short random suffix.
 * A counter (`-2`, `-3`) would read better but needs a lock to be correct when two
 * sellers submit the same title at once; a random suffix needs nothing.
 *
 * Any unique violation other than the slug is rethrown, so a genuine problem is
 * never retried into silence.
 */
async function insertWithUniqueSlug(
  values: typeof listings.$inferInsert,
): Promise<Listing | undefined> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? values.slug : `${values.slug}-${randomSuffix()}`
    try {
      const [row] = await db
        .insert(listings)
        .values({ ...values, slug })
        .returning()
      if (row) return row
    } catch (error) {
      if (uniqueViolation(error) === "listings_slug_unique") continue
      throw error
    }
  }
  return undefined
}
