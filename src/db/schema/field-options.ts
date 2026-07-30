import { index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core"

import { slugCheck, timestamps } from "./_shared"
import { fields } from "./fields"

/**
 * The allowed choices for a select field.
 *
 * Listings store `value_slug`, never `label`, so renaming "8 GB" to "8GB" is a
 * display change that touches no listing row. Options are archived rather than
 * deleted for the same reason a field is: a listing that chose an option must
 * keep showing it even once nobody new can pick it.
 */
export const fieldOptions = pgTable(
  "field_options",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    fieldId: integer("field_id")
      .notNull()
      // Options are wholly owned by their field — there is no meaning to an
      // orphaned option, so they go with it.
      .references(() => fields.id, { onDelete: "cascade" }),

    /** Immutable; this is what lands in `listings.attributes`. */
    valueSlug: text("value_slug").notNull(),
    label: text().notNull(),

    sort: integer().notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    // One meaning per slug per field. Two options both storing "8gb" would make
    // the stored value ambiguous.
    unique("field_options_field_id_value_slug_key").on(t.fieldId, t.valueSlug),

    // Every form render loads a field's options in order.
    index("field_options_field_id_sort_idx").on(t.fieldId, t.sort),

    slugCheck("field_options_value_slug_format", t.valueSlug),
  ],
)

export type FieldOption = typeof fieldOptions.$inferSelect
export type NewFieldOption = typeof fieldOptions.$inferInsert
