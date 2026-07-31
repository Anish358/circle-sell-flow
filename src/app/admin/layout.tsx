import type { Metadata } from "next"
import Link from "next/link"

import { ActorSwitcher } from "./actor-switcher"
import { getCurrentUser, isAdmin, listActors } from "@/lib/auth"

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · Circle" } }

/**
 * The admin console shell.
 *
 * The role check here is what a visitor meets, but it is **not** the security boundary:
 * every mutation re-checks independently, because a server action is its own callable
 * endpoint and does not run the layout that rendered its form. A layout gate alone
 * protects the view and nothing else.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  if (!isAdmin(user)) {
    return <Denied actors={await listActors()} currentEmail={user?.email ?? null} />
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-4">
        <nav className="flex items-center gap-1 text-sm" aria-label="Admin sections">
          {[
            { href: "/admin/categories", label: "Categories" },
            { href: "/admin/fields", label: "Field library" },
            { href: "/admin/audit", label: "Activity" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:bg-muted rounded-md px-3 py-1.5 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto">
          <ActorSwitcher actors={await listActors()} currentEmail={user?.email ?? null} />
        </div>
      </div>

      {children}
    </div>
  )
}

/**
 * What a non-admin sees. Deliberately explains how to become one, because the whole point
 * of the switcher is to make the check demonstrable rather than an obstacle.
 */
function Denied({
  actors,
  currentEmail,
}: {
  actors: Array<{ email: string; name: string; role: string }>
  currentEmail: string | null
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <h1 className="text-xl font-semibold tracking-tight">Administrators only</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        The registry decides what every seller is asked and what every listing may contain, so
        editing it is behind a role check. You are currently acting as{" "}
        <span className="text-foreground">{currentEmail ?? "nobody"}</span>, which is not an
        administrator.
      </p>
      <div className="mt-6">
        <ActorSwitcher actors={actors} currentEmail={currentEmail} />
      </div>
      <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
        Switching accounts is a demo affordance — this project does not implement authentication. It
        sets which seeded account you are, never which role: the role is always read from the user
        row.
      </p>
    </div>
  )
}
