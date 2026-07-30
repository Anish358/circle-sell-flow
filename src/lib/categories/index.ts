import { asc, eq, type SQL } from "drizzle-orm"

import { db } from "@/db"
import { categories } from "@/db/schema"
import { buildTree, type CategoryNode } from "./tree"

/**
 * Server-only category queries.
 *
 * The tree's shape and the pure functions over it live in `./tree.ts`, which client
 * components can import without dragging the Postgres driver into the browser bundle.
 */

export type { CategoryNode, CategoryRow } from "./tree"
export { flattenTree, leafPaths } from "./tree"

export async function getCategoryTree(
  options: { includeInactive?: boolean } = {},
): Promise<CategoryNode[]> {
  // Inactive categories stay visible to admins, who need them in order to
  // reactivate one.
  const visible: SQL | undefined = options.includeInactive
    ? undefined
    : eq(categories.isActive, true)

  const rows = await db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      slug: categories.slug,
      name: categories.name,
      sort: categories.sort,
      isActive: categories.isActive,
      configVersion: categories.configVersion,
    })
    .from(categories)
    .where(visible)
    // Ordered here rather than in the tree builder, so sibling order is one decision
    // made in SQL.
    .orderBy(asc(categories.sort), asc(categories.name))

  return buildTree(rows)
}
