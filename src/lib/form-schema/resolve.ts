import { sql } from "drizzle-orm"

import { db } from "@/db"
import type { FieldRenderAs, FieldType } from "@/db/schema"
import type {
  FieldConfig,
  FieldOptionView,
  FormField,
  FormGroup,
  FormSchema,
  VisibilityRule,
} from "./types"

/**
 * Resolves one category's complete form schema, inheritance included.
 *
 * Two queries, no N+1: one walks the ancestry, one collects the effective field
 * set with each field's live options aggregated in a lateral join.
 *
 * The rule for conflicts is **nearest ancestor wins**. If a category and its
 * grandparent both assign Purchase Date, the category's own row is the one that
 * counts — which is what makes "required here, optional everywhere else" an
 * override rather than a contradiction. In SQL that is `DISTINCT ON (field_id)
 * ORDER BY field_id, distance`.
 *
 * Returns null when the category does not exist or is deactivated.
 */
export async function resolveFormSchema(categorySlug: string): Promise<FormSchema | null> {
  const ancestry = await db.execute<AncestryRow>(sql`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, slug, name, config_version, is_active, 0 AS distance
        FROM categories
       WHERE slug = ${categorySlug}
      UNION ALL
      SELECT c.id, c.parent_id, c.slug, c.name, c.config_version, c.is_active, a.distance + 1
        FROM categories c
        JOIN ancestry a ON c.id = a.parent_id
    )
    SELECT id, slug, name, config_version AS "configVersion", is_active AS "isActive", distance
      FROM ancestry
     ORDER BY distance DESC
  `)

  // Root first, requested category last — already breadcrumb order.
  const category = ancestry.at(-1)
  if (!category) return null

  // An ancestor being deactivated does not strip its descendants' fields; it only
  // removes the ancestor itself from the picker. Only the requested category's own
  // status decides whether it can be sold in.
  if (!category.isActive) return null

  const rows = await db.execute<ResolvedFieldRow>(sql`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, slug, name, 0 AS distance
        FROM categories
       WHERE slug = ${categorySlug}
      UNION ALL
      SELECT c.id, c.parent_id, c.slug, c.name, a.distance + 1
        FROM categories c
        JOIN ancestry a ON c.id = a.parent_id
    ),
    -- The effective assignment for each field: the one from the nearest category.
    resolved AS (
      SELECT DISTINCT ON (cf.field_id)
             cf.field_id,
             cf.required,
             cf.sort,
             cf.group_id,
             cf.default_value,
             cf.visible_when,
             cf.help_text AS assignment_help_text,
             cf.filterable,
             cf.prominent,
             a.distance,
             a.slug AS origin_slug,
             a.name AS origin_name
        FROM ancestry a
        JOIN category_fields cf ON cf.category_id = a.id
       ORDER BY cf.field_id, a.distance
    )
    SELECT f.slug,
           f.label,
           f.type,
           f.render_as                                    AS "renderAs",
           f.config,
           f.placeholder,
           -- An assignment may override the field's own guidance for one category.
           coalesce(r.assignment_help_text, f.help_text)  AS "helpText",
           r.required,
           r.default_value                                AS "defaultValue",
           r.visible_when                                 AS "visibleWhen",
           r.filterable,
           r.prominent,
           r.distance,
           r.origin_slug                                  AS "originSlug",
           r.origin_name                                  AS "originName",
           g.slug                                         AS "groupSlug",
           g.label                                        AS "groupLabel",
           coalesce(o.options, '[]'::jsonb)               AS options
      FROM resolved r
      JOIN fields f ON f.id = r.field_id
      LEFT JOIN field_groups g ON g.id = r.group_id
      -- Options aggregated per field, so this stays two queries however many
      -- fields the category resolves.
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
                 jsonb_build_object('slug', fo.value_slug, 'label', fo.label)
                 ORDER BY fo.sort, fo.label
               ) AS options
          FROM field_options fo
         WHERE fo.field_id = f.id
           AND fo.archived_at IS NULL
      ) o ON true
     -- Archived fields leave new forms. Listings that already hold their values
     -- keep rendering them; that read path looks fields up by slug instead.
     WHERE f.archived_at IS NULL
     ORDER BY coalesce(g.sort, 2147483647), g.slug, r.sort, f.label
  `)

  return {
    category: {
      id: category.id,
      slug: category.slug,
      name: category.name,
      path: ancestry.map((row) => ({ slug: row.slug, name: row.name })),
    },
    configVersion: category.configVersion,
    groups: intoGroups(rows),
  }
}

/**
 * Collapses the flat, already-ordered rows into groups.
 *
 * Fields from different ancestors sharing a group merge into one section — so a
 * "Condition & History" heading can hold a field inherited from the root
 * alongside one the category declares itself.
 */
function intoGroups(rows: ResolvedFieldRow[]): FormGroup[] {
  const groups: FormGroup[] = []

  for (const row of rows) {
    const last = groups.at(-1)
    // Rows arrive grouped because the query orders by group first.
    if (!last || last.slug !== row.groupSlug) {
      groups.push({ slug: row.groupSlug, label: row.groupLabel, fields: [toFormField(row)] })
    } else {
      last.fields.push(toFormField(row))
    }
  }

  return groups
}

function toFormField(row: ResolvedFieldRow): FormField {
  return {
    slug: row.slug,
    label: row.label,
    type: row.type,
    renderAs: row.renderAs,
    required: row.required,
    config: row.config ?? {},
    placeholder: row.placeholder,
    helpText: row.helpText,
    defaultValue: row.defaultValue ?? null,
    visibleWhen: row.visibleWhen,
    options: row.options,
    filterable: row.filterable,
    prominent: row.prominent,
    origin: {
      categorySlug: row.originSlug,
      categoryName: row.originName,
      inherited: row.distance > 0,
    },
  }
}

type AncestryRow = {
  id: number
  slug: string
  name: string
  configVersion: number
  isActive: boolean
  distance: number
}

type ResolvedFieldRow = {
  slug: string
  label: string
  type: FieldType
  renderAs: FieldRenderAs
  config: FieldConfig | null
  placeholder: string | null
  helpText: string | null
  required: boolean
  defaultValue: unknown
  visibleWhen: VisibilityRule | null
  filterable: boolean
  prominent: boolean
  distance: number
  originSlug: string
  originName: string
  groupSlug: string | null
  groupLabel: string | null
  options: FieldOptionView[]
}
