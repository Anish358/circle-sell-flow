import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Previous / next, with a note on where you are.
 *
 * Plain links, server-rendered, so paging costs no JavaScript, survives a shared URL and
 * is crawlable — the same reason the facet chips are links. A disabled end is rendered as
 * a `<span>` rather than a dead anchor, because an anchor without an `href` is not
 * focusable and an anchor that goes nowhere is worse.
 *
 * Deliberately not a numbered strip. Browse pages by keyset cursor and has no page
 * numbers to offer, and one control that works for both lists beats two that look alike
 * and behave differently.
 */
export function Pager({
  previousHref,
  nextHref,
  summary,
  className,
}: {
  /** Null at the first page. */
  previousHref: string | null
  /** Null at the last. */
  nextHref: string | null
  /** "13–24 of 41 listings", or whatever the list counts in. */
  summary: string
  className?: string
}) {
  // Nothing to page through: the summary alone would be a control-shaped row saying
  // "1–3 of 3", which is noise.
  if (!previousHref && !nextHref) return null

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3 border-t pt-4", className)}
    >
      <p className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
        {summary}
      </p>

      <div className="flex items-center gap-2">
        <Step href={previousHref} direction="previous" />
        <Step href={nextHref} direction="next" />
      </div>
    </nav>
  )
}

function Step({ href, direction }: { href: string | null; direction: "previous" | "next" }) {
  const label = direction === "previous" ? "Previous" : "Next"
  const icon =
    direction === "previous" ? (
      <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
    ) : (
      <ChevronRightIcon className="size-3.5" aria-hidden="true" />
    )

  const shape = "inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 text-xs font-medium"

  if (!href) {
    return (
      <span aria-disabled="true" className={cn(shape, "text-muted-foreground/50")}>
        {direction === "previous" ? icon : null}
        {label}
        {direction === "next" ? icon : null}
      </span>
    )
  }

  return (
    <Link
      href={href}
      // Paging is a deliberate click on a database-backed render; prefetching every one
      // of them would speculatively run the query for a page most people never open.
      prefetch={false}
      className={cn(
        shape,
        "hover:bg-muted focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
      )}
    >
      {direction === "previous" ? icon : null}
      {label}
      {direction === "next" ? icon : null}
    </Link>
  )
}
