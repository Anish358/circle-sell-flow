import { sql } from "drizzle-orm"

import { db } from "@/db"
import type { FieldType } from "@/db/schema"
import { formatAttributeValue } from "@/lib/form-schema/format"
import type { FieldConfig, FieldOptionView } from "@/lib/form-schema/types"

/**
 * Resolving a stored listing's attributes for display.
 *
 * This is **not** the form resolver, and the difference matters. The form resolver
 * answers "what should this category ask for now?", so it returns live, assigned fields
 * only. This answers "what does this listing actually hold?", which is a question about
 * the past: the listing may carry values for fields that have since been archived, or
 * detached from its category, or whose chosen option no longer exists.
 *
 * None of those may vanish from the page. A config change must never rewrite history —
 * so the lookup is driven by the slugs present in the row, keyed by slug, and includes
 * archived fields and archived options. Anything no longer part of the category is
 * marked `orphaned` and shown under its own heading rather than silently dropped or
 * silently mixed in.
 */

export type DisplayAttribute = {
  slug: string
  label: string
  type: FieldType
  /** The raw stored value. */
  value: unknown
  /** The value as a person reads it. */
  display: string
  /** Show as a headline spec rather than a table row. */
  prominent: boolean
  /**
   * True when the field is archived, or is no longer assigned to this listing's
   * category. The value stays visible; it just no longer belongs to the current form.
   */
  orphaned: boolean
}

export type DisplayGroup = {
  slug: string | null
  label: string | null
  attributes: DisplayAttribute[]
}

export type ListingDisplay = {
  /** Prominent specs, for chips above the details. */
  highlights: DisplayAttribute[]
  /** Grouped in the order the registry configures. */
  groups: DisplayGroup[]
  /** Values whose field has since been archived or detached from the category. */
  orphaned: DisplayAttribute[]
}

type DisplayRow = {
  slug: string
  label: string
  type: FieldType
  config: FieldConfig | null
  prominent: boolean
  orphaned: boolean
  groupSlug: string | null
  groupLabel: string | null
  options: FieldOptionView[]
}

export async function resolveListingDisplay(
  categoryId: number,
  attributes: Record<string, unknown>,
): Promise<ListingDisplay> {
  const slugs = Object.keys(attributes)
  if (slugs.length === 0) return { highlights: [], groups: [], orphaned: [] }

  const rows = await db.execute<DisplayRow>(sql`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, 0 AS distance FROM categories WHERE id = ${categoryId}
      UNION ALL
      SELECT c.id, c.parent_id, a.distance + 1
        FROM categories c JOIN ancestry a ON c.id = a.parent_id
    ),
    -- The winning assignment per field, for group, order and prominence. Nearest
    -- ancestor wins, exactly as in the form resolver. A field with no row here is no
    -- longer collected by this category.
    resolved AS (
      SELECT DISTINCT ON (cf.field_id)
             cf.field_id, cf.sort, cf.group_id, cf.prominent
        FROM ancestry a
        JOIN category_fields cf ON cf.category_id = a.id
       ORDER BY cf.field_id, a.distance
    )
    SELECT f.slug,
           f.label,
           f.type,
           f.config,
           coalesce(r.prominent, false)                                AS prominent,
           -- Archived, or detached from the category: either way, not part of the
           -- current form, but still part of this listing.
           (f.archived_at IS NOT NULL OR r.field_id IS NULL)           AS orphaned,
           g.slug                                                      AS "groupSlug",
           g.label                                                     AS "groupLabel",
           coalesce(o.options, '[]'::jsonb)                            AS options
      FROM fields f
      LEFT JOIN resolved r ON r.field_id = f.id
      LEFT JOIN field_groups g ON g.id = r.group_id
      -- No archived_at filter on options: a listing that chose an option must keep
      -- showing that option's label after it is retired.
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
                 jsonb_build_object('slug', fo.value_slug, 'label', fo.label)
                 ORDER BY fo.sort, fo.label
               ) AS options
          FROM field_options fo
         WHERE fo.field_id = f.id
      ) o ON true
     WHERE f.slug IN (${sql.join(
       slugs.map((slug) => sql`${slug}`),
       sql`, `,
     )})
     ORDER BY coalesce(g.sort, 2147483647), g.slug, coalesce(r.sort, 0), f.label
  `)

  const known = new Map(rows.map((row) => [row.slug, row]))

  const highlights: DisplayAttribute[] = []
  const groups: DisplayGroup[] = []
  const orphaned: DisplayAttribute[] = []

  for (const row of rows) {
    const attribute = toAttribute(row, attributes[row.slug])
    // A value that formats to nothing is not worth a row on the page.
    if (attribute.display === "") continue

    if (attribute.orphaned) {
      orphaned.push(attribute)
      continue
    }

    if (attribute.prominent) highlights.push(attribute)

    const last = groups.at(-1)
    if (!last || last.slug !== row.groupSlug) {
      groups.push({ slug: row.groupSlug, label: row.groupLabel, attributes: [attribute] })
    } else {
      last.attributes.push(attribute)
    }
  }

  // A key with no `fields` row at all: the definition was hard-deleted, which the
  // schema prevents, or the row predates it. Shown rather than hidden, because a
  // listing's own data should never disappear because of a bookkeeping gap.
  for (const slug of slugs) {
    if (known.has(slug)) continue
    const value = attributes[slug]
    if (value === undefined || value === null || value === "") continue
    orphaned.push({
      slug,
      label: slug,
      type: "text",
      value,
      display: String(value),
      prominent: false,
      orphaned: true,
    })
  }

  return { highlights, groups, orphaned }
}

function toAttribute(row: DisplayRow, value: unknown): DisplayAttribute {
  const field = { type: row.type, options: row.options, config: row.config ?? {} }
  return {
    slug: row.slug,
    label: row.label,
    type: row.type,
    value,
    display: formatAttributeValue(field, value) ?? "",
    prominent: row.prominent,
    orphaned: row.orphaned,
  }
}
