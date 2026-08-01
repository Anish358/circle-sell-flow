import Link from "next/link"

import { ButtonLink } from "@/components/button-link"

/**
 * Global header. The three surfaces of the app — browse, sell, configure — are
 * all driven by the same field registry, so they sit at the same level here.
 */
export function SiteHeader() {
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Circle
        </Link>

        {/* Neither is prefetched. This header is on every page, and both destinations are
            server-rendered database work — the admin console resolves the whole category
            tree, the sell flow resolves a form schema. Prefetching them means every visit to
            any page speculatively runs two of the app's heaviest renders, each as its own
            serverless function holding its own connection, for a navigation that usually
            never happens. One deliberate click can afford to wait for one render. */}
        <nav className="text-muted-foreground ml-auto flex items-center gap-1 text-sm">
          <ButtonLink variant="ghost" size="sm" href="/admin" prefetch={false}>
            Admin
          </ButtonLink>
          <ButtonLink size="sm" href="/sell" prefetch={false}>
            Sell an item
          </ButtonLink>
        </nav>
      </div>
    </header>
  )
}
