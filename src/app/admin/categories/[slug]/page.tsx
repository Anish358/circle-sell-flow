import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { asc, eq, isNull } from "drizzle-orm"

import { db } from "@/db"
import { categories, fieldGroups, categoryFields, fields } from "@/db/schema"
import { Badge } from "@/components/ui/badge"
import { getCategoryUsage } from "@/lib/admin/blast-radius"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { allFields } from "@/lib/form-schema/types"
import { AssignmentList, type AssignmentRow } from "./assignment-list"
import { FormPreview } from "./form-preview"

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await props.params
  return { title: slug }
}

/**
 * The category editor: assignments on the left, the seller's form on the right.
 *
 * The preview is the point of the layout. Every other way of checking a configuration —
 * reading the rows, reasoning about inheritance, guessing what a conditional will do —
 * is slower and less reliable than looking at the form the seller will actually meet.
 */
export default async function CategoryEditorPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params

  const [category] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1)
  if (!category) notFound()

  // The editor has to work on a deactivated category — otherwise it could never be fixed
  // and reactivated — so the resolver is bypassed when it declines to resolve one.
  const schema = await resolveFormSchema(slug)

  const [usage, groups, ownAssignments, library, parent] = await Promise.all([
    getCategoryUsage(category.id),
    db.select().from(fieldGroups).orderBy(asc(fieldGroups.sort), asc(fieldGroups.label)),
    db
      .select({ fieldId: categoryFields.fieldId, groupId: categoryFields.groupId })
      .from(categoryFields)
      .where(eq(categoryFields.categoryId, category.id)),
    db
      .select({ id: fields.id, label: fields.label, slug: fields.slug, type: fields.type })
      .from(fields)
      .where(isNull(fields.archivedAt))
      .orderBy(asc(fields.label)),
    category.parentId === null
      ? Promise.resolve([])
      : db
          .select({ name: categories.name, slug: categories.slug })
          .from(categories)
          .where(eq(categories.id, category.parentId))
          .limit(1),
  ])

  const resolved = schema ? allFields(schema) : []
  const idBySlug = new Map(library.map((field) => [field.slug, field.id]))
  const groupByFieldId = new Map(ownAssignments.map((row) => [row.fieldId, row.groupId]))

  // The resolved contract carries no field ids — it is a public shape keyed by slug — so
  // they are matched back here for the actions, which key on ids.
  const rows: AssignmentRow[] = resolved.flatMap((field) => {
    const fieldId = idBySlug.get(field.slug)
    if (fieldId === undefined) return []
    return [{ field, fieldId, groupId: groupByFieldId.get(fieldId) ?? null }]
  })

  const assignedIds = new Set(rows.map((row) => row.fieldId))

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <nav className="text-muted-foreground text-xs">
          <Link
            href="/admin/categories"
            className="hover:text-foreground underline-offset-2 hover:underline"
          >
            Categories
          </Link>
          <span aria-hidden="true"> › </span>
          {parent[0] ? (
            <>
              <Link
                href={`/admin/categories/${parent[0].slug}`}
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                {parent[0].name}
              </Link>
              <span aria-hidden="true"> › </span>
            </>
          ) : null}
          <span>{category.name}</span>
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{category.name}</h1>
          <code className="text-muted-foreground text-xs">{category.slug}</code>
          {!category.isActive ? (
            <Badge variant="secondary" className="text-xs font-normal">
              Inactive
            </Badge>
          ) : null}
        </div>

        {/* Everything an admin needs before changing anything: how much is riding on it. */}
        <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <Stat label="Fields collected" value={String(resolved.length)} />
          <Stat label="Of those, inherited" value={String(usage.inheritedFieldCount)} />
          <Stat label="Listings here" value={String(usage.listingCount)} />
          <Stat label="Including sub-categories" value={String(usage.subtreeListingCount)} />
          <Stat label="Config version" value={String(category.configVersion)} />
        </dl>
      </header>

      {!schema ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-sm">
          This category is deactivated, so it resolves to no form. Reactivate it from the categories
          list to edit its fields.
        </p>
      ) : (
        <div className="grid gap-10 xl:grid-cols-[1fr_26rem] xl:items-start">
          <AssignmentList
            categoryId={category.id}
            rows={rows}
            groups={groups.map((group) => ({ id: group.id, label: group.label }))}
            library={library.filter((field) => !assignedIds.has(field.id))}
          />

          <div className="xl:sticky xl:top-20">
            <FormPreview schema={schema} />
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}</dt>
      <dd className="text-foreground font-medium tabular-nums">{value}</dd>
    </div>
  )
}
