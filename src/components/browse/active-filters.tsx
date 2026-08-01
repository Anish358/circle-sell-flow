import Link from "next/link"
import { XIcon } from "lucide-react"

import {
  browseUrl,
  facetChips,
  withoutFacets,
  withoutValue,
  type FacetSelection,
  type SearchParams,
} from "@/lib/listings/facets"

/**
 * What is currently filtered, and one click to undo any of it.
 *
 * Plain links, server-rendered: each is the current URL minus one value, so removing a
 * filter costs no JavaScript, works from a shared link, and is crawlable. The panel and
 * these chips write the same URLs because both build them with the same helpers.
 */
export function ActiveFilters({
  selections,
  params,
}: {
  selections: FacetSelection[]
  params: SearchParams
}) {
  const chips = facetChips(selections)
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="sr-only">Active filters</h2>

      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={browseUrl(withoutValue(params, chip.param, chip.value))}
          className="bg-secondary text-secondary-foreground hover:bg-secondary/70 focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium outline-none focus-visible:ring-3"
        >
          {chip.label}
          {/* The label already says what this removes, so the icon is decorative and
              the accessible name spells the action out. */}
          <span className="sr-only">— remove filter</span>
          <XIcon className="size-3" aria-hidden="true" />
        </Link>
      ))}

      {chips.length > 1 ? (
        <Link
          href={browseUrl(withoutFacets(params))}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-full px-2 py-1 text-xs underline underline-offset-4 outline-none focus-visible:ring-3"
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  )
}
