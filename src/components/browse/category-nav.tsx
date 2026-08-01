import Link from "next/link"

import { CATEGORY_PARAM, browseUrl } from "@/lib/listings/facets"
import type { CategoryNode } from "@/lib/categories/tree"
import { cn } from "@/lib/utils"

/**
 * Browse by category — the gate that facets come through.
 *
 * Every tier is selectable, not only the leaves the sell flow offers. Selling needs a
 * leaf because a listing must know exactly what it is; browsing a whole tier is an
 * ordinary thing to want, and the query walks the subtree to serve it.
 *
 * Choosing a category drops the current filters rather than carrying them over. Facets
 * are that category's fields, and a filter on a field the new category never assigns
 * would be a URL asserting something nothing can satisfy — an empty page, with a chip
 * the buyer never chose. The one exception a marketplace would eventually want is a
 * shared field surviving the move, which is exactly what the sell flow's
 * `carryOverValues` already does for answers; it is left out here as scope.
 */
export function CategoryNav({ tree, current }: { tree: CategoryNode[]; current: string | null }) {
  return (
    <nav aria-label="Categories" className="grid gap-2">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Category</p>

      <ul className="grid gap-0.5 text-sm">
        <li>
          <CategoryLink slug={null} name="All listings" current={current} />
        </li>
        {tree.map((node) => (
          <CategoryBranch key={node.slug} node={node} current={current} depth={0} />
        ))}
      </ul>
    </nav>
  )
}

function CategoryBranch({
  node,
  current,
  depth,
}: {
  node: CategoryNode
  current: string | null
  depth: number
}) {
  return (
    <li>
      <CategoryLink slug={node.slug} name={node.name} current={current} depth={depth} />
      {node.children.length > 0 ? (
        <ul className="grid gap-0.5">
          {node.children.map((child) => (
            <CategoryBranch key={child.slug} node={child} current={current} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function CategoryLink({
  slug,
  name,
  current,
  depth = 0,
}: {
  slug: string | null
  name: string
  current: string | null
  depth?: number
}) {
  const selected = slug === current
  // A fresh parameter set, not the current one minus a few keys: see above.
  const params = new URLSearchParams(slug ? { [CATEGORY_PARAM]: slug } : {})

  return (
    <Link
      href={browseUrl(params)}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "hover:bg-muted focus-visible:ring-ring/50 block rounded-md px-2 py-1.5 outline-none focus-visible:ring-3",
        selected ? "bg-muted font-medium" : "text-muted-foreground",
      )}
      // Indent by depth rather than by nesting margins, so a deep tree does not walk
      // off the edge of a narrow sidebar.
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
    >
      {name}
    </Link>
  )
}
