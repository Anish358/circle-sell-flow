import { integer, pgTable, text } from "drizzle-orm/pg-core"

import { slugCheck, timestamps } from "./_shared"

/**
 * Named sections a form is broken into ("Specifications", "Condition").
 *
 * A library like `fields`, so the same section can be reused across categories.
 * Grouping is not decoration: a flat twelve-field form is exactly the seller
 * experience this design exists to prevent.
 */
export const fieldGroups = pgTable(
  "field_groups",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    slug: text().notNull().unique(),
    label: text().notNull(),

    /** Default order. An assignment's own `sort` orders fields within the group. */
    sort: integer().notNull().default(0),

    ...timestamps,
  },
  (t) => [slugCheck("field_groups_slug_format", t.slug)],
)

export type FieldGroup = typeof fieldGroups.$inferSelect
export type NewFieldGroup = typeof fieldGroups.$inferInsert
