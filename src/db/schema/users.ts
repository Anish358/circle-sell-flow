import { pgTable, text, uuid } from "drizzle-orm/pg-core"

import { timestamps } from "./_shared"
import { userRole } from "./enums"

/**
 * Deliberately minimal: enough to own a listing and to gate the admin console
 * behind a real role check, and no more. Authentication itself is out of scope
 * for this assignment.
 *
 * It exists this early because `listings.seller_id` and every authorization
 * check depend on it — retrofitting a non-null owner column onto existing rows
 * is far more painful than having the table from the start.
 */
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),

  /** Never settable from a request body — assigned server-side only. */
  role: userRole().notNull().default("seller"),

  ...timestamps,
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
