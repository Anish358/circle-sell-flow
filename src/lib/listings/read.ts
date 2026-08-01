import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm"

import { db } from "@/db"
import { categories, listings, users, type ListingCondition, type ListingStatus } from "@/db/schema"

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

/** Opaque cursor for keyset pagination. */
export type ListingCursor = { createdAt: string; slug: string }

const DEFAULT_PAGE_SIZE = 24

/**
 * A page of live listings, newest first.
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
  } = {},
): Promise<{ listings: ListingCard[]; nextCursor: ListingCursor | null }> {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, 60)

  const after: SQL | undefined = options.cursor
    ? or(
        lt(listings.createdAt, new Date(options.cursor.createdAt)),
        and(
          eq(listings.createdAt, new Date(options.cursor.createdAt)),
          lt(listings.slug, options.cursor.slug),
        ),
      )
    : undefined

  const rows = await db
    .select({
      slug: listings.slug,
      title: listings.title,
      pricePaise: listings.pricePaise,
      currency: listings.currency,
      condition: listings.condition,
      city: listings.city,
      createdAt: listings.createdAt,
      categoryName: categories.name,
      categorySlug: categories.slug,
      verifiedAt: listings.verifiedAt,
      imageUrl: primaryImageUrl,
      imageAlt: primaryImageAlt,
    })
    .from(listings)
    .innerJoin(categories, eq(categories.id, listings.categoryId))
    // Drafts, sold and removed listings stay off the homepage.
    .where(and(eq(listings.status, "active"), after))
    .orderBy(desc(listings.createdAt), desc(listings.slug))
    // One extra row is the cheapest way to know whether another page exists.
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page.at(-1)

  return {
    listings: page.map(toCard),
    nextCursor:
      rows.length > limit && last
        ? { createdAt: last.createdAt.toISOString(), slug: last.slug }
        : null,
  }
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
