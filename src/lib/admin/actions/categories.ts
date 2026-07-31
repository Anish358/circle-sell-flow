"use server"

import { eq, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { categories } from "@/db/schema"
import { requireAdmin } from "@/lib/auth"
import { recordAudit } from "@/lib/admin/audit"
import { slugify } from "@/lib/slug"
import { type ActionResult, failure, success, withAdmin } from "./result"

/**
 * Category mutations.
 *
 * Every action calls `requireAdmin()` itself. The admin layout checks too, but a layout
 * is not a security boundary: a server action is its own callable endpoint and does not
 * run the layout that rendered its form. Checking only in the layout would leave every
 * mutation here wide open.
 */

const nameSchema = z.string().trim().min(2, "Give the category a name").max(60, "Name is too long")

export async function createCategory(input: {
  name: string
  parentId: number | null
}): Promise<ActionResult<{ slug: string }>> {
  return withAdmin(async (admin) => {
    const name = nameSchema.safeParse(input.name)
    if (!name.success) return failure(name.error.issues[0]?.message ?? "Invalid name")

    // Derived, not typed by hand: a category slug is a URL and the database constrains
    // its shape, so letting an admin invent one is a validation error waiting to happen.
    const slug = slugify(name.data)

    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1)

    if (existing) {
      return failure(`A category with the link "${slug}" already exists.`)
    }

    // Sorts after its siblings, so a new category appears at the end rather than
    // silently jumping to the top of someone's carefully ordered list.
    const [sortRow] = await db.execute<{ nextSort: number }>(sql`
      SELECT coalesce(max(sort), 0) + 10 AS "nextSort"
        FROM categories
       WHERE parent_id IS NOT DISTINCT FROM ${input.parentId}
    `)

    const [created] = await db
      .insert(categories)
      .values({ name: name.data, slug, parentId: input.parentId, sort: sortRow?.nextSort ?? 0 })
      .returning()

    if (!created) return failure("Could not create the category.")

    await recordAudit({
      actorId: admin.id,
      action: "category.create",
      entityType: "category",
      entityId: created.id,
      after: created,
    })

    revalidateAdmin()
    return success({ slug: created.slug })
  })
}

export async function renameCategory(input: {
  id: number
  name: string
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const name = nameSchema.safeParse(input.name)
    if (!name.success) return failure(name.error.issues[0]?.message ?? "Invalid name")

    const before = await findCategory(input.id)
    if (!before) return failure("That category no longer exists.")

    // Only the label changes. The slug is left alone deliberately: it is in every URL
    // and in the form-schema ETag, and renaming is supposed to be free.
    const [after] = await db
      .update(categories)
      .set({ name: name.data })
      .where(eq(categories.id, input.id))
      .returning()

    await recordAudit({
      actorId: admin.id,
      action: "category.update",
      entityType: "category",
      entityId: input.id,
      before,
      after,
    })

    revalidateAdmin()
    return success(null)
  })
}

export async function setCategoryActive(input: {
  id: number
  isActive: boolean
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const before = await findCategory(input.id)
    if (!before) return failure("That category no longer exists.")

    const [after] = await db
      .update(categories)
      .set({ isActive: input.isActive })
      .where(eq(categories.id, input.id))
      .returning()

    await recordAudit({
      actorId: admin.id,
      action: input.isActive ? "category.activate" : "category.deactivate",
      entityType: "category",
      entityId: input.id,
      before,
      after,
    })

    revalidateAdmin()
    return success(null)
  })
}

/**
 * Moving a category to a different parent.
 *
 * Rejected when it would create a cycle. The database only guards against a category
 * being its own parent — a single check constraint cannot see a longer loop — so the
 * walk has to happen here, and it is the reason re-parenting is an explicit action
 * rather than an editable field.
 */
export async function reparentCategory(input: {
  id: number
  parentId: number | null
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const before = await findCategory(input.id)
    if (!before) return failure("That category no longer exists.")

    if (input.parentId === input.id) {
      return failure("A category cannot be its own parent.")
    }

    if (input.parentId !== null && (await isDescendant(input.parentId, input.id))) {
      return failure(
        "That would put the category inside one of its own descendants, which would leave both unreachable.",
      )
    }

    const [after] = await db
      .update(categories)
      .set({ parentId: input.parentId })
      .where(eq(categories.id, input.id))
      .returning()

    await recordAudit({
      actorId: admin.id,
      action: "category.reparent",
      entityType: "category",
      entityId: input.id,
      before,
      after,
    })

    revalidateAdmin()
    return success(null)
  })
}

/**
 * Nudging a category up or down among its siblings.
 *
 * Buttons rather than drag-and-drop: two admins dragging at once is a lost-update race
 * that needs either a transaction rewriting every sibling or fractional ranking, and a
 * pair of buttons is operable by keyboard and screen reader without any of that. The
 * swap runs in one statement so it cannot half-apply.
 */
export async function moveCategory(input: {
  id: number
  direction: "up" | "down"
}): Promise<ActionResult<null>> {
  return withAdmin(async (admin) => {
    const category = await findCategory(input.id)
    if (!category) return failure("That category no longer exists.")

    const comparison = input.direction === "up" ? sql`<` : sql`>`
    const order = input.direction === "up" ? sql`DESC` : sql`ASC`

    const [neighbour] = await db.execute<{ id: number; sort: number }>(sql`
      SELECT id, sort FROM categories
       WHERE parent_id IS NOT DISTINCT FROM ${category.parentId}
         AND (sort, id) ${comparison} (${category.sort}, ${category.id})
       ORDER BY sort ${order}, id ${order}
       LIMIT 1
    `)

    // Already at the end. Not an error — the button simply had nothing to do.
    if (!neighbour) return success(null)

    await db.transaction(async (tx) => {
      await tx
        .update(categories)
        .set({ sort: neighbour.sort })
        .where(eq(categories.id, category.id))
      await tx
        .update(categories)
        .set({ sort: category.sort })
        .where(eq(categories.id, neighbour.id))
    })

    await recordAudit({
      actorId: admin.id,
      action: "category.reorder",
      entityType: "category",
      entityId: category.id,
      before: { sort: category.sort },
      after: { sort: neighbour.sort },
    })

    revalidateAdmin()
    return success(null)
  })
}

/** Candidate parents: everything except the category itself and its own descendants. */
export async function getReparentOptions(
  categoryId: number,
): Promise<Array<{ id: number; name: string }>> {
  await requireAdmin()

  const rows = await db.execute<{ id: number; name: string }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM categories WHERE id = ${categoryId}
      UNION
      SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
    )
    SELECT id, name FROM categories
     WHERE id NOT IN (SELECT id FROM descendants)
     ORDER BY name
  `)

  return [...rows]
}

async function findCategory(id: number) {
  const [row] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
  return row
}

/** Is `candidate` somewhere beneath `ancestor`? */
async function isDescendant(candidate: number, ancestor: number): Promise<boolean> {
  const [row] = await db.execute<{ found: boolean }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM categories WHERE id = ${ancestor}
      UNION
      SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
    )
    SELECT EXISTS (SELECT 1 FROM descendants WHERE id = ${candidate}) AS found
  `)
  return row?.found ?? false
}

/**
 * Registry changes affect the seller flow and every product page, so the caches for both
 * are dropped. The form-schema endpoint has its own ETag driven by `config_version`, so
 * it invalidates itself.
 */
function revalidateAdmin() {
  // One call, from the root. "/" with "layout" already covers every route beneath it, so
  // the separate /admin and /sell calls were repeating the same invalidation twice.
  revalidatePath("/", "layout")
}
