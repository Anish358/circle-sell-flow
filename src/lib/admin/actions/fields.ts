"use server"

import { asc, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { fieldOptions, fields, fieldRenderAs, fieldType, RENDER_OPTIONS } from "@/db/schema"
import { recordAudit } from "@/lib/admin/audit"
import { validateFieldDefinition } from "@/lib/form-schema/config-validation"
import { slugify } from "@/lib/slug"
import { failure, success, withAdmin, type ActionResult } from "./result"

/**
 * Field library mutations.
 *
 * Two rules the UI must not be able to break, both because listings are keyed by what
 * they establish:
 *
 *   - a field's **slug** is fixed at creation, because it is the key inside
 *     `listings.attributes`;
 *   - a field's **type** is fixed forever, because every stored value was validated
 *     against it and nothing can reinterpret "eight GB" as a number.
 *
 * Neither is merely absent from the edit form. Both are refused by a database trigger, so
 * a mistake in this file — or a future admin API, or a hand-written UPDATE — cannot get
 * past them.
 */

const labelSchema = z.string().trim().min(2, "Give the field a label").max(60, "Label is too long")

const configSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().trim().max(12).optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  maxToday: z.boolean().optional(),
})

const optionInputSchema = z.object({
  label: z.string().trim().min(1, "Options need a label").max(60),
})

export async function createField(input: {
  label: string
  type: string
  renderAs: string
  config?: unknown
  placeholder?: string
  helpText?: string
  options?: Array<{ label: string }>
}): Promise<ActionResult<{ slug: string }>> {
  return withAdmin(async (admin) => {
    const label = labelSchema.safeParse(input.label)
    if (!label.success) return failure(label.error.issues[0]?.message ?? "Invalid label")

    const parsedType = z.literal(fieldType.enumValues).safeParse(input.type)
    if (!parsedType.success) return failure("Choose a field type.")

    const parsedRender = z.literal(fieldRenderAs.enumValues).safeParse(input.renderAs)
    if (!parsedRender.success) return failure("Choose how the field should look.")

    const config = configSchema.safeParse(input.config ?? {})
    if (!config.success) return failure("Those validation rules are not valid.")

    const options = z.array(optionInputSchema).safeParse(input.options ?? [])
    if (!options.success) return failure(options.error.issues[0]?.message ?? "Invalid options")

    const slug = slugify(label.data)

    // Options get slugs derived from their labels, deduplicated within the field —
    // two options storing the same slug would make the stored value ambiguous.
    const seen = new Set<string>()
    const optionRows = options.data.map((option, index) => {
      let optionSlug = slugify(option.label)
      let suffix = 2
      while (seen.has(optionSlug)) optionSlug = `${slugify(option.label)}-${suffix++}`
      seen.add(optionSlug)
      return { valueSlug: optionSlug, label: option.label, sort: (index + 1) * 10 }
    })

    // The same checks the assignment screen runs, so an unsatisfiable field cannot be
    // created in the first place.
    const issues = validateFieldDefinition({
      slug,
      type: parsedType.data,
      renderAs: parsedRender.data,
      config: config.data,
      options: optionRows.map((option) => ({ slug: option.valueSlug })),
    })
    if (issues.length > 0) return failure(issues[0]?.message ?? "That configuration is not valid.")

    const [existing] = await db
      .select({ id: fields.id })
      .from(fields)
      .where(eq(fields.slug, slug))
      .limit(1)
    if (existing) {
      return failure(
        `A field with the key "${slug}" already exists. Reuse it instead — that is the point of a shared library.`,
      )
    }

    const created = await db.transaction(async (tx) => {
      const [field] = await tx
        .insert(fields)
        .values({
          slug,
          label: label.data,
          type: parsedType.data,
          renderAs: parsedRender.data,
          config: config.data,
          placeholder: input.placeholder?.trim() || null,
          helpText: input.helpText?.trim() || null,
        })
        .returning()

      if (!field) throw new Error("insert returned no row")

      if (optionRows.length > 0) {
        await tx
          .insert(fieldOptions)
          .values(optionRows.map((option) => ({ ...option, fieldId: field.id })))
      }

      return field
    })

    await recordAudit({
      actorId: admin.id,
      action: "field.create",
      entityType: "field",
      entityId: created.id,
      after: created,
    })

    revalidateRegistry()
    return success({ slug: created.slug })
  })
}

/** Everything about a field that is safe to change: never its slug, never its type. */
export async function updateField(input: {
  id: number
  label: string
  renderAs: string
  config?: unknown
  placeholder?: string
  helpText?: string
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const before = await findField(input.id)
    if (!before) return failure("That field no longer exists.")

    const label = labelSchema.safeParse(input.label)
    if (!label.success) return failure(label.error.issues[0]?.message ?? "Invalid label")

    const parsedRender = z.literal(fieldRenderAs.enumValues).safeParse(input.renderAs)
    if (!parsedRender.success) return failure("Choose how the field should look.")

    // Presentation can change freely, but only within what the type allows.
    if (!RENDER_OPTIONS[before.type].includes(parsedRender.data)) {
      return failure(
        `A ${before.type} field cannot look like that. Allowed: ${RENDER_OPTIONS[before.type].join(", ")}.`,
      )
    }

    const config = configSchema.safeParse(input.config ?? {})
    if (!config.success) return failure("Those validation rules are not valid.")

    const liveOptions = await db
      .select({ slug: fieldOptions.valueSlug })
      .from(fieldOptions)
      .where(eq(fieldOptions.fieldId, input.id))

    const issues = validateFieldDefinition({
      slug: before.slug,
      type: before.type,
      renderAs: parsedRender.data,
      config: config.data,
      options: liveOptions,
    })
    if (issues.length > 0) return failure(issues[0]?.message ?? "That configuration is not valid.")

    const [after] = await db
      .update(fields)
      .set({
        label: label.data,
        renderAs: parsedRender.data,
        config: config.data,
        placeholder: input.placeholder?.trim() || null,
        helpText: input.helpText?.trim() || null,
      })
      .where(eq(fields.id, input.id))
      .returning()

    await recordAudit({
      actorId: admin.id,
      action: "field.update",
      entityType: "field",
      entityId: input.id,
      before,
      after,
    })

    revalidateRegistry()
    return success(null)
  })
}

/**
 * Archiving, never deleting.
 *
 * An archived field leaves every new form immediately and stays on every existing
 * listing. That asymmetry is the whole point: the configuration describes what to collect
 * *now*, and a listing records what was collected *then*.
 */
export async function setFieldArchived(input: {
  id: number
  archived: boolean
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const before = await findField(input.id)
    if (!before) return failure("That field no longer exists.")

    const [after] = await db
      .update(fields)
      .set({ archivedAt: input.archived ? new Date() : null })
      .where(eq(fields.id, input.id))
      .returning()

    await recordAudit({
      actorId: admin.id,
      action: input.archived ? "field.archive" : "field.restore",
      entityType: "field",
      entityId: input.id,
      before,
      after,
    })

    revalidateRegistry()
    return success(null)
  })
}

export async function addFieldOption(input: {
  fieldId: number
  label: string
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const label = optionInputSchema.safeParse({ label: input.label })
    if (!label.success) return failure(label.error.issues[0]?.message ?? "Invalid option")

    const field = await findField(input.fieldId)
    if (!field) return failure("That field no longer exists.")

    const slug = slugify(label.data.label)

    // Deliberately includes archived options: reusing a retired slug would make old and
    // new listings indistinguishable, which is exactly what immutable slugs prevent.
    const existing = await db
      .select({ id: fieldOptions.id, valueSlug: fieldOptions.valueSlug })
      .from(fieldOptions)
      .where(eq(fieldOptions.fieldId, input.fieldId))

    if (existing.some((option) => option.valueSlug === slug)) {
      return failure(`This field already has an option stored as "${slug}".`)
    }

    const [sortRow] = await db.execute<{ nextSort: number }>(sql`
      SELECT coalesce(max(sort), 0) + 10 AS "nextSort"
        FROM field_options WHERE field_id = ${input.fieldId}
    `)

    const [created] = await db
      .insert(fieldOptions)
      .values({
        fieldId: input.fieldId,
        valueSlug: slug,
        label: label.data.label,
        sort: sortRow?.nextSort ?? 0,
      })
      .returning()

    await recordAudit({
      actorId: admin.id,
      action: "option.create",
      entityType: "field_option",
      entityId: created?.id ?? 0,
      after: created,
    })

    revalidateRegistry()
    return success(null)
  })
}

/** Relabelling is free; the stored slug is immutable and enforced by a trigger. */
export async function updateFieldOption(input: {
  id: number
  label: string
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const label = optionInputSchema.safeParse({ label: input.label })
    if (!label.success) return failure(label.error.issues[0]?.message ?? "Invalid option")

    const [before] = await db
      .select()
      .from(fieldOptions)
      .where(eq(fieldOptions.id, input.id))
      .limit(1)
    if (!before) return failure("That option no longer exists.")

    const [after] = await db
      .update(fieldOptions)
      .set({ label: label.data.label })
      .where(eq(fieldOptions.id, input.id))
      .returning()

    await recordAudit({
      actorId: admin.id,
      action: "option.update",
      entityType: "field_option",
      entityId: input.id,
      before,
      after,
    })

    revalidateRegistry()
    return success(null)
  })
}

export async function setOptionArchived(input: {
  id: number
  archived: boolean
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const [before] = await db
      .select()
      .from(fieldOptions)
      .where(eq(fieldOptions.id, input.id))
      .limit(1)
    if (!before) return failure("That option no longer exists.")

    const [after] = await db
      .update(fieldOptions)
      .set({ archivedAt: input.archived ? new Date() : null })
      .where(eq(fieldOptions.id, input.id))
      .returning()

    await recordAudit({
      actorId: admin.id,
      action: "option.archive",
      entityType: "field_option",
      entityId: input.id,
      before,
      after,
    })

    revalidateRegistry()
    return success(null)
  })
}

async function findField(id: number) {
  const [row] = await db.select().from(fields).where(eq(fields.id, id)).limit(1)
  return row
}

/** Field definitions reach every category, so the whole app's caches drop. */
function revalidateRegistry() {
  revalidatePath("/admin", "layout")
  revalidatePath("/sell", "layout")
  revalidatePath("/", "layout")
}

// Kept for the field list page, which needs live options in display order.
export async function getFieldOptions(fieldId: number) {
  return db
    .select()
    .from(fieldOptions)
    .where(eq(fieldOptions.fieldId, fieldId))
    .orderBy(asc(fieldOptions.sort), asc(fieldOptions.label))
}
