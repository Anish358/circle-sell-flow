import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { getCategoryTree, type CategoryNode } from "@/lib/categories"

/**
 * The category gate. A listing's form cannot exist before its category is known,
 * so this is a step rather than a field.
 *
 * Only leaves are selectable: the tiers above exist to hold shared fields, not to
 * be sold in. A searchable type-ahead replaces this list in the seller-flow step.
 */
export async function CategoryPicker() {
  const tree = await getCategoryTree()

  return (
    <div className="grid gap-8">
      {tree.map((root) => (
        <section key={root.slug} className="grid gap-3">
          <h2 className="text-sm font-semibold">{root.name}</h2>
          <ul className="grid gap-2">
            <Branch nodes={root.children.length > 0 ? root.children : [root]} />
          </ul>
        </section>
      ))}
    </div>
  )
}

function Branch({ nodes }: { nodes: readonly CategoryNode[] }) {
  return nodes.map((node) =>
    node.isLeaf ? (
      <li key={node.slug}>
        <Link
          href={`/sell?category=${node.slug}`}
          className="hover:bg-muted flex items-center justify-between rounded-lg border px-4 py-3 text-sm transition-colors"
        >
          {node.name}
          <ChevronRightIcon className="text-muted-foreground size-4" />
        </Link>
      </li>
    ) : (
      // An intermediate tier: shown for orientation, not selectable.
      <li key={node.slug} className="grid gap-2">
        <span className="text-muted-foreground text-xs">{node.name}</span>
        <ul className="grid gap-2 pl-4">
          <Branch nodes={node.children} />
        </ul>
      </li>
    ),
  )
}
