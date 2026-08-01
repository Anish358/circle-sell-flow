import type { FieldRenderAs, FieldType } from "@/db/schema"
import type { AuditEntry } from "./audit"

/**
 * Turning an audit row into a sentence an administrator can read.
 *
 * The log is written by code, so it stores what code needs: an action key, an entity
 * type, an id, and the before/after documents. Rendered raw that is
 * `category.create · category 7 · Created.` — accurate, traceable, and useless to the
 * person who actually edits the registry, who is not an engineer and has never heard
 * of a category id.
 *
 * So the storage stays machine-shaped and the *reading* is translated here: names
 * instead of ids, verbs instead of action keys, and — the part that matters most — a
 * plain sentence about the **consequence**, because the whole reason this log exists is
 * that a configuration change is as consequential as a deploy. "Archived the field
 * Battery Health" is a fact; "it disappears from new forms, and listings that already
 * have an answer keep showing it" is the thing an admin was worried about when they
 * clicked.
 *
 * Pure and free of database imports, so the wording is unit-testable and cannot drift
 * from what the actions actually record. Names arrive resolved, from `audit.ts`.
 */

/** Names for the ids an audit document can refer to, resolved in one batch per kind. */
export type ActivityNames = {
  categories: ReadonlyMap<number, string>
  fields: ReadonlyMap<number, string>
  groups: ReadonlyMap<number, string>
  /** Keyed by both id and slug, because the actions record one or the other. */
  listings: ReadonlyMap<string, string>
}

export const noNames: ActivityNames = {
  categories: new Map(),
  fields: new Map(),
  groups: new Map(),
  listings: new Map(),
}

export type ActivityChange = { label: string; from: string; to: string }

export type ActivityItem = {
  id: number
  /** One sentence: what happened, in names rather than ids. */
  headline: string
  /** What it means for sellers and existing listings. Null when nothing needs saying. */
  detail: string | null
  /** Field-level differences, with human labels. Empty for creates and deletes. */
  changes: ActivityChange[]
  /** Groups the entry visually, and lets the list be scanned by kind of change. */
  tone: "added" | "changed" | "moved" | "removed" | "restored" | "checked"
  actorName: string | null
  at: Date
  /** The machine action, kept for traceability — shown only on hover. */
  action: string
}

/** What a field's type is called when an administrator reads it. */
const TYPE_WORDS: Record<FieldType, string> = {
  text: "text",
  textarea: "long text",
  number: "a number",
  boolean: "yes / no",
  date: "a date",
  single_select: "a pick-one list",
  multi_select: "a pick-any list",
}

const RENDER_WORDS: Record<FieldRenderAs, string> = {
  input: "a single-line box",
  textarea: "a multi-line box",
  date: "a date picker",
  switch: "a switch",
  radio: "radio buttons",
  dropdown: "a dropdown",
  chips: "tappable chips",
  checkboxes: "checkboxes",
  multiselect: "a multi-select",
}

/** Keys worth showing when something was edited, in the words the console uses. */
const CHANGE_LABELS: Record<string, string> = {
  name: "Name",
  label: "Name",
  required: "Required",
  filterable: "Filterable",
  prominent: "Headline spec",
  verifiable: "Hub verifies",
  visibleWhen: "Visibility rule",
  defaultValue: "Default answer",
  groupId: "Group",
  helpText: "Help text",
  placeholder: "Placeholder",
  renderAs: "Appearance",
  type: "Type",
  config: "Validation rules",
  isActive: "Available to sellers",
  parentId: "Sits inside",
  sort: "Position",
  archivedAt: "Archived",
}

/** Noise: ids, timestamps, and the version counter the database maintains itself. */
const HIDDEN_KEYS = new Set([
  "id",
  "slug",
  "valueSlug",
  "categoryId",
  "fieldId",
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
  "configVersion",
  "schemaVersion",
  "attributes",
  "verifiedAttributes",
  "categoryName",
])

export function describeAudit(entry: AuditEntry, names: ActivityNames): ActivityItem {
  const base = {
    id: entry.id,
    actorName: entry.actorName,
    at: entry.at,
    action: entry.action,
  }

  const { headline, detail, tone, changes } = sentenceFor(entry, names)

  return { ...base, headline, detail, tone, changes: changes ?? changesIn(entry, names) }
}

type Sentence = {
  headline: string
  detail: string | null
  tone: ActivityItem["tone"]
  /** Set only where the headline already says everything a diff would. */
  changes?: ActivityChange[]
}

function sentenceFor(entry: AuditEntry, names: ActivityNames): Sentence {
  const before = asRecord(entry.before)
  const after = asRecord(entry.after)
  const doc = after ?? before ?? {}

  switch (entry.action) {
    // ── Categories ───────────────────────────────────────────────────────────
    case "category.create": {
      const parent = categoryName(doc.parentId, names)
      return {
        headline: `New category ${quote(text(doc.name))}`,
        detail: parent
          ? `Added inside ${quote(parent)}. Sellers can list in it right away.`
          : "Added as a top-level category. Sellers can list in it right away.",
        tone: "added",
        changes: [],
      }
    }

    case "category.update": {
      const renamed = renameOf(before?.name, after?.name)
      if (renamed) {
        return {
          headline: `Renamed the category ${quote(renamed.from)} to ${quote(renamed.to)}`,
          detail: "Nothing else changes — links and listings follow the category, not its name.",
          tone: "changed",
          changes: [],
        }
      }
      return {
        headline: `Edited the category ${quote(text(doc.name))}`,
        detail: null,
        tone: "changed",
      }
    }

    case "category.reparent": {
      const from = categoryName(before?.parentId, names) ?? "the top level"
      const to = categoryName(after?.parentId, names) ?? "the top level"
      return {
        headline: `Moved the category ${quote(text(doc.name))} from ${quote(from)} to ${quote(to)}`,
        detail:
          "It now inherits a different set of fields, so the form sellers see has changed with it.",
        tone: "moved",
        changes: [],
      }
    }

    case "category.deactivate":
      return {
        headline: `Hid the category ${quote(text(doc.name))} from sellers`,
        detail: "Nobody can list in it now. Listings already in it stay live and keep showing.",
        tone: "removed",
        changes: [],
      }

    case "category.activate":
      return {
        headline: `Made the category ${quote(text(doc.name))} available to sellers again`,
        detail: null,
        tone: "restored",
        changes: [],
      }

    case "category.reorder":
      return {
        headline: `Moved the category ${quote(text(doc.name))} ${direction(before?.sort, after?.sort)} in the list`,
        detail: "Only the order sellers see it in — nothing about what it collects.",
        tone: "moved",
        changes: [],
      }

    // ── Fields ───────────────────────────────────────────────────────────────
    case "field.create":
      return {
        headline: `New field ${quote(text(doc.label))}`,
        detail: `Collected as ${typeWords(doc.type)}, shown as ${renderWords(doc.renderAs)}. It can now be added to any category.`,
        tone: "added",
        changes: [],
      }

    case "field.update": {
      const renamed = renameOf(before?.label, after?.label)
      if (renamed) {
        return {
          headline: `Renamed the field ${quote(renamed.from)} to ${quote(renamed.to)}`,
          detail:
            "Every listing keeps its answers — the name is only a label, and the stored answers do not use it.",
          tone: "changed",
          changes: changesIn(
            { ...entry, before: omit(before, "label"), after: omit(after, "label") },
            names,
          ),
        }
      }
      return {
        headline: `Edited the field ${quote(text(doc.label))}`,
        detail: null,
        tone: "changed",
      }
    }

    case "field.archive":
      return {
        headline: `Archived the field ${quote(text(doc.label))}`,
        detail:
          "It disappears from new listing forms. Listings that already have an answer keep showing it, under “Additional details”. Nothing is deleted.",
        tone: "removed",
        changes: [],
      }

    case "field.restore":
      return {
        headline: `Restored the field ${quote(text(doc.label))}`,
        detail: "Categories that were collecting it are asking for it again.",
        tone: "restored",
        changes: [],
      }

    // ── Options on a field ───────────────────────────────────────────────────
    case "option.create":
      return {
        headline: `New answer ${quote(text(doc.label))} on ${fieldClause(doc.fieldId, names)}`,
        detail: "Sellers can choose it from now on.",
        tone: "added",
        changes: [],
      }

    case "option.update": {
      const renamed = renameOf(before?.label, after?.label)
      const field = fieldClause(doc.fieldId, names)
      return {
        headline: renamed
          ? `Renamed the answer ${quote(renamed.from)} to ${quote(renamed.to)} on ${field}`
          : `Edited an answer on ${field}`,
        detail: renamed
          ? "Listings that chose it now display the new wording; what is stored did not change."
          : null,
        tone: "changed",
        changes: [],
      }
    }

    case "option.archive":
      return {
        headline: `Retired the answer ${quote(text(doc.label))} on ${fieldClause(doc.fieldId, names)}`,
        detail:
          "Nobody new can choose it. Listings that already chose it still show it, so their history stays intact.",
        tone: "removed",
        changes: [],
      }

    case "option.restore":
      return {
        headline: `Brought back the answer ${quote(text(doc.label))} on ${fieldClause(doc.fieldId, names)}`,
        detail: "Sellers can choose it again.",
        tone: "restored",
        changes: [],
      }

    // ── Which fields a category collects ─────────────────────────────────────
    case "assignment.attach": {
      const { category, field, categoryPlain } = assignmentNames(entry, doc, names)
      return {
        headline: `${category} now collects ${field}`,
        detail: `Sellers listing in ${categoryPlain} — and in anything inside it — are asked for it from now on. Listings created earlier are not affected.`,
        tone: "added",
      }
    }

    case "assignment.update": {
      const { category, field } = assignmentNames(entry, doc, names)
      return {
        headline: `Changed how ${category} collects ${field}`,
        detail: null,
        tone: "changed",
      }
    }

    case "assignment.detach": {
      const { category, field } = assignmentNames(entry, doc, names)
      return {
        headline: `${category} no longer collects ${field}`,
        detail:
          "The field stays in the library for other categories, and listings keep the answers they gave — shown under “Additional details”.",
        tone: "removed",
        changes: [],
      }
    }

    // ── Listings ─────────────────────────────────────────────────────────────
    case "listing.verified": {
      const measured = keyCount(after?.verifiedAttributes)
      return {
        headline: `Recorded a hub check on ${listingClause(entry.entityId, names)}`,
        detail: `${measured} ${measured === 1 ? "value" : "values"} measured at the hub. The seller's own answers are kept alongside, so the product page can show both.`,
        tone: "checked",
        changes: [],
      }
    }

    case "listing.verification_cleared":
      return {
        headline: `Cleared the hub check on ${listingClause(entry.entityId, names)}`,
        detail: "The listing shows the seller's answers again, with no verified badge.",
        tone: "removed",
        changes: [],
      }

    case "listing.recategorise": {
      const from = text(before?.categoryName)
      const to = text(after?.categoryName)
      const dropped = droppedAnswers(before, after)
      return {
        headline: `Moved ${listingClause(entry.entityId, names)} from ${quote(from)} to ${quote(to)}`,
        detail:
          dropped === 0
            ? `Every answer it held is also collected by ${to}, so nothing was lost.`
            : `${dropped} ${dropped === 1 ? "answer" : "answers"} ${dropped === 1 ? "is" : "are"} not collected by ${to} and ${dropped === 1 ? "was" : "were"} removed. This entry holds the only remaining copy.`,
        tone: "moved",
        changes: [],
      }
    }

    default:
      // An action added later reads awkwardly rather than crashing, and the machine
      // key stays visible on hover.
      return {
        headline: `Changed a ${entry.entityType.replace(/_/g, " ")}`,
        detail: null,
        tone: "changed",
      }
  }
}

/* ── The field-level diff, in human labels ─────────────────────────────────── */

function changesIn(
  entry: Pick<AuditEntry, "before" | "after">,
  names: ActivityNames,
): ActivityChange[] {
  const before = asRecord(entry.before)
  const after = asRecord(entry.after)
  if (!before || !after) return []

  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !HIDDEN_KEYS.has(key) && key in CHANGE_LABELS)
    .flatMap((key) => {
      const from = renderValue(key, before[key], names)
      const to = renderValue(key, after[key], names)
      return from === to ? [] : [{ label: CHANGE_LABELS[key]!, from, to }]
    })
}

function renderValue(key: string, value: unknown, names: ActivityNames): string {
  if (value === null || value === undefined || value === "") return "nothing"
  if (typeof value === "boolean") return value ? "yes" : "no"

  switch (key) {
    case "parentId":
      return categoryName(value, names) ?? "the top level"
    case "groupId":
      return names.groups.get(Number(value)) ?? "no group"
    case "visibleWhen":
      return "a rule"
    case "config":
      return "set"
    case "type":
      return typeWords(value)
    case "renderAs":
      return renderWords(value)
    case "archivedAt":
      return "yes"
    default:
      return typeof value === "object" ? "set" : String(value)
  }
}

/* ── Small helpers ─────────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Drops one key, so a diff can skip what the headline already said. */
function omit(doc: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!doc) return doc
  return Object.fromEntries(Object.entries(doc).filter(([entryKey]) => entryKey !== key))
}

/** Quotes with typographic marks, so a name with a space still reads as one thing. */
function quote(value: string): string {
  return `“${value}”`
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : "an unnamed item"
}

function renameOf(from: unknown, to: unknown): { from: string; to: string } | null {
  if (typeof from !== "string" || typeof to !== "string" || from === to) return null
  return { from, to }
}

function direction(before: unknown, after: unknown): string {
  const from = Number(before)
  const to = Number(after)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "somewhere else"
  return to < from ? "higher" : "lower"
}

function categoryName(id: unknown, names: ActivityNames): string | null {
  if (id === null || id === undefined) return null
  return names.categories.get(Number(id)) ?? null
}

function fieldName(id: unknown, names: ActivityNames): string | null {
  return names.fields.get(Number(id)) ?? null
}

/**
 * "the field “Storage”", or an admission that the name is not knowable.
 *
 * An entry can outlive the row it points at — a development reset is the usual way, and
 * nothing stops a future migration doing it. The old rendering printed the placeholder
 * where the name belonged, so the page said `on the field “a field”`: a fallback
 * masquerading as data, which is worse than saying nothing. This says nothing, clearly.
 */
function fieldClause(id: unknown, names: ActivityNames): string {
  const name = fieldName(id, names)
  return name ? `the field ${quote(name)}` : "a field that is no longer in the registry"
}

function listingName(entityId: string, names: ActivityNames): string | null {
  return names.listings.get(entityId) ?? null
}

function listingClause(entityId: string, names: ActivityNames): string {
  const name = listingName(entityId, names)
  return name ? `the listing ${quote(name)}` : "a listing that no longer exists"
}

function typeWords(value: unknown): string {
  return TYPE_WORDS[value as FieldType] ?? "a value"
}

function renderWords(value: unknown): string {
  return RENDER_WORDS[value as FieldRenderAs] ?? "an input"
}

/**
 * An assignment's entity id is `categoryId:fieldId`, which is the only place those two
 * ids appear for a detach — the row is gone, so the document cannot be relied on.
 */
function assignmentNames(
  entry: AuditEntry,
  doc: Record<string, unknown>,
  names: ActivityNames,
): { category: string; field: string; categoryPlain: string } {
  const [rawCategory, rawField] = entry.entityId.split(":")

  const categoryLabel = categoryName(rawCategory, names) ?? categoryName(doc.categoryId, names)
  const fieldLabel = fieldName(rawField, names) ?? fieldName(doc.fieldId, names)

  return {
    category: categoryLabel ? quote(categoryLabel) : "a category that is no longer in the registry",
    field: fieldLabel ? quote(fieldLabel) : "a field that is no longer in the registry",
    // The same category name without quotes, for use mid-sentence.
    categoryPlain: categoryLabel ?? "that category",
  }
}

function keyCount(value: unknown): number {
  const record = asRecord(value)
  return record ? Object.keys(record).length : 0
}

/** Answers the listing held that its new category does not collect. */
function droppedAnswers(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): number {
  const kept = new Set(Object.keys(asRecord(after?.attributes) ?? {}))
  return Object.keys(asRecord(before?.attributes) ?? {}).filter((key) => !kept.has(key)).length
}

/* ── Which ids the page has to resolve ─────────────────────────────────────── */

export type ActivityReferences = {
  categoryIds: number[]
  fieldIds: number[]
  groupIds: number[]
  listingRefs: string[]
}

/**
 * Every id the entries refer to, so names can be fetched in one query per kind rather
 * than one per row.
 */
export function collectReferences(entries: readonly AuditEntry[]): ActivityReferences {
  const categoryIds = new Set<number>()
  const fieldIds = new Set<number>()
  const groupIds = new Set<number>()
  const listingRefs = new Set<string>()

  const addNumber = (into: Set<number>, value: unknown) => {
    const id = Number(value)
    if (Number.isInteger(id) && id > 0) into.add(id)
  }

  for (const entry of entries) {
    if (entry.entityType === "category") addNumber(categoryIds, entry.entityId)
    if (entry.entityType === "field") addNumber(fieldIds, entry.entityId)
    if (entry.entityType === "listing") listingRefs.add(entry.entityId)
    if (entry.entityType === "assignment") {
      const [category, field] = entry.entityId.split(":")
      addNumber(categoryIds, category)
      addNumber(fieldIds, field)
    }

    for (const doc of [asRecord(entry.before), asRecord(entry.after)]) {
      if (!doc) continue
      addNumber(categoryIds, doc.parentId)
      addNumber(categoryIds, doc.categoryId)
      addNumber(fieldIds, doc.fieldId)
      addNumber(groupIds, doc.groupId)
    }
  }

  return {
    categoryIds: [...categoryIds],
    fieldIds: [...fieldIds],
    groupIds: [...groupIds],
    listingRefs: [...listingRefs],
  }
}
