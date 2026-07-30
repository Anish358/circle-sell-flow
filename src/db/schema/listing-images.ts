import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core"

import { timestamps } from "./_shared"
import { listings } from "./listings"

/**
 * Listing photos, ordered. A table rather than a JSON array because order and
 * "which one is primary" are things we query and reorder, and because a foreign
 * key gets us cascade-on-delete for free.
 *
 * The image at `sort = 0` is the primary one — one ordering rule instead of an
 * `is_primary` flag that can contradict it by being set on two rows.
 */
export const listingImages = pgTable(
  "listing_images",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),

    url: text().notNull(),

    /** Alt text, for screen readers and for when the image fails to load. */
    alt: text(),

    sort: integer().notNull().default(0),

    ...timestamps,
  },
  (t) => [index("listing_images_listing_id_sort_idx").on(t.listingId, t.sort)],
)

export type ListingImage = typeof listingImages.$inferSelect
export type NewListingImage = typeof listingImages.$inferInsert
