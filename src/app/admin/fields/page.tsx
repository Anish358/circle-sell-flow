import type { Metadata } from "next"
import { sql } from "drizzle-orm"

import { db } from "@/db"
import { Badge } from "@/components/ui/badge"
import { CreateFieldForm } from "./create-field-form"
import { FieldRowActions } from "./field-row-actions"
import { FieldOptionsEditor, type EditableOption } from "./field-options-editor"

export const metadata: Metadata = { title: "Field library" }

/**
 * The field library.
 *
 * A library, not a per-category list — that distinction is the design. One Battery Health
 * field serves every category that wants it, which is why each row shows how many
 * categories use it and how many listings hold a value: those numbers are the blast radius
 * of any change, and they are the reason archiving asks before it acts.
 */
export default async function FieldsPage() {
  const rows = await db.execute<{
    id: number
    slug: string
    label: string
    type: string
    renderAs: string
    archived: boolean
    optionCount: number
    liveOptionCount: number
    categoryCount: number
    listingCount: number
  }>(sql`
    SELECT f.id,
           f.slug,
           f.label,
           f.type,
           f.render_as                                        AS "renderAs",
           (f.archived_at IS NOT NULL)                         AS archived,
           (SELECT count(*)::int FROM field_options o
             WHERE o.field_id = f.id)                          AS "optionCount",
           (SELECT count(*)::int FROM field_options o
             WHERE o.field_id = f.id AND o.archived_at IS NULL) AS "liveOptionCount",
           (SELECT count(*)::int FROM category_fields cf
             WHERE cf.field_id = f.id)                         AS "categoryCount",
           -- Key existence, which is what the jsonb_ops GIN index exists to serve.
           (SELECT count(*)::int FROM listings l
             WHERE l.attributes ? f.slug)                      AS "listingCount"
      FROM fields f
     ORDER BY (f.archived_at IS NOT NULL), f.label
  `)

  // Every option in one query rather than one query per select field, then grouped in
  // memory. The per-option listing count is what lets archiving state its blast radius,
  // and how a value is stored depends on the field's type: a single-select writes the
  // slug as a string, a multi-select writes it into an array.
  const optionRows = await db.execute<EditableOption & { fieldId: number }>(sql`
    SELECT o.id,
           o.field_id                    AS "fieldId",
           o.value_slug                  AS "valueSlug",
           o.label,
           (o.archived_at IS NOT NULL)   AS archived,
           (SELECT count(*)::int FROM listings l
             WHERE CASE WHEN f.type = 'multi_select'
                        THEN l.attributes -> f.slug ? o.value_slug
                        ELSE l.attributes ->> f.slug = o.value_slug
                   END)                  AS "listingCount"
      FROM field_options o
      JOIN fields f ON f.id = o.field_id
     ORDER BY (o.archived_at IS NOT NULL), o.sort, o.label
  `)

  const optionsByField = new Map<number, EditableOption[]>()
  for (const { fieldId, ...option } of optionRows) {
    const list = optionsByField.get(fieldId)
    if (list) list.push(option)
    else optionsByField.set(fieldId, [option])
  }

  const shared = rows.filter((row) => row.categoryCount > 1).length

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-10">
      <section className="grid gap-4">
        <header className="grid gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Field library</h1>
          <p className="text-muted-foreground text-sm">
            Fields are shared. {shared} of {rows.length} are used by more than one category — the
            same row, not a copy, which is why renaming one is free everywhere.
          </p>
        </header>

        <ul className="grid gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`grid gap-2 rounded-lg border px-3 py-3 ${row.archived ? "bg-muted/30 border-dashed" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className={`text-sm ${row.archived ? "text-muted-foreground" : "font-medium"}`}
                >
                  {row.label}
                </span>
                <code className="text-muted-foreground/70 text-xs">{row.slug}</code>
                <Badge variant="secondary" className="text-xs font-normal">
                  {row.type} · {row.renderAs}
                </Badge>
                {row.archived ? (
                  <Badge variant="secondary" className="text-xs font-normal">
                    Archived
                  </Badge>
                ) : null}

                <FieldRowActions
                  id={row.id}
                  label={row.label}
                  archived={row.archived}
                  categoryCount={row.categoryCount}
                  listingCount={row.listingCount}
                />
              </div>

              <p className="text-muted-foreground text-xs">
                {row.categoryCount === 0
                  ? "Not collected anywhere yet"
                  : `${row.categoryCount} categor${row.categoryCount === 1 ? "y" : "ies"}`}
                {" · "}
                {row.listingCount} listing{row.listingCount === 1 ? "" : "s"} hold a value
              </p>

              {/* Only select types have options; for everything else the control would be
                  an empty disclosure. Archived fields are read-only here — restore first,
                  so there is one place a field comes back rather than two. */}
              {row.optionCount > 0 && !row.archived ? (
                <FieldOptionsEditor
                  fieldId={row.id}
                  fieldLabel={row.label}
                  options={optionsByField.get(row.id) ?? []}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <aside className="grid gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Add a field</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Check the list first — reusing a field is what makes an answer comparable across
          categories. Its type and stored key are fixed once created.
        </p>
        <CreateFieldForm />
      </aside>
    </div>
  )
}
