import type { Metadata } from "next"
import Link from "next/link"

import { getCurrentUser, isAdmin } from "@/lib/auth"

/**
 * A request that cannot finish in 20 seconds is not slow, it is stuck. Without this the
 * platform default let a stuck request hold a function slot for five full minutes, which is
 * how one bad request became several.
 */
export const maxDuration = 20

/**
 * Never prerendered — and this is a deploy concern, not a caching preference.
 *
 * Every page here reads the database, and one of them (`/admin/audit`) touches no
 * request-time API of its own. Without this, the build renders it to find out whether it
 * is static, that render queries Postgres, and a database that is slow or unreachable
 * fails the *build* — which is what took production down: the failed deploy left the
 * previous deployment live, still holding the previous database password.
 *
 * A deploy must not depend on the database being fast. Declaring the subtree dynamic up
 * front is also simply true: it is behind a per-request role check and may never be
 * cached across users.
 */
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · Circle" } }

/**
 * The admin console shell.
 *
 * The role check here is what a visitor meets, but it is **not** the security boundary:
 * every mutation re-checks independently, because a server action is its own callable
 * endpoint and does not run the layout that rendered its form. A layout gate alone
 * protects the view and nothing else.
 *
 * The global header hides the Admin link from anyone who is not an administrator, so this
 * page is normally unreachable by clicking. It still has to exist and still has to refuse:
 * a hidden link is a URL anyone can type.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  if (!isAdmin(user)) return <Denied currentEmail={user?.email ?? null} />

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-4">
        <nav className="flex items-center gap-1 text-sm" aria-label="Admin sections">
          {[
            { href: "/admin/categories", label: "Categories" },
            { href: "/admin/fields", label: "Field library" },
            { href: "/admin/listings", label: "Listings" },
            { href: "/admin/verification", label: "Verification" },
            { href: "/admin/audit", label: "Activity" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              // Not prefetched. All three read the database, so prefetching turned every
              // admin page load — and every full-tree revalidation, which discards the
              // router cache and re-prefetches — into four concurrent renders instead of
              // one. That is what made switching accounts and creating a category fail:
              // not the write, the wave of speculative reads behind it.
              prefetch={false}
              className="hover:bg-muted rounded-md px-3 py-1.5 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {children}
    </div>
  )
}

/**
 * What a non-admin sees on typing the URL directly.
 *
 * Reached deliberately rather than by accident, since the header offers no link to it —
 * so it explains the refusal and points at the one control that resolves it, instead of
 * repeating that control here.
 */
function Denied({ currentEmail }: { currentEmail: string | null }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <h1 className="text-xl font-semibold tracking-tight">Administrators only</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        The registry decides what every seller is asked and what every listing may contain, so
        editing it is behind a role check. You are currently acting as{" "}
        <span className="text-foreground">{currentEmail ?? "nobody"}</span>, which is not an
        administrator.
      </p>
      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
        Switch to the administrator account using <span className="text-foreground">Acting as</span>{" "}
        in the header, and this page — and the Admin link beside it — appear.
      </p>
      <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
        Switching accounts is a demo affordance — this project does not implement authentication. It
        sets which seeded account you are, never which role: the role is always read from the user
        row, so the cookie cannot grant a privilege the account does not have.
      </p>
    </div>
  )
}
