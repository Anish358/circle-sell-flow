/**
 * The category tree's shape and the pure functions over it.
 *
 * Deliberately free of any database import. The category picker is a client
 * component, and anything it imports ends up in the browser bundle — pulling in the
 * Postgres driver would fail the build on Node's `tls` module, and would be wrong
 * even if it happened to work. Queries live in `./index.ts`, which is server-only.
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

/** One flat category row, as read from the database. */
export type CategoryRow = {
  id: number
  parentId: number | null
  slug: string
  name: string
  sort: number
  isActive: boolean
  configVersion: number
}

/**
 * Assembles flat rows into a tree.
 *
 * Rows are expected already ordered, so sibling order comes from the query rather
 * than being re-sorted here. Built in memory rather than with a recursive query: the
 * tree is small and the whole of it is wanted at once. The resolver's recursive CTE
 * exists because it walks *upward* from a single category; this walks downward from
 * everything.
 */
export function buildTree(rows: readonly CategoryRow[]): CategoryNode[] {
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

    // A parent filtered out of `rows` — an inactive one, say — leaves its child
    // orphaned. Surfacing it as a root beats dropping it silently.
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

/** Every leaf, paired with the names leading to it — what the picker renders. */
export function leafPaths(
  tree: readonly CategoryNode[],
): Array<{ node: CategoryNode; path: string[] }> {
  const paths = new Map<number, string[]>()

  function walk(nodes: readonly CategoryNode[], trail: string[]) {
    for (const node of nodes) {
      const here = [...trail, node.name]
      paths.set(node.id, here)
      walk(node.children, here)
    }
  }
  walk(tree, [])

  return flattenTree(tree)
    .filter(({ node }) => node.isLeaf)
    .map(({ node }) => ({ node, path: paths.get(node.id) ?? [node.name] }))
}
