import { asc, eq, type SQL } from "drizzle-orm"

import { db } from "@/db"
import { categories } from "@/db/schema"

/**
 * The category tree, as the picker and the admin console consume it.
 *
 * Read flat and assembled in memory rather than with a recursive query: the tree
 * is small, entirely cacheable, and the whole thing is needed at once anyway.
 * The resolver's recursive CTE exists because it walks *upward* from one category;
 * this walks downward from everything.
 */
export type CategoryNode = {
  id: number
  slug: string
  name: string
  sort: number
  isActive: boolean
  configVersion: number
  /** No children — the categories a seller can actually list in. */
  isLeaf: boolean
  children: CategoryNode[]
}

export async function getCategoryTree(
  options: { includeInactive?: boolean } = {},
): Promise<CategoryNode[]> {
  // Inactive categories stay visible to admins, who need them to reactivate one.
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
    .orderBy(asc(categories.sort), asc(categories.name))

  const nodes = new Map<number, CategoryNode>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        sort: row.sort,
        isActive: row.isActive,
        configVersion: row.configVersion,
        isLeaf: true,
        children: [],
      },
    ]),
  )

  const roots: CategoryNode[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)
    if (!node) continue

    // A parent filtered out by `visible` leaves its child orphaned; surfacing it
    // as a root beats dropping it silently.
    const parent = row.parentId === null ? undefined : nodes.get(row.parentId)
    if (parent) {
      parent.isLeaf = false
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

/** Flattens the tree depth-first, which is the order a picker lists it in. */
export function flattenTree(
  nodes: readonly CategoryNode[],
  depth = 0,
): Array<{ node: CategoryNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenTree(node.children, depth + 1)])
}
