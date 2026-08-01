import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { getCategoryTree, type CategoryNode } from "@/lib/categories"
import { CreateCategoryForm } from "./create-category-form"
import { CategoryRowActions } from "./category-row-actions"
import { MoveCategoryDialog } from "./move-category-dialog"

export const metadata: Metadata = { title: "Categories" }

/**
 * The category tree.
 *
 * Inactive categories stay listed rather than disappearing — an admin needs them in order
 * to bring one back, and a category that vanished when deactivated would look deleted,
 * which is the one thing this system never does.
 */
export default async function CategoriesPage() {
  const tree = await getCategoryTree({ includeInactive: true })
  const flat = flatten(tree)

  // Derived from the tree already in hand rather than a query per row: a move dialog
  // must never offer a category's own descendant as its parent, since that detaches
  // both from the tree entirely. The server rejects it too — this just means the
  // ordinary path never has to.
  const relations = indexTree(tree)

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start lg:gap-10">
      <section className="grid gap-4">
        <header className="grid gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Categories</h1>
          <p className="text-muted-foreground text-sm">
            Field assignments apply downward. A category collects everything assigned to it and to
            every category above it, so shared fields belong on a parent.
          </p>
        </header>

        <ul className="grid gap-1">
          {flat.map(({ node, depth }) => (
            <li key={node.id}>
              <div
                className="hover:bg-muted/60 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
                style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
              >
                <Link
                  href={`/admin/categories/${node.slug}`}
                  // Not prefetched. Each editor resolves a full form schema and walks the
                  // tree twice, so prefetching every row turned opening this list into a
                  // dozen of the app's most expensive renders at once. An admin clicking
                  // one row can wait for one render; nobody needs all of them speculatively.
                  prefetch={false}
                  className="flex min-w-0 flex-1 items-center gap-2 text-sm"
                >
                  <span className={node.isActive ? "font-medium" : "text-muted-foreground"}>
                    {node.name}
                  </span>
                  <code className="text-muted-foreground/70 text-xs">{node.slug}</code>
                  {!node.isActive ? (
                    <Badge variant="secondary" className="text-xs font-normal">
                      Inactive
                    </Badge>
                  ) : null}
                  {node.isLeaf ? null : (
                    <span className="text-muted-foreground/60 text-xs">
                      · {node.children.length} inside
                    </span>
                  )}
                </Link>

                <span className="text-muted-foreground/60 text-xs tabular-nums">
                  v{node.configVersion}
                </span>

                <MoveCategoryDialog
                  id={node.id}
                  name={node.name}
                  currentParentId={relations.get(node.id)?.parentId ?? null}
                  candidates={candidatesFor(node.id, flat, relations)}
                />

                <CategoryRowActions
                  id={node.id}
                  name={node.name}
                  isActive={node.isActive}
                  hasChildren={!node.isLeaf}
                />

                <ChevronRightIcon className="text-muted-foreground/40 size-4 shrink-0" />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside className="grid gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Add a category</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Put it under a parent to inherit that parent&rsquo;s fields. Nothing is deployed — the
          seller flow picks it up on the next request.
        </p>
        <CreateCategoryForm
          parents={flat.map(({ node, depth }) => ({
            id: node.id,
            label: `${"— ".repeat(depth)}${node.name}`,
          }))}
        />
      </aside>
    </div>
  )
}

function flatten(
  nodes: readonly CategoryNode[],
  depth = 0,
): Array<{ node: CategoryNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)])
}

type Relation = { parentId: number | null; descendants: Set<number> }

/** Each category's parent and the full set beneath it, in one walk. */
function indexTree(
  nodes: readonly CategoryNode[],
  parentId: number | null = null,
  into = new Map<number, Relation>(),
): Map<number, Relation> {
  for (const node of nodes) {
    // Children first, so their own descendant sets are ready to fold in.
    indexTree(node.children, node.id, into)

    const descendants = new Set<number>()
    for (const child of node.children) {
      descendants.add(child.id)
      for (const id of into.get(child.id)?.descendants ?? []) descendants.add(id)
    }

    into.set(node.id, { parentId, descendants })
  }

  return into
}

/** Everywhere this category could legally go: anywhere but itself or its own subtree. */
function candidatesFor(
  id: number,
  flat: Array<{ node: CategoryNode; depth: number }>,
  relations: Map<number, Relation>,
): Array<{ id: number; label: string }> {
  const forbidden = relations.get(id)?.descendants ?? new Set<number>()

  return flat
    .filter(({ node }) => node.id !== id && !forbidden.has(node.id))
    .map(({ node, depth }) => ({ id: node.id, label: `${"— ".repeat(depth)}${node.name}` }))
}
