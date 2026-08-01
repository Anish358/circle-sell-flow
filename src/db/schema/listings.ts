import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

import { jsonObjectCheck, slugCheck, timestamps } from "./_shared"
import { categories } from "./categories"
import { listingCondition, listingStatus } from "./enums"
import { users } from "./users"

/**
 * A listing: typed columns for what the platform itself reasons about, and one
 * `attributes` object for everything the category happens to collect.
 *
 * The dividing line: if the platform's own code needs to sort, filter or price on
 * it, it is a column; if only humans read it, it is data. Title and price drive
 * cards, ordering and money, so they are columns. Battery health is read by a
 * person, so it is data.
 */
export const listings = pgTable(
  "listings",
  {
    // Public identifier, so not sequential — a serial id would leak how many
    // listings the marketplace has.
    id: uuid().primaryKey().defaultRandom(),

    /** SEO-bearing and stable: kept when the title changes, so links never rot. */
    slug: text().notNull().unique(),

    categoryId: integer("category_id")
      .notNull()
      // `restrict` so a category with listings cannot be deleted out from under
      // them. Re-categorising is an explicit admin action.
      .references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),

    /** Set from the session, never from a request body. */
    sellerId: uuid("seller_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "restrict" }),

    title: text().notNull(),
    description: text(),

    /**
     * Integer minor units — paise, not rupees, and never a float. Money in
     * floating point is a rounding bug waiting for a large enough order.
     */
    pricePaise: bigint("price_paise", { mode: "number" }).notNull(),
    currency: text().notNull().default("INR"),

    condition: listingCondition().notNull(),
    city: text().notNull(),

    /** Not settable from a request body — transitions go through the API. */
    status: listingStatus().notNull().default("draft"),

    /**
     * Category-specific values, keyed by immutable field slug:
     *   { "storage_gb": 128, "battery_health": 92, "accessories": ["charger"] }
     *
     * Validated on write against the category's resolved schema — in the API and
     * again by a database trigger, so malformed attributes are rejected even if a
     * writer bypasses the application.
     */
    attributes: jsonb().notNull().default({}),

    /**
     * What the hub measured, keyed by the same field slugs.
     *
     * A second document rather than an overwrite, because the seller's claim and the
     * platform's measurement are different facts and a buyer wants both: "89%,
     * verified" beats "89%", and "89% verified, seller said 92%" beats either. Only
     * fields whose assignment is marked `verifiable` may appear here.
     */
    verifiedAttributes: jsonb("verified_attributes").notNull().default({}),

    /** When the hub recorded the values above. Null while unverified. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    /**
     * Who recorded them. `restrict` on purpose: deleting the account must not turn an
     * attributed measurement into an anonymous one.
     */
    verifiedBy: uuid("verified_by").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),

    /**
     * The category's `config_version` at the moment this was submitted. Records
     * which shape of the schema the seller actually answered, which is what makes
     * "the config changed after this was listed" a describable situation rather
     * than a mystery.
     */
    schemaVersion: integer("schema_version").notNull(),

    /**
     * Supplied by the client on create. A double-tapped submit on a flaky mobile
     * connection sends the same request twice; the unique constraint turns the
     * second one into a lookup instead of a second listing.
     */
    idempotencyKey: text("idempotency_key").unique(),

    ...timestamps,
  },
  (t) => [
    slugCheck("listings_slug_format", t.slug),
    jsonObjectCheck("listings_attributes_is_object", t.attributes),
    jsonObjectCheck("listings_verified_attributes_is_object", t.verifiedAttributes),

    // Either wholly unverified, or verified with both a time and an actor. A verified
    // value that cannot say who stood behind it is the unfalsifiable claim this whole
    // feature exists to replace, so the database refuses to hold one.
    check(
      "listings_verified_provenance",
      sql`(${t.verifiedAt} IS NULL AND ${t.verifiedBy} IS NULL AND ${t.verifiedAttributes} = '{}'::jsonb)
          OR (${t.verifiedAt} IS NOT NULL AND ${t.verifiedBy} IS NOT NULL)`,
    ),

    // Positive, and bounded well below anything a real marketplace would take.
    check("listings_price_positive", sql`${t.pricePaise} > 0 AND ${t.pricePaise} <= 100000000000`),

    // Rejects whitespace-only titles, which pass a naive NOT NULL check.
    check("listings_title_length", sql`char_length(btrim(${t.title})) BETWEEN 3 AND 140`),

    check("listings_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),

    // The homepage: newest active listings first.
    index("listings_status_created_at_idx").on(t.status, t.createdAt.desc()),

    // Browsing within a category.
    index("listings_category_id_created_at_idx").on(t.categoryId, t.createdAt.desc()),

    index("listings_seller_id_idx").on(t.sellerId),

    // The verification queue reads only the unverified ones, newest first.
    index("listings_unverified_idx")
      .on(t.createdAt.desc())
      .where(sql`${t.verifiedAt} IS NULL`),

    /**
     * `jsonb_ops`, deliberately, not the smaller and faster `jsonb_path_ops`.
     * `jsonb_path_ops` does not support the key-existence operators (`?`, `?|`,
     * `?&`), and "is this field still in use by any listing?" is
     * `attributes ? 'slug'` — with the other index that check would silently
     * become a sequential scan.
     */
    index("listings_attributes_gin_idx").using("gin", t.attributes.op("jsonb_ops")),
  ],
)

export type Listing = typeof listings.$inferSelect
export type NewListing = typeof listings.$inferInsert
