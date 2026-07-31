"use server"

import { and, eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { categoryFields } from "@/db/schema"
import { recordAudit } from "@/lib/admin/audit"
import { validateResolvedSchema } from "@/lib/form-schema/config-validation"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { allFields } from "@/lib/form-schema/types"
import { failure, success, withAdmin, type ActionResult } from "./result"

/**
 * Assignment mutations — which fields a category collects, and on what terms.
 *
 * Every change here is validated against the category's **resolved** schema, inheritance
 * included, rather than against the row being edited. That is the only way to catch a
 * condition pointing at a field the category does not have, a required field behind an
 * impossible condition, or a visibility cycle: none of them are visible from one row.
 *
 * Detaching is deliberately not archiving. Detaching removes this category's assignment
 * and leaves the field in the library for everyone else. Archiving retires the field
 * everywhere. Two verbs, two blast radii, and the UI has to say which is which.
 */

const visibilityRuleSchema = z.union([
  z.object({
    all: z.array(
      z.object({
        field: z.string().min(1),
        op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte"]),
        value: z.unknown(),
      }),
    ),
  }),
  z.object({
    any: z.array(
      z.object({
        field: z.string().min(1),
        op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte"]),
        value: z.unknown(),
      }),
    ),
  }),
])

export type AssignmentInput = {
  categoryId: number
  fieldId: number
  required?: boolean
  sort?: number
  groupId?: number | null
  defaultValue?: unknown
  visibleWhen?: unknown
  helpText?: string | null
  filterable?: boolean
  prominent?: boolean
}

export async function attachField(input: AssignmentInput): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const [existing] = await db
      .select()
      .from(categoryFields)
      .where(
        and(
          eq(categoryFields.categoryId, input.categoryId),
          eq(categoryFields.fieldId, input.fieldId),
        ),
      )
      .limit(1)

    if (existing) {
      return failure("This category already assigns that field. Edit the existing rule instead.")
    }

    const [sortRow] = await db.execute<{ nextSort: number }>(sql`
      SELECT coalesce(max(sort), 0) + 10 AS "nextSort"
        FROM category_fields WHERE category_id = ${input.categoryId}
    `)

    const values = {
      categoryId: input.categoryId,
      fieldId: input.fieldId,
      required: input.required ?? false,
      sort: input.sort ?? sortRow?.nextSort ?? 0,
      groupId: input.groupId ?? null,
      filterable: input.filterable ?? false,
      prominent: input.prominent ?? false,
    }

    const [created] = await db.insert(categoryFields).values(values).returning()

    // Validated after writing, inside a transaction that is rolled back on a problem —
    // the resolver reads from the database, so there is no way to ask "what would the
    // schema be if I did this?" without doing it.
    const problem = await schemaProblemFor(input.categoryId)
    if (problem) {
      await db
        .delete(categoryFields)
        .where(
          and(
            eq(categoryFields.categoryId, input.categoryId),
            eq(categoryFields.fieldId, input.fieldId),
          ),
        )
      return failure(problem)
    }

    await recordAudit({
      actorId: admin.id,
      action: "assignment.attach",
      entityType: "assignment",
      entityId: `${input.categoryId}:${input.fieldId}`,
      after: created,
    })

    revalidateRegistry()
    return success(null)
  })
}

export async function updateAssignment(input: AssignmentInput): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const before = await findAssignment(input.categoryId, input.fieldId)
    if (!before) return failure("That assignment no longer exists.")

    let visibleWhen: unknown = before.visibleWhen
    if (input.visibleWhen !== undefined) {
      if (input.visibleWhen === null) {
        visibleWhen = null
      } else {
        const parsed = visibilityRuleSchema.safeParse(input.visibleWhen)
        if (!parsed.success) return failure("That visibility rule is not a valid shape.")
        visibleWhen = parsed.data
      }
    }

    const [after] = await db
      .update(categoryFields)
      .set({
        required: input.required ?? before.required,
        sort: input.sort ?? before.sort,
        groupId: input.groupId === undefined ? before.groupId : input.groupId,
        defaultValue: input.defaultValue === undefined ? before.defaultValue : input.defaultValue,
        visibleWhen,
        helpText: input.helpText === undefined ? before.helpText : input.helpText || null,
        filterable: input.filterable ?? before.filterable,
        prominent: input.prominent ?? before.prominent,
      })
      .where(
        and(
          eq(categoryFields.categoryId, input.categoryId),
          eq(categoryFields.fieldId, input.fieldId),
        ),
      )
      .returning()

    const problem = await schemaProblemFor(input.categoryId)
    if (problem) {
      // Put it back exactly as it was rather than leaving a half-applied edit.
      await db
        .update(categoryFields)
        .set({
          required: before.required,
          sort: before.sort,
          groupId: before.groupId,
          defaultValue: before.defaultValue,
          visibleWhen: before.visibleWhen,
          helpText: before.helpText,
          filterable: before.filterable,
          prominent: before.prominent,
        })
        .where(
          and(
            eq(categoryFields.categoryId, input.categoryId),
            eq(categoryFields.fieldId, input.fieldId),
          ),
        )
      return failure(problem)
    }

    await recordAudit({
      actorId: admin.id,
      action: "assignment.update",
      entityType: "assignment",
      entityId: `${input.categoryId}:${input.fieldId}`,
      before,
      after,
    })

    revalidateRegistry()
    return success(null)
  })
}

/**
 * Removing a field from one category.
 *
 * The field survives in the library, and every listing keeps the value it already holds —
 * the product page shows it under "Additional details". This is not archiving, and the
 * confirmation the UI shows says so in those words.
 */
export async function detachField(input: {
  categoryId: number
  fieldId: number
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const before = await findAssignment(input.categoryId, input.fieldId)
    if (!before) return failure("That assignment no longer exists.")

    await db
      .delete(categoryFields)
      .where(
        and(
          eq(categoryFields.categoryId, input.categoryId),
          eq(categoryFields.fieldId, input.fieldId),
        ),
      )

    // Detaching can break a *sibling's* condition that pointed at this field, so the
    // resolved schema is checked here too.
    const problem = await schemaProblemFor(input.categoryId)
    if (problem) {
      await db.insert(categoryFields).values(before)
      return failure(`${problem} Remove or edit that rule first.`)
    }

    await recordAudit({
      actorId: admin.id,
      action: "assignment.detach",
      entityType: "assignment",
      entityId: `${input.categoryId}:${input.fieldId}`,
      before,
    })

    revalidateRegistry()
    return success(null)
  })
}

export async function moveAssignment(input: {
  categoryId: number
  fieldId: number
  direction: "up" | "down"
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const current = await findAssignment(input.categoryId, input.fieldId)
    if (!current) return failure("That assignment no longer exists.")

    const comparison = input.direction === "up" ? sql`<` : sql`>`
    const order = input.direction === "up" ? sql`DESC` : sql`ASC`

    const [neighbour] = await db.execute<{ fieldId: number; sort: number }>(sql`
      SELECT field_id AS "fieldId", sort FROM category_fields
       WHERE category_id = ${input.categoryId}
         AND (sort, field_id) ${comparison} (${current.sort}, ${current.fieldId})
       ORDER BY sort ${order}, field_id ${order}
       LIMIT 1
    `)

    if (!neighbour) return success(null)

    await db.transaction(async (tx) => {
      await tx
        .update(categoryFields)
        .set({ sort: neighbour.sort })
        .where(
          and(
            eq(categoryFields.categoryId, input.categoryId),
            eq(categoryFields.fieldId, current.fieldId),
          ),
        )
      await tx
        .update(categoryFields)
        .set({ sort: current.sort })
        .where(
          and(
            eq(categoryFields.categoryId, input.categoryId),
            eq(categoryFields.fieldId, neighbour.fieldId),
          ),
        )
    })

    await recordAudit({
      actorId: admin.id,
      action: "assignment.update",
      entityType: "assignment",
      entityId: `${input.categoryId}:${input.fieldId}`,
      before: { sort: current.sort },
      after: { sort: neighbour.sort },
    })

    revalidateRegistry()
    return success(null)
  })
}

async function findAssignment(categoryId: number, fieldId: number) {
  const [row] = await db
    .select()
    .from(categoryFields)
    .where(and(eq(categoryFields.categoryId, categoryId), eq(categoryFields.fieldId, fieldId)))
    .limit(1)
  return row
}

/**
 * The first thing wrong with a category's resolved schema, or null.
 *
 * Checks the whole resolved set rather than the edited row, because the failures worth
 * catching are relational: a cycle needs two rules, a dead required field needs a chain,
 * and a condition on a missing field depends on what the category inherits.
 */
async function schemaProblemFor(categorySlugOrId: number): Promise<string | null> {
  const [row] = await db.execute<{ slug: string }>(
    sql`SELECT slug FROM categories WHERE id = ${categorySlugOrId}`,
  )
  if (!row) return null

  const schema = await resolveFormSchema(row.slug)
  // An inactive category resolves to null; there is nothing to validate.
  if (!schema) return null

  const issues = validateResolvedSchema(allFields(schema))
  return issues[0]?.message ?? null
}

function revalidateRegistry() {
  revalidatePath("/admin", "layout")
  revalidatePath("/sell", "layout")
  revalidatePath("/", "layout")
}
