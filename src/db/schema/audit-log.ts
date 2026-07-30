import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { users } from "./users"

/**
 * Who changed which piece of configuration, and what it looked like before.
 *
 * The registry is edited at runtime by non-engineers, which makes config changes
 * as consequential as deploys — and a deploy has a commit history. This is that
 * history. It is also the only way to answer "why did this category start
 * requiring battery health last Tuesday?".
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),

    /** Null only for changes made by a migration or the seed. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),

    /** For example "field.archive", "category.reparent", "assignment.detach". */
    action: text().notNull(),

    entityType: text("entity_type").notNull(),

    /** Text because entities are keyed by either an integer or a uuid. */
    entityId: text("entity_id").notNull(),

    /** Null on create; null on delete for `after`. */
    before: jsonb(),
    after: jsonb(),

    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "Show me this field's history."
    index("audit_log_entity_idx").on(t.entityType, t.entityId, t.at.desc()),

    // The audit log screen: most recent first.
    index("audit_log_at_idx").on(t.at.desc()),
  ],
)

export type AuditLogEntry = typeof auditLog.$inferSelect
export type NewAuditLogEntry = typeof auditLog.$inferInsert
