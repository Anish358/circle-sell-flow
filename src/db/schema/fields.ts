import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import { jsonObjectCheck, slugCheck, timestamps } from "./_shared"
import { fieldRenderAs, fieldType } from "./enums"

/**
 * The field library — a reusable catalogue, not a per-category list.
 *
 * A field owns its identity and type and nothing contextual. "Battery Health is
 * a number between 0 and 100" is true everywhere it is used; whether it is
 * required, where it sits in the form and what it defaults to belong to the
 * assignment row (see `category_fields`). That is why one Battery Health field
 * can serve several categories with different rules.
 *
 * Fields are archived, never deleted: listings already hold values under this
 * field's slug and must keep rendering them.
 */
export const fields = pgTable(
  "fields",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    /**
     * Immutable. This string is the key inside `listings.attributes`, so changing
     * it would orphan every stored value. The admin UI disables the input after
     * creation; `label` is what changes when someone wants a different name.
     */
    slug: text().notNull().unique(),
    label: text().notNull(),

    type: fieldType().notNull(),
    renderAs: fieldRenderAs("render_as").notNull(),

    /**
     * Declarative validation rules, shaped by `type`: min/max for numbers,
     * minLength/maxLength for text, and so on. Validation has to be data, not
     * code — otherwise every new field still needs an engineer.
     */
    config: jsonb().notNull().default({}),

    placeholder: text(),
    helpText: text("help_text"),

    /** Set to hide the field from new forms while existing values keep rendering. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    slugCheck("fields_slug_format", t.slug),
    jsonObjectCheck("fields_config_is_object", t.config),

    // Only live fields are offered in the admin's picker, so that lookup is hot.
    index("fields_archived_at_idx").on(t.archivedAt),

    /**
     * The legal type → render_as pairings, enforced by the database so no client
     * can store a nonsensical combination like a date rendered as checkboxes.
     * Kept in step with RENDER_OPTIONS in ./enums.ts, which validates admin input.
     */
    check(
      "fields_render_as_matches_type",
      sql`
        (${t.type} = 'text'          AND ${t.renderAs} = 'input')                                 OR
        (${t.type} = 'textarea'      AND ${t.renderAs} = 'textarea')                              OR
        (${t.type} = 'number'        AND ${t.renderAs} = 'input')                                  OR
        (${t.type} = 'date'          AND ${t.renderAs} = 'date')                                   OR
        (${t.type} = 'boolean'       AND ${t.renderAs} IN ('radio', 'switch'))                     OR
        (${t.type} = 'single_select' AND ${t.renderAs} IN ('radio', 'dropdown', 'chips'))          OR
        (${t.type} = 'multi_select'  AND ${t.renderAs} IN ('checkboxes', 'multiselect', 'chips'))
      `,
    ),
  ],
)

export type Field = typeof fields.$inferSelect
export type NewField = typeof fields.$inferInsert
