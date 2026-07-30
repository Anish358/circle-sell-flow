"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ChevronRightIcon, SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
// From `categories/tree`, not `categories`: this is a client component, and the
// latter imports the database driver.
import { leafPaths, type CategoryNode } from "@/lib/categories/tree"

/**
 * The category gate. A listing's form cannot exist before its category is known, so
 * this is a step rather than a field.
 *
 * A type-ahead over the tree rather than a `<select>`: a marketplace ends up with
 * hundreds of categories, and by then a dropdown is unusable while this stays fine.
 * Matching includes ancestor names, so typing a parent's name finds everything under
 * it, and each result shows its path so two similarly-named leaves are
 * distinguishable.
 *
 * Only leaves are selectable. The tiers above exist to hold shared fields, not to be
 * sold in.
 */
export function CategoryPicker({ tree }: { tree: CategoryNode[] }) {
  const [query, setQuery] = useState("")

  // Flattened once: every leaf with the path that leads to it.
  const leaves = useMemo(() => leafPaths(tree), [tree])

  const search = query.trim().toLowerCase()
  const results = search
    ? // Ancestor names count as matches, so typing a parent's name finds everything
      // beneath it.
      leaves.filter(({ path }) => path.join(" ").toLowerCase().includes(search))
    : leaves

  return (
    <div className="grid gap-4">
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search categories"
          aria-label="Search categories"
          className="pl-9"
        />
      </div>

      {results.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Nothing matches “{query}”. Try a broader word.
        </p>
      ) : (
        <ul className="grid gap-2">
          {results.map(({ node, path }) => (
            <li key={node.slug}>
              <Link
                href={`/sell?category=${node.slug}`}
                // Comfortably past the 44px minimum tap target on a touch screen.
                className="hover:bg-muted flex min-h-14 items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors"
              >
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{node.name}</span>
                  {path.length > 1 ? (
                    <span className="text-muted-foreground text-xs">
                      {path.slice(0, -1).join(" › ")}
                    </span>
                  ) : null}
                </span>
                <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
