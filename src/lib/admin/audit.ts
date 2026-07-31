import { desc, eq } from "drizzle-orm"

import { db } from "@/db"
import { auditLog, users, type NewAuditLogEntry } from "@/db/schema"

/**
 * Recording registry changes.
 *
 * The registry is edited at runtime by non-engineers, which makes a configuration change
 * as consequential as a deploy — and a deploy has a commit history. This is that history:
 * who changed what, and what it looked like before.
 *
 * It is also the only way to answer "why did this category start requiring battery
 * health last Tuesday?", which is exactly the question that gets asked when a config
 * change turns out to have cost listings.
 */

export type AuditAction =
  | "category.create"
  | "category.update"
  | "category.reparent"
  | "category.deactivate"
  | "category.activate"
  | "category.reorder"
  | "field.create"
  | "field.update"
  | "field.archive"
  | "field.restore"
  | "option.create"
  | "option.update"
  | "option.archive"
  | "assignment.attach"
  | "assignment.update"
  | "assignment.detach"

export async function recordAudit(entry: {
  actorId: string | null
  action: AuditAction
  entityType: "category" | "field" | "field_option" | "assignment"
  entityId: string | number
  before?: unknown
  after?: unknown
}): Promise<void> {
  const row: NewAuditLogEntry = {
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId),
    before: entry.before ?? null,
    after: entry.after ?? null,
  }

  await db.insert(auditLog).values(row)
}

export type AuditEntry = {
  id: number
  action: string
  entityType: string
  entityId: string
  before: unknown
  after: unknown
  at: Date
  actorName: string | null
}

export async function getAuditLog(limit = 100): Promise<AuditEntry[]> {
  return (
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
        at: auditLog.at,
        actorName: users.name,
      })
      .from(auditLog)
      // A left join, because the seed and any future migration write entries with no actor.
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit)
  )
}
