import type { Metadata } from "next"
import Link from "next/link"

import { Pager } from "@/components/pager"
import { SearchBox } from "@/components/search-box"
import { Badge } from "@/components/ui/badge"
import { countAdminListings, listAdminListings } from "@/lib/admin/actions/listings"
import { getCategoryTree, leafPaths } from "@/lib/categories"
import { PAGE_PARAM, pageHref, readPage } from "@/lib/pagination"
import { searchTerms } from "@/lib/search"
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
/** Ten to a page, matching the field library — one console, one rhythm. */
const PAGE_SIZE = 10

export default async function AdminListingsPage(props: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const { q, page: rawPage } = await props.searchParams
  const terms = searchTerms(q)

  const [total, tree] = await Promise.all([countAdminListings(terms), getCategoryTree()])
  const page = readPage(rawPage, PAGE_SIZE, total)
  const rows = await listAdminListings(terms, { limit: PAGE_SIZE, offset: page.offset })

  const query = new URLSearchParams()
  if (q) query.set("q", q)
  if (page.number > 1) query.set(PAGE_PARAM, String(page.number))

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
      </header>

      <SearchBox
        query={query.toString()}
        label="Search listings by title, seller or category"
        placeholder="Search by title, seller or category…"
        resetParams={[PAGE_PARAM]}
        className="max-w-md"
      />

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          {terms.length > 0
            ? `No listing matches “${q}”. Search looks at the title, the seller's name and the category.`
            : "Nothing listed yet."}
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

      <Pager
        previousHref={page.hasPrevious ? pageHref(query.toString(), page.number - 1) : null}
        nextHref={page.hasNext ? pageHref(query.toString(), page.number + 1) : null}
        summary={`${page.from}–${page.to} of ${page.totalItems} listing${page.totalItems === 1 ? "" : "s"}`}
      />
    </div>
  )
}
