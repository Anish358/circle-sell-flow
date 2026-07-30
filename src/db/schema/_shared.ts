import { sql } from "drizzle-orm"
import { check, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core"

/**
 * Every table that a human edits carries these. `updated_at` is maintained by a
 * database trigger (see the `updated_at` migration), not by application code, so
 * it stays honest regardless of which client wrote the row.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}

/**
 * Slugs are the system's immutable identities: they appear in URLs and, for
 * fields, as the keys inside `listings.attributes`. Enforcing the shape in the
 * database means no client can introduce one that needs escaping later.
 */
export function slugCheck(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
}

/** Guards a jsonb column that must hold an object, never an array or a scalar. */
export function jsonObjectCheck(name: string, column: AnyPgColumn) {
  return check(name, sql`jsonb_typeof(${column}) = 'object'`)
}
