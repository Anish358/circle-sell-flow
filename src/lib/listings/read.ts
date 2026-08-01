import { and, desc, eq, or, sql, type SQL } from "drizzle-orm"

import { db } from "@/db"
import { categories, listings, users, type ListingCondition, type ListingStatus } from "@/db/schema"
import type { AttributeFilter } from "./facets"

/**
 * Reading listings — the browse and detail paths.
 *
 * Cards need only common columns, which is the point made in the storage decision:
 * because nothing on the homepage reads `attributes`, `jsonb` costs nothing here. No
 * pivot, no join per listing, no N+1.
 */

export type ListingCard = {
  slug: string
  title: string
  pricePaise: number
  currency: string
  condition: ListingCondition
  city: string
  createdAt: Date
  categoryName: string
  categorySlug: string
  primaryImage: { url: string; alt: string | null } | null
  /** Null while unverified. Cards show only that it happened, not what was measured. */
  verifiedAt: Date | null
}

export type ListingDetail = ListingCard & {
  id: string
  description: string | null
  status: ListingStatus
  /** Needed to decide who may view a draft. */
  sellerId: string
  attributes: Record<string, unknown>
  /** What the hub measured, keyed by the same field slugs. Empty while unverified. */
  verifiedAttributes: Record<string, unknown>
  verifiedByName: string | null
  schemaVersion: number
  categoryId: number
  sellerName: string
  images: Array<{ url: string; alt: string | null }>
}

/**
 * Opaque cursor for keyset pagination.
 *
 * `createdAt` is the database's own rendering of the timestamp, not a JavaScript
 * `Date` turned back into a string — see the tuple comparison below for why the
 * difference decides whether paging works at all.
 */
export type ListingCursor = { createdAt: string; slug: string }

const DEFAULT_PAGE_SIZE = 24

/**
 * A page of live listings, newest first, optionally narrowed to a category and to
 * attribute filters the buyer chose from that category's facets.
 *
 * Keyset pagination rather than `OFFSET`: on a marketplace new listings arrive
 * constantly, and an offset silently duplicates and skips rows as the set shifts
 * underneath the reader. The cursor is `(created_at, slug)` — `created_at` alone is not
 * unique enough to break ties deterministically, and a page boundary landing inside a
 * tie is exactly how rows get shown twice.
 */
export async function getListingPage(
  options: {
    cursor?: ListingCursor
    limit?: number
    /** Includes everything beneath it, so browsing a tier shows its leaves' listings. */
    categorySlug?: string
    /** Already validated against the category's registry — see `./facets`. */
    filters?: readonly AttributeFilter[]
  } = {},
): Promise<{ listings: ListingCard[]; nextCursor: ListingCursor | null }> {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, 60)

  /**
   * "Strictly after the cursor", as a row comparison.
   *
   * Two things this form gets right that the equivalent `a < x OR (a = x AND b < y)`
   * did not. It matches the `(created_at DESC, slug DESC)` ordering as one predicate,
   * which the planner can drive straight off an index. And the timestamp stays a
   * string all the way into SQL: a Postgres `timestamptz` holds microseconds, a
   * JavaScript `Date` holds milliseconds, so parsing the cursor into a `Date` quietly
   * truncated it — and a truncated bound is *below* every row it was meant to tie
   * with, so the second page of any set of listings sharing a timestamp came back
   * empty. Ties are exactly what a tie-break exists for; seeded and bulk-imported
   * rows are full of them.
   */
  const after: SQL | undefined = options.cursor
    ? sql`(${listings.createdAt}, ${listings.slug}) < (${options.cursor.createdAt}::timestamptz, ${options.cursor.slug})`
    : undefined

  const withinCategory = options.categorySlug ? inCategorySubtree(options.categorySlug) : undefined
  const matchesFilters = (options.filters ?? []).map(filterCondition)

  const rows = await db
    .select({
      slug: listings.slug,
      title: listings.title,
      pricePaise: listings.pricePaise,
      currency: listings.currency,
      condition: listings.condition,
      city: listings.city,
      createdAt: listings.createdAt,
      // The same instant at the database's own precision, for the cursor.
      cursorAt: sql<string>`${listings.createdAt}::text`,
      categoryName: categories.name,
      categorySlug: categories.slug,
      verifiedAt: listings.verifiedAt,
      imageUrl: primaryImageUrl,
      imageAlt: primaryImageAlt,
    })
    .from(listings)
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    // Drafts, sold and removed listings stay off the homepage.
    .where(and(eq(listings.status, "active"), after, withinCategory, ...matchesFilters))
    .orderBy(desc(listings.createdAt), desc(listings.slug))
    // One extra row is the cheapest way to know whether another page exists.
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page.at(-1)

  return {
    listings: page.map(toCard),
    nextCursor: rows.length > limit && last ? { createdAt: last.cursorAt, slug: last.slug } : null,
  }
}

/**
 * Every category at or beneath the given slug.
 *
 * Downward, where the form resolver walks upward — and for the mirror-image reason.
 * Fields are inherited from ancestors, so a tier's *listings* are held by its
 * descendants: browsing a middle tier has to reach the leaves or it shows nothing.
 *
 * Inactive descendants are included deliberately. Deactivating a category stops new
 * listings being created in it; it does not retire the ones already sold in good
 * faith, and having them silently vanish from browse would be a config change
 * rewriting history.
 */
function inCategorySubtree(slug: string): SQL {
  return sql`${listings.categoryId} IN (
    WITH RECURSIVE subtree AS (
      SELECT id FROM categories WHERE slug = ${slug}
      UNION ALL
      SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
    )
    SELECT id FROM subtree
  )`
}

/**
 * One attribute filter as a predicate.
 *
 * Equality goes through `@>` rather than `->>`, which is the whole reason the GIN
 * index on `attributes` exists: containment is indexable, and it reaches inside
 * arrays, so a multi-select's "includes USB-C" is the same operator as a
 * single-select's "is 8 GB". Several values for one facet are ORed, so each
 * alternative stays its own indexable containment; separate facets are ANDed by the
 * caller.
 */
function filterCondition(filter: AttributeFilter): SQL | undefined {
  if (filter.kind === "match") {
    const alternatives = filter.values.map(
      (value) => sql`${listings.attributes} @> ${JSON.stringify({ [filter.slug]: value })}::jsonb`,
    )
    return alternatives.length === 1 ? alternatives[0] : or(...alternatives)
  }

  // A range is not containment, so this one cannot use the GIN index — it reads the
  // key out and compares it, which at demo scale is instant and at real scale is
  // what an expression index on the hot key is for. The README says so out loud
  // rather than leaving a reviewer to discover it.
  const value =
    filter.type === "number"
      ? // The CASE is not defensive noise: a cast that meets a non-numeric value
        // raises, and Postgres does not promise to evaluate a guarding AND first. A
        // heterogeneous key would otherwise take the whole browse page down with a
        // 500 instead of quietly not matching.
        sql`CASE WHEN jsonb_typeof(${listings.attributes} -> ${filter.slug}) = 'number'
                 THEN (${listings.attributes} ->> ${filter.slug})::numeric END`
      : // ISO dates sort lexicographically, so text comparison is date comparison —
        // and the format is enforced on write by both the Zod schema and the trigger.
        sql`CASE WHEN jsonb_typeof(${listings.attributes} -> ${filter.slug}) = 'string'
                 THEN ${listings.attributes} ->> ${filter.slug} END`

  const cast = filter.type === "number" ? sql`::numeric` : sql`::text`

  return and(
    filter.min !== null ? sql`${value} >= ${filter.min}${cast}` : undefined,
    filter.max !== null ? sql`${value} <= ${filter.max}${cast}` : undefined,
  )
}

/**
 * One listing, with everything the detail page renders. Null when not found.
 *
 * Images come back in the same query as a json aggregate rather than a second round trip.
 * A plain join would multiply the listing row once per image and need de-duplicating; a
 * lateral aggregate keeps it to one row and one trip.
 */
export async function getListingBySlug(slug: string): Promise<ListingDetail | null> {
  const [row] = await db
    .select({
      id: listings.id,
      slug: listings.slug,
      title: listings.title,
      description: listings.description,
      pricePaise: listings.pricePaise,
      currency: listings.currency,
      condition: listings.condition,
      city: listings.city,
      status: listings.status,
      attributes: listings.attributes,
      verifiedAttributes: listings.verifiedAttributes,
      verifiedAt: listings.verifiedAt,
      verifiedByName: verifierName,
      schemaVersion: listings.schemaVersion,
      createdAt: listings.createdAt,
      categoryId: listings.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
      sellerId: listings.sellerId,
      sellerName: users.name,
      images: allImages,
    })
    .from(listings)
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(listings.slug, slug))
    .limit(1)

  if (!row) return null

  const images = row.images ?? []

  return {
    ...row,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
    verifiedAttributes: (row.verifiedAttributes ?? {}) as Record<string, unknown>,
    images,
    primaryImage: images[0] ?? null,
  }
}

/**
 * Who recorded the verification, as a correlated subquery.
 *
 * A second join to `users` would need an alias — the seller is already joined — and
 * this reads more plainly for a column that is null on most rows.
 */
const verifierName = sql<string | null>`(
  SELECT u.name FROM users u WHERE u.id = ${listings.verifiedBy}
)`

/** Every image for the listing, in display order, as one json array. */
const allImages = sql<Array<{ url: string; alt: string | null }> | null>`(
  SELECT jsonb_agg(jsonb_build_object('url', i.url, 'alt', i.alt) ORDER BY i.sort, i.id)
    FROM listing_images i
   WHERE i.listing_id = ${listings.id}
)`

/**
 * The lowest-sorted image for each listing, as a correlated subquery.
 *
 * A `LEFT JOIN` would multiply the listing rows and need de-duplicating; this keeps one
 * row per listing and stays a single query for the whole page.
 */
const primaryImageUrl = sql<string | null>`(
  SELECT i.url FROM listing_images i
   WHERE i.listing_id = ${listings.id}
   ORDER BY i.sort, i.id
   LIMIT 1
)`

const primaryImageAlt = sql<string | null>`(
  SELECT i.alt FROM listing_images i
   WHERE i.listing_id = ${listings.id}
   ORDER BY i.sort, i.id
   LIMIT 1
)`

function toCard(row: {
  slug: string
  title: string
  pricePaise: number
  currency: string
  condition: ListingCondition
  city: string
  createdAt: Date
  categoryName: string
  categorySlug: string
  verifiedAt: Date | null
  imageUrl: string | null
  imageAlt: string | null
}): ListingCard {
  return {
    slug: row.slug,
    title: row.title,
    pricePaise: row.pricePaise,
    currency: row.currency,
    condition: row.condition,
    city: row.city,
    createdAt: row.createdAt,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    verifiedAt: row.verifiedAt,
    primaryImage: row.imageUrl ? { url: row.imageUrl, alt: row.imageAlt } : null,
  }
}

/** Encodes a cursor for a URL. Opaque to the client, so the shape can change freely. */
export function encodeCursor(cursor: ListingCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

export function decodeCursor(raw: string | undefined): ListingCursor | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString()) as ListingCursor
    // A tampered or stale cursor should show page one, not crash the homepage.
    return typeof parsed?.createdAt === "string" && typeof parsed?.slug === "string"
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}
