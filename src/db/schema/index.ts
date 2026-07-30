/**
 * Barrel for the whole schema. Drizzle Kit reads this file to generate
 * migrations, and the db client passes it to `drizzle()` for typed queries.
 *
 * Two groups of tables, and the distinction is the design:
 *
 *   the registry — categories, field_groups, fields, field_options,
 *   category_fields — describes what a listing in a given category looks like;
 *
 *   the data — users, listings, listing_images — is the listings themselves.
 *
 * Adding a category or a field means inserting registry rows. It never means a
 * migration, because nothing about a category's shape is expressed in DDL.
 */
export * from "./enums"

export * from "./categories"
export * from "./field-groups"
export * from "./fields"
export * from "./field-options"
export * from "./category-fields"

export * from "./users"
export * from "./listings"
export * from "./listing-images"

export * from "./audit-log"
