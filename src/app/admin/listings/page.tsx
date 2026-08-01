import type { Metadata } from "next"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { listAdminListings } from "@/lib/admin/actions/listings"
import { getCategoryTree, leafPaths } from "@/lib/categories"
import { RecategoriseDialog } from "./recategorise-dialog"

export const metadata: Metadata = { title: "Listings" }

/**
 * Listings, from the operator's side.
 *
 * One job: put a listing in the right category. Mis-categorisation is the ordinary
 * failure of a marketplace where sellers choose their own category, and it is the one
 * correction that changes what a listing is allowed to say about itself — so it is an
 * explicit action with its blast radius stated, not an editable dropdown in a table.
 */
export default async function AdminListingsPage() {
  const [rows, tree] = await Promise.all([listAdminListings(), getCategoryTree()])

  // Only leaves are offered, for the same reason the sell flow offers only leaves: the
  // tiers above exist to hold shared fields, not to hold items.
  const destinations = leafPaths(tree).map(({ node, path }) => ({
    slug: node.slug,
    label: path.join(" › "),
  }))

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Listings</h1>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          A listing&rsquo;s category decides which questions it answers, so moving one is not a
          relabelling: answers the destination does not collect are removed, and the ones it shares
          are kept. Both are named before anything is applied.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          Nothing listed yet.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5"
            >
              <Link
                href={`/listings/${row.slug}`}
                prefetch={false}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                {row.title}
              </Link>

              <Badge variant="secondary" className="text-xs font-normal">
                {row.categoryName}
              </Badge>
              {row.status !== "active" ? (
                <Badge variant="outline" className="text-xs font-normal">
                  {row.status}
                </Badge>
              ) : null}

              <span className="text-muted-foreground text-xs">
                {row.sellerName} · {row.attributeCount} answers
              </span>

              <span className="ml-auto">
                <RecategoriseDialog
                  listingSlug={row.slug}
                  title={row.title}
                  currentCategorySlug={row.categorySlug}
                  destinations={destinations}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
