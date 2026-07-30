import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

/**
 * The category tree. Categories nest, and field assignments apply downward: a
 * child category inherits every field assigned to its ancestors.
 *
 * `slug` is the public, immutable identity used in URLs and by the seed; `name` is
 * display-only and free to change. Categories are deactivated, never deleted —
 * deleting one would orphan its listings.
 */
export const categories = pgTable(
  "categories",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    // Self-reference: null means a root category. `restrict` so a parent with
    // children cannot vanish; re-parenting is an explicit admin action.
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),

    slug: text().notNull(),
    name: text().notNull(),

    // Display order among siblings.
    sort: integer().notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),

    /**
     * Bumped whenever anything that changes this category's resolved form schema
     * changes. Drives ETag caching of the form-schema endpoint and lets a draft
     * detect that the schema moved while the seller was typing.
     */
    configVersion: integer("config_version").notNull().default(1),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("categories_slug_key").on(t.slug),
    index("categories_parent_id_idx").on(t.parentId),

    // Slugs are URL-safe and lowercase by construction, not by convention.
    check("categories_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),

    // Cheapest possible cycle guard. Longer cycles are rejected by the
    // application when re-parenting, which needs to walk the tree anyway.
    check("categories_no_self_parent", sql`${t.parentId} IS DISTINCT FROM ${t.id}`),
  ],
)

export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert
