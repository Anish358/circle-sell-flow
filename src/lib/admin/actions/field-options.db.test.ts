import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { db } from "@/db"
import { ADMIN_EMAIL } from "@/db/seed/sample-listings"

/**
 * The option lifecycle, against a real database.
 *
 * Options are the part of the registry an admin edits most and the part with the least
 * room for error: an option's slug is what a listing stored, so the rules that matter are
 * about what may *not* change. These tests cover the three that keep old listings
 * readable — a label is free to change, a slug never is, and retiring is not deleting —
 * plus the one an interactive editor makes easy to get wrong, which is handing back a
 * retired slug to a new option.
 *
 * They drive the real server actions rather than the tables, because the guarantees live
 * in the actions and in a trigger, not in the schema alone. Only Next's request-scoped
 * helpers are stubbed.
 *
 * Run with `npm run test:db`.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: ADMIN_EMAIL }) }),
}))

vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

const { addFieldOption, createField, getFieldOptions, setOptionArchived, updateFieldOption } =
  await import("./fields")

/** Named so the cleanup below can find it, and so a stray row is obvious in the UI. */
const FIELD_LABEL = "ZZTest Finish"

let fieldId: number

beforeAll(async () => {
  const created = await createField({
    label: FIELD_LABEL,
    type: "single_select",
    renderAs: "dropdown",
    config: {},
    helpText: "",
    options: [{ label: "Matte" }],
  })
  if (!created.ok) throw new Error(`Needs a seeded database: ${created.error}`)

  const [row] = await db.execute<{ id: number }>(
    sql`SELECT id FROM fields WHERE label = ${FIELD_LABEL}`,
  )
  if (!row) throw new Error("Field was not created")
  fieldId = row.id
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM field_options WHERE field_id = ${fieldId}`)
  await db.execute(sql`DELETE FROM fields WHERE id = ${fieldId}`)
})

async function optionBySlug(slug: string) {
  const options = await getFieldOptions(fieldId)
  return options.find((option) => option.valueSlug === slug)
}

describe("editing the options of an existing field", () => {
  it("derives a permanent slug from the label when adding", async () => {
    const result = await addFieldOption({ fieldId, label: "Brushed Steel" })
    expect(result.ok).toBe(true)

    const added = await optionBySlug("brushed-steel")
    expect(added?.label).toBe("Brushed Steel")
    expect(added?.archivedAt).toBeNull()
  })

  it("relabels without touching the stored value", async () => {
    const before = await optionBySlug("brushed-steel")
    const result = await updateFieldOption({ id: before!.id, label: "Brushed steel" })
    expect(result.ok).toBe(true)

    const after = await optionBySlug("brushed-steel")
    expect(after?.label).toBe("Brushed steel")
    // The point of the whole exercise: listings keyed by this slug are unaffected.
    expect(after?.valueSlug).toBe("brushed-steel")
  })

  it("refuses a second option that would store the same value", async () => {
    const result = await addFieldOption({ fieldId, label: "brushed steel" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("brushed-steel")
  })

  it("archives without deleting, and restores", async () => {
    const option = await optionBySlug("brushed-steel")

    const archived = await setOptionArchived({ id: option!.id, archived: true })
    expect(archived.ok).toBe(true)
    expect((await optionBySlug("brushed-steel"))?.archivedAt).toBeInstanceOf(Date)

    const restored = await setOptionArchived({ id: option!.id, archived: false })
    expect(restored.ok).toBe(true)
    expect((await optionBySlug("brushed-steel"))?.archivedAt).toBeNull()
  })

  it("does not free a slug when its option is archived", async () => {
    const option = await optionBySlug("brushed-steel")
    await setOptionArchived({ id: option!.id, archived: true })

    // A retired slug stays owned. Handing it to a new option would make listings that
    // chose the old one indistinguishable from listings that chose the new one.
    const result = await addFieldOption({ fieldId, label: "Brushed Steel" })
    expect(result.ok).toBe(false)

    await setOptionArchived({ id: option!.id, archived: false })
  })

  it("refuses a slug change from below the application entirely", async () => {
    const option = await optionBySlug("brushed-steel")

    // Not the action — raw SQL, the way a future admin API or a hand-written UPDATE
    // would arrive. The trigger is what has to hold here.
    await expect(
      db.execute(sql`UPDATE field_options SET value_slug = 'steel' WHERE id = ${option!.id}`),
    ).rejects.toThrow()
  })
})
