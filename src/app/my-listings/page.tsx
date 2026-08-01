import type { Metadata } from "next"
import Link from "next/link"
import { BadgeCheckIcon } from "lucide-react"

import { ButtonLink } from "@/components/button-link"
import { Pager } from "@/components/pager"
import { SearchBox } from "@/components/search-box"
import { Badge } from "@/components/ui/badge"
import { requireUser } from "@/lib/auth"
import { formatPrice } from "@/lib/form-schema/format"
import { countSellerListings, getSellerListings, type SellerListing } from "@/lib/listings/read"
import { PAGE_PARAM, pageHref, readPage } from "@/lib/pagination"
import { searchTerms } from "@/lib/search"

export const metadata: Metadata = { title: "My listings" }

/**
 * A request that cannot finish in 20 seconds is not slow, it is stuck. Without this the
 * platform default let a stuck request hold a function slot for five full minutes, which is
 * how one bad request became several.
 */
export const maxDuration = 20

/** Ten to a page, as everywhere else that lists rows rather than cards. */
const PAGE_SIZE = 10

/**
 * Everything you have listed, in every state.
 *
 * The seller's counterpart to browse, and deliberately not the same page: browse answers
 * "what can I buy", which excludes drafts, sold items and anything withdrawn. This
 * answers "what have I got", which is exactly those. A draft is invisible everywhere else
 * in the app — only its owner may even load it — so without this page the only way back
 * to one is a URL you were shown once.
 *
 * Whose listings these are comes from the session, never from the URL. There is no
 * `?seller=` to tamper with, because the question "whose?" is not one the client gets to
 * answer.
 */
export default async function MyListingsPage(props: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const [{ q, page: rawPage }, user] = await Promise.all([props.searchParams, requireUser()])
  const terms = searchTerms(q)

  const total = await countSellerListings(user.id, terms)
  const page = readPage(rawPage, PAGE_SIZE, total)
  const listings = await getSellerListings({
    sellerId: user.id,
    searchTerms: terms,
    limit: PAGE_SIZE,
    offset: page.offset,
  })

  const query = new URLSearchParams()
  if (q) query.set("q", q)
  if (page.number > 1) query.set(PAGE_PARAM, String(page.number))

  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-8 sm:py-10">
      {/* No "Sell an item" button here: the header already carries one, permanently, a
          couple of inches away. Two primary actions in one corner is one too many. */}
      <h1 className="text-xl font-semibold tracking-tight">My listings</h1>

      {total === 0 && terms.length === 0 ? (
        <Empty />
      ) : (
        <>
          <SearchBox
            query={query.toString()}
            label="Search your listings by title, category or city"
            placeholder="Search your listings…"
            resetParams={[PAGE_PARAM]}
            className="max-w-md"
          />

          {listings.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
              Nothing of yours matches “{q}”.
            </p>
          ) : (
            <ul className="grid gap-2">
              {listings.map((listing) => (
                <li key={listing.slug}>
                  <Row listing={listing} />
                </li>
              ))}
            </ul>
          )}

          <Pager
            previousHref={page.hasPrevious ? pageHref(query.toString(), page.number - 1) : null}
            nextHref={page.hasNext ? pageHref(query.toString(), page.number + 1) : null}
            summary={`${page.from}–${page.to} of ${page.totalItems} listing${
              page.totalItems === 1 ? "" : "s"
            }`}
          />
        </>
      )}
    </div>
  )
}

function Row({ listing }: { listing: SellerListing }) {
  return (
    <Link
      href={`/listings/${listing.slug}`}
      prefetch={false}
      className="hover:bg-muted/50 focus-visible:ring-ring/50 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 transition-colors outline-none focus-visible:ring-3"
    >
      <span className="text-sm font-medium">{listing.title}</span>

      {/* Only the states that are not "live and ordinary" get a badge — a row of
          "active" labels would be a column of noise saying nothing. */}
      {listing.status !== "active" ? <StatusBadge status={listing.status} /> : null}

      {listing.verifiedAt ? (
        <Badge className="gap-1 text-xs font-normal">
          <BadgeCheckIcon className="size-3" aria-hidden="true" />
          Verified
        </Badge>
      ) : null}

      <span className="text-muted-foreground ml-auto text-xs">
        {listing.categoryName} · {listing.city} · {listing.attributeCount} answers
      </span>

      <span className="w-full text-sm font-semibold sm:w-auto">
        {formatPrice(listing.pricePaise, listing.currency)}
      </span>
    </Link>
  )
}

/** Wording that says what the state means to the seller, not what the column holds. */
function StatusBadge({ status }: { status: SellerListing["status"] }) {
  const wording: Record<string, { label: string; variant: "secondary" | "outline" }> = {
    draft: { label: "Draft — only you can see this", variant: "outline" },
    sold: { label: "Sold", variant: "secondary" },
    removed: { label: "Withdrawn", variant: "outline" },
  }
  const shown = wording[status] ?? { label: status, variant: "secondary" as const }

  return (
    <Badge variant={shown.variant} className="text-xs font-normal">
      {shown.label}
    </Badge>
  )
}

function Empty() {
  return (
    <div className="rounded-lg border border-dashed px-4 py-12 text-center">
      <p className="text-sm font-medium">You have not listed anything yet</p>
      <p className="text-muted-foreground mx-auto mt-2 max-w-prose text-sm leading-relaxed">
        Drafts appear here too, so you can leave one half-finished and come back to it — nobody else
        can see it.
      </p>
      <div className="mt-6 flex justify-center">
        <ButtonLink href="/sell">Sell an item</ButtonLink>
      </div>
    </div>
  )
}
