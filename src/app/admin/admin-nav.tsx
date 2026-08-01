"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

/**
 * The console's section tabs, with the current one marked.
 *
 * A client component for one reason: only the browser knows which path is showing, and
 * a shell that cannot say where you are makes five identical links look like five
 * unvisited ones. It holds no data — the pages remain server-rendered.
 *
 * The current tab is marked three ways on purpose. Colour and weight carry it at a
 * glance, an underline carries it for anyone who cannot separate those two greys, and
 * `aria-current="page"` carries it for a screen reader, which sees no styling at all.
 */
const SECTIONS = [
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/fields", label: "Field library" },
  { href: "/admin/listings", label: "Listings" },
  { href: "/admin/verification", label: "Verification" },
  { href: "/admin/audit", label: "Activity" },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="-mb-px flex flex-wrap items-center gap-1 text-sm" aria-label="Admin sections">
      {SECTIONS.map((section) => {
        // Prefix matching, so a category's own editor keeps Categories lit rather than
        // leaving every tab dark on the page you are actually looking at.
        const current = pathname === section.href || pathname.startsWith(`${section.href}/`)

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={current ? "page" : undefined}
            // Not prefetched. Every one of these reads the database, so prefetching turned
            // an admin page load — and every full-tree revalidation, which discards the
            // router cache and re-prefetches — into five concurrent renders instead of
            // one. That is what made switching accounts and creating a category fail: not
            // the write, the wave of speculative reads behind it.
            prefetch={false}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-2 transition-colors",
              current
                ? "border-foreground text-foreground font-medium"
                : "text-muted-foreground hover:border-border hover:text-foreground border-transparent",
            )}
          >
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}
