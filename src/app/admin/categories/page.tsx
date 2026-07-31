import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { getCategoryTree, type CategoryNode } from "@/lib/categories"
import { CreateCategoryForm } from "./create-category-form"
import { CategoryRowActions } from "./category-row-actions"

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
