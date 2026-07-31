import { sql } from "drizzle-orm"

import { db } from "@/db"

/**
 * What a configuration change will affect, before it is made.
 *
 * The whole difficulty of this design is that non-engineers can change a live schema
 * while data already exists against it. An admin console that answers "are you sure?"
 * without saying what is at stake is asking a question nobody can answer. So every
 * destructive action states its blast radius first: how many listings hold this value,
 * which categories collect this field, what happens to each.
 *
 * The listing counts run on `attributes ? 'slug'`, which is a key-existence test — and
 * the reason the GIN index uses `jsonb_ops` rather than the smaller `jsonb_path_ops`,
 * which does not support that operator at all.
 */

export type FieldUsage = {
  /** Categories with their own assignment of this field. */
  assignedTo: Array<{ slug: string; name: string }>
  /** Categories that receive it by inheritance, without assigning it themselves. */
  inheritedBy: Array<{ slug: string; name: string }>
  /** Listings holding a value under this field's slug. */
  listingCount: number
}

export async function getFieldUsage(fieldSlug: string): Promise<FieldUsage> {
  const [assigned, inherited, counted] = await Promise.all([
    db.execute<{ slug: string; name: string }>(sql`
      SELECT c.slug, c.name
        FROM category_fields cf
        JOIN fields f ON f.id = cf.field_id
        JOIN categories c ON c.id = cf.category_id
       WHERE f.slug = ${fieldSlug}
       ORDER BY c.name
    `),

    // Everything below a category that assigns it, minus the assigners themselves.
    db.execute<{ slug: string; name: string }>(sql`
      WITH RECURSIVE assigners AS (
        SELECT cf.category_id AS id
          FROM category_fields cf
          JOIN fields f ON f.id = cf.field_id
         WHERE f.slug = ${fieldSlug}
      ),
      descendants AS (
        SELECT c.id, c.slug, c.name FROM categories c JOIN assigners a ON c.parent_id = a.id
        UNION
        SELECT c.id, c.slug, c.name FROM categories c JOIN descendants d ON c.parent_id = d.id
      )
      SELECT d.slug, d.name
        FROM descendants d
       WHERE d.id NOT IN (SELECT id FROM assigners)
       ORDER BY d.name
    `),

    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM listings WHERE attributes ? ${fieldSlug}
    `),
  ])

  return {
    assignedTo: [...assigned],
    inheritedBy: [...inherited],
    listingCount: counted[0]?.count ?? 0,
  }
}

export type OptionUsage = { listingCount: number }

/** How many listings hold this option, whether as a single value or inside an array. */
export async function getOptionUsage(fieldSlug: string, valueSlug: string): Promise<OptionUsage> {
  const [row] = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
      FROM listings
     WHERE attributes -> ${fieldSlug} = to_jsonb(${valueSlug}::text)
        OR attributes -> ${fieldSlug} @> to_jsonb(${valueSlug}::text)
  `)
  return { listingCount: row?.count ?? 0 }
}

export type CategoryUsage = {
  /** Listings directly in this category. */
  listingCount: number
  /** Listings in this category or anything beneath it. */
  subtreeListingCount: number
  childCount: number
  /** Fields this category assigns itself. */
  ownAssignmentCount: number
  /** Fields it receives from ancestors. */
  inheritedFieldCount: number
}

export async function getCategoryUsage(categoryId: number): Promise<CategoryUsage> {
  const [row] = await db.execute<CategoryUsage>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM categories WHERE id = ${categoryId}
      UNION
      SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
    ),
    ancestry AS (
      SELECT id, parent_id, 0 AS distance FROM categories WHERE id = ${categoryId}
      UNION ALL
      SELECT c.id, c.parent_id, a.distance + 1
        FROM categories c JOIN ancestry a ON c.id = a.parent_id
    )
    SELECT
      (SELECT count(*)::int FROM listings WHERE category_id = ${categoryId})
        AS "listingCount",
      (SELECT count(*)::int FROM listings WHERE category_id IN (SELECT id FROM subtree))
        AS "subtreeListingCount",
      (SELECT count(*)::int FROM categories WHERE parent_id = ${categoryId})
        AS "childCount",
      (SELECT count(*)::int FROM category_fields WHERE category_id = ${categoryId})
        AS "ownAssignmentCount",
      (SELECT count(DISTINCT cf.field_id)::int
         FROM ancestry a
         JOIN category_fields cf ON cf.category_id = a.id
        WHERE a.distance > 0)
        AS "inheritedFieldCount"
  `)

  return (
    row ?? {
      listingCount: 0,
      subtreeListingCount: 0,
      childCount: 0,
      ownAssignmentCount: 0,
      inheritedFieldCount: 0,
    }
  )
}

/**
 * What re-parenting would change.
 *
 * The most consequential single edit in the console: a category's inherited field set is
 * swapped wholesale, which can leave live listings holding values the category no longer
 * collects. Comparing the two resolved sets is the only honest way to preview it.
 */
export type ReparentImpact = {
  gained: Array<{ slug: string; label: string }>
  lost: Array<{ slug: string; label: string }>
  /** Listings in the subtree that hold a value for one of the lost fields. */
  affectedListingCount: number
}

export async function getReparentImpact(
  categoryId: number,
  newParentId: number | null,
): Promise<ReparentImpact> {
  const [current, proposed] = await Promise.all([
    inheritedFields(categoryId, "current"),
    newParentId === null ? Promise.resolve([]) : inheritedFields(newParentId, "self"),
  ])

  const currentSlugs = new Set(current.map((field) => field.slug))
  const proposedSlugs = new Set(proposed.map((field) => field.slug))

  const gained = proposed.filter((field) => !currentSlugs.has(field.slug))
  const lost = current.filter((field) => !proposedSlugs.has(field.slug))

  if (lost.length === 0) return { gained, lost, affectedListingCount: 0 }

  const [row] = await db.execute<{ count: number }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM categories WHERE id = ${categoryId}
      UNION
      SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
    )
    SELECT count(*)::int AS count
      FROM listings l
     WHERE l.category_id IN (SELECT id FROM subtree)
       -- One parameterised key-existence test per lost field. The any-key operator
       -- would be tidier but needs a text[] bind, and building that array by string
       -- interpolation is a habit worth not having even where slugs are constrained.
       AND (${sql.join(
         lost.map((field) => sql`l.attributes ? ${field.slug}`),
         sql` OR `,
       )})
  `)

  return { gained, lost, affectedListingCount: row?.count ?? 0 }
}

/**
 * Fields a category inherits.
 *
 * `mode: "current"` excludes the category's own assignments — those are unaffected by a
 * move. `mode: "self"` includes them, because the prospective parent's own fields are
 * exactly what a child would start inheriting.
 */
async function inheritedFields(
  categoryId: number,
  mode: "current" | "self",
): Promise<Array<{ slug: string; label: string }>> {
  const rows = await db.execute<{ slug: string; label: string }>(sql`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, 0 AS distance FROM categories WHERE id = ${categoryId}
      UNION ALL
      SELECT c.id, c.parent_id, a.distance + 1
        FROM categories c JOIN ancestry a ON c.id = a.parent_id
    )
    SELECT DISTINCT f.slug, f.label
      FROM ancestry a
      JOIN category_fields cf ON cf.category_id = a.id
      JOIN fields f ON f.id = cf.field_id
     WHERE f.archived_at IS NULL
       AND a.distance >= ${mode === "current" ? 1 : 0}
     ORDER BY f.label
  `)
  return [...rows]
}
