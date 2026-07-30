import { boolean, index, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core"

import { jsonObjectCheck, timestamps } from "./_shared"
import { categories } from "./categories"
import { fieldGroups } from "./field-groups"
import { fields } from "./fields"

/**
 * Which fields a category collects, and on what terms — the join that makes the
 * field library reusable.
 *
 * Everything here is *contextual*: the same field can be required in one
 * category and optional in another, sit in different groups, or default
 * differently. What it can never do is change type — that belongs to the field,
 * and this row cannot override it.
 *
 * Assignments also apply downward: a category inherits every assignment made to
 * its ancestors, with the nearest ancestor winning on conflict. So a child can
 * override an inherited rule by assigning the same field itself.
 */
export const categoryFields = pgTable(
  "category_fields",
  {
    categoryId: integer("category_id")
      .notNull()
      // Assignments belong to the category. Deleting a category that has
      // listings is blocked separately — nothing here can orphan a listing.
      .references(() => categories.id, { onDelete: "cascade" }),

    fieldId: integer("field_id")
      .notNull()
      // `restrict` makes invariant "never hard-delete a field" physical: a field
      // in use by any category cannot be deleted, only archived.
      .references(() => fields.id, { onDelete: "restrict" }),

    /** Not required when hidden by `visibleWhen` — a hidden field is never required. */
    required: boolean().notNull().default(false),

    /** Order within the group. */
    sort: integer().notNull().default(0),

    groupId: integer("group_id").references(() => fieldGroups.id, { onDelete: "set null" }),

    /**
     * Pre-filled value, shaped to the field's type. Never persisted for a field
     * that is hidden at submit time.
     */
    defaultValue: jsonb("default_value"),

    /**
     * Declarative visibility rule, for example:
     *   { "all": [{ "field": "under_warranty", "op": "eq", "value": true }] }
     *
     * One rule, evaluated by one shared evaluator: the client uses it to show and
     * hide, the server uses it to decide required-ness and to strip values of
     * fields that ended up hidden.
     */
    visibleWhen: jsonb("visible_when"),

    /** Overrides the field's own help text when this category needs different guidance. */
    helpText: text("help_text"),

    /** Offer this field as a buyer-facing filter for this category. */
    filterable: boolean().notNull().default(false),

    /** Show as a headline spec on the product page rather than in the details table. */
    prominent: boolean().notNull().default(false),

    ...timestamps,
  },
  (t) => [
    // A field is assigned to a category at most once.
    primaryKey({ columns: [t.categoryId, t.fieldId] }),

    // Rendering a form reads one category's assignments in display order.
    index("category_fields_category_id_sort_idx").on(t.categoryId, t.sort),

    // "Which categories use this field?" — the blast radius shown before archiving.
    index("category_fields_field_id_idx").on(t.fieldId),

    jsonObjectCheck("category_fields_visible_when_is_object", t.visibleWhen),
  ],
)

export type CategoryField = typeof categoryFields.$inferSelect
export type NewCategoryField = typeof categoryFields.$inferInsert
