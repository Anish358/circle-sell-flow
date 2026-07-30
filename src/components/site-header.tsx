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

        <nav className="text-muted-foreground ml-auto flex items-center gap-1 text-sm">
          <ButtonLink variant="ghost" size="sm" href="/admin">
            Admin
          </ButtonLink>
          <ButtonLink size="sm" href="/sell">
            Sell an item
          </ButtonLink>
        </nav>
      </div>
    </header>
  )
}
