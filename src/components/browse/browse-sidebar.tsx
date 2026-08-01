"use client"

import { useState, type ReactNode } from "react"
import { SlidersHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The browse controls — category tree and facets — with one disclosure below `lg`.
 *
 * Collapsed on a narrow screen because the alternative is measurable: expanded, the
 * tree and a category's filters push the first listing most of a screen down, and the
 * page that is supposed to show things to buy opens showing none. On a wide screen
 * there is room for both, so it is simply always open.
 *
 * The children are server components passed through: this owns a boolean and nothing
 * else, so nothing about the category tree or the facets ends up in the browser bundle
 * on account of a toggle.
 */
export function BrowseSidebar({
  activeCount,
  children,
}: {
  activeCount: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <aside className="grid h-fit content-start gap-4 lg:sticky lg:top-20 lg:gap-6">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit lg:hidden"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <SlidersHorizontalIcon aria-hidden="true" />
        {activeCount > 0 ? `Category & filters · ${activeCount}` : "Category & filters"}
      </Button>

      <div className={cn("grid gap-6", !open && "hidden lg:grid")}>{children}</div>
    </aside>
  )
}
