import { desc, eq, inArray, or, sql } from "drizzle-orm"

import { db } from "@/db"
import { auditLog, categories, fieldGroups, fields, listings, users } from "@/db/schema"
import type { NewAuditLogEntry } from "@/db/schema"
import { collectReferences, describeAudit, type ActivityItem, type ActivityNames } from "./activity"

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
  | "option.restore"
  | "assignment.attach"
  | "assignment.update"
  | "assignment.detach"
  // Not a registry change, but the same argument applies with more force: a verified
  // value is the platform vouching for something, and it has to be traceable to whoever
  // vouched.
  | "listing.verified"
  | "listing.verification_cleared"
  // The only action that removes stored answers, which makes the `before` document here
  // the sole surviving copy of them.
  | "listing.recategorise"

export async function recordAudit(entry: {
  actorId: string | null
  action: AuditAction
  entityType: "category" | "field" | "field_option" | "assignment" | "listing"
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

/**
 * The activity feed: the same rows, described in plain language.
 *
 * The log stores ids because that is what is stable — a name can change, and an audit
 * entry that recorded only names would quietly rewrite its own history when someone
 * renamed a category. So ids are stored and names are resolved at read time, in one
 * query per kind rather than one per row.
 *
 * That does mean the feed shows a category's *current* name rather than the name it had
 * at the time. For a rename the entry itself carries both, so the one case where the
 * distinction matters reads correctly anyway.
 */
export async function getActivityLog(limit = 100): Promise<ActivityItem[]> {
  const entries = await getAuditLog(limit)
  if (entries.length === 0) return []

  const names = await resolveNames(collectReferences(entries))
  return entries.map((entry) => describeAudit(entry, names))
}

async function resolveNames(refs: ReturnType<typeof collectReferences>): Promise<ActivityNames> {
  // Four independent lookups, issued together. Each is skipped entirely when nothing
  // refers to that kind, which is the common case for a feed of category edits.
  const [categoryRows, fieldRows, groupRows, listingRows] = await Promise.all([
    refs.categoryIds.length > 0
      ? db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(inArray(categories.id, refs.categoryIds))
      : [],
    refs.fieldIds.length > 0
      ? db
          .select({ id: fields.id, label: fields.label })
          .from(fields)
          .where(inArray(fields.id, refs.fieldIds))
      : [],
    refs.groupIds.length > 0
      ? db
          .select({ id: fieldGroups.id, label: fieldGroups.label })
          .from(fieldGroups)
          .where(inArray(fieldGroups.id, refs.groupIds))
      : [],
    // Listings are recorded by id in one action and by slug in another, so both are
    // matched and both are indexed — the describer looks up whichever it was handed.
    refs.listingRefs.length > 0
      ? db
          .select({ id: listings.id, slug: listings.slug, title: listings.title })
          .from(listings)
          .where(
            or(
              inArray(sql`${listings.id}::text`, refs.listingRefs),
              inArray(listings.slug, refs.listingRefs),
            ),
          )
      : [],
  ])

  return {
    categories: new Map(categoryRows.map((row) => [row.id, row.name])),
    fields: new Map(fieldRows.map((row) => [row.id, row.label])),
    groups: new Map(groupRows.map((row) => [row.id, row.label])),
    listings: new Map(
      listingRows.flatMap((row) => [[row.id, row.title] as const, [row.slug, row.title] as const]),
    ),
  }
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
