import { eq } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { listings, listingCondition, type Listing } from "@/db/schema"
import { uniqueViolation } from "@/lib/db-errors"
import { randomSuffix, slugify } from "@/lib/slug"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { allFields } from "@/lib/form-schema/types"
import { validateAttributes, type FieldErrors } from "@/lib/form-schema/validation"

/**
 * Creating a listing.
 *
 * The request body is deliberately narrow. `status`, `seller_id`, `slug` and
 * `schema_version` are all absent from it: they are decided here, from the session
 * and from the registry. A field that a client can set is a field a client can lie
 * about, and this is the one route where mass assignment would be most damaging.
 */

/**
 * Only the common columns a seller actually fills in, plus the category-specific
 * `attributes` object which is validated separately against the resolved schema.
 */
const requestSchema = z.strictObject({
  categorySlug: z.string().min(1),

  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(4000).optional(),

  // Rupees from the client, paise in the database. Converting at the boundary keeps
  // the unit unambiguous everywhere inside.
  priceRupees: z.number().positive().max(1_000_000_000),

  condition: z.literal(listingCondition.enumValues),
  city: z.string().trim().min(1).max(80),

  attributes: z.record(z.string(), z.unknown()).default({}),

  /** Draft saves while incomplete; publishing demands a complete answer. */
  publish: z.boolean().default(false),

  /**
   * The `config_version` the form was rendered against. Not trusted for
   * validation — that always runs against the current schema — but it lets the
   * response say "the form changed while you were filling it in" instead of
   * presenting unexplained errors.
   */
  configVersion: z.number().int().optional(),

  /** Makes a retried submit safe. */
  idempotencyKey: z.string().min(8).max(200).optional(),
})

export type CreateListingInput = z.input<typeof requestSchema>

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
  const parsed = requestSchema.safeParse(body)
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
