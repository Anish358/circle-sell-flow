import Link from "next/link"

import { ActorSwitcher } from "@/components/actor-switcher"
import { ButtonLink } from "@/components/button-link"
import { getCurrentUser, isAdmin, listActors } from "@/lib/auth"

/**
 * Global header. The three surfaces of the app — browse, sell, configure — are
 * all driven by the same field registry, so they sit at the same level here.
 *
 * The nav is role-aware: a seller is offered the sell flow, an administrator is
 * additionally offered the console. Offering a link that answers "Administrators only"
 * is a dead end, and hiding it is ordinary product courtesy.
 *
 * **It is not the security boundary, and nothing here should be mistaken for one.**
 * A hidden link is still a reachable URL. `/admin` is guarded by `requireAdmin()` in its
 * layout, and independently inside every mutation — a server action is its own callable
 * endpoint and does not run the layout that rendered its form. This only decides what is
 * worth showing; the refusal happens whether or not anyone was shown a link.
 *
 * Note what the nav does *not* do: hide "Sell an item" from an administrator. Nothing in
 * the API stops an admin listing an item, so hiding it would have the nav assert a rule
 * the code does not enforce. The nav shows exactly what you are permitted to do.
 */
export async function SiteHeader() {
  // Together, not in sequence: neither depends on the other, and this header renders on
  // every page in the app. `getCurrentUser` is request-cached, so pages that also need
  // the viewer — the product page's draft check, the admin layout's gate — reuse this one
  // rather than issuing their own.
  const [user, actors] = await Promise.all([getCurrentUser(), listActors()])
  const admin = isAdmin(user)

  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Circle
        </Link>

        {/* Ordered rather than stacked, so the header stays two rows at 390px instead of
            three. On a narrow screen the nav shares the first row with the logo and the
            switcher drops to its own; from `sm` up all three sit on one line. A sticky
            header eating a quarter of the viewport is worse than no demo control at all. */}
        <nav className="text-muted-foreground order-2 ml-auto flex items-center gap-1 text-sm sm:order-3">
          {/* Neither is prefetched. This header is on every page, and both destinations are
              server-rendered database work — the admin console resolves the whole category
              tree, the sell flow resolves a form schema. Prefetching them means every visit to
              any page speculatively runs two of the app's heaviest renders, each as its own
              serverless function holding its own connection, for a navigation that usually
              never happens. One deliberate click can afford to wait for one render. */}
          {/* Offered to administrators too, not only sellers. An admin can list an item —
              nothing in the API stops them — so an admin can have listings to look at, and
              hiding the link would have the nav assert a rule the code does not enforce. */}
          {user ? (
            <ButtonLink variant="ghost" size="sm" href="/my-listings" prefetch={false}>
              My listings
            </ButtonLink>
          ) : null}
          {admin ? (
            <ButtonLink variant="ghost" size="sm" href="/admin" prefetch={false}>
              Admin
            </ButtonLink>
          ) : null}
          <ButtonLink size="sm" href="/sell" prefetch={false}>
            Sell an item
          </ButtonLink>
        </nav>

        <div className="order-3 w-full sm:order-2 sm:ml-auto sm:w-auto">
          <ActorSwitcher actors={actors} currentEmail={user?.email ?? null} />
        </div>
      </div>
    </header>
  )
}
