import { ButtonLink } from "@/components/button-link"
import { ListingCard } from "@/components/listing-card"
import { decodeCursor, encodeCursor, getListingPage } from "@/lib/listings/read"

/**
 * Browse.
 *
 * Server-rendered, and reading only common columns — so the page that gets the most
 * traffic never touches `attributes` and never resolves a form schema.
 */
export default async function HomePage(props: { searchParams: Promise<{ after?: string }> }) {
  const { after } = await props.searchParams
  const { listings, nextCursor } = await getListingPage({ cursor: decodeCursor(after) })

  if (listings.length === 0) {
    return <EmptyState resetFilters={Boolean(after)} />
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="sr-only">Listings</h1>

      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {listings.map((listing) => (
          <ListingCard key={listing.slug} listing={listing} />
        ))}
      </div>

      {nextCursor ? (
        <nav className="mt-12 flex justify-center">
          {/* A link rather than a button, so the next page is crawlable and the
              browser's back button behaves. */}
          <ButtonLink variant="outline" href={`/?after=${encodeCursor(nextCursor)}`}>
            Show more
          </ButtonLink>
        </nav>
      ) : null}
    </div>
  )
}

function EmptyState({ resetFilters }: { resetFilters: boolean }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        {resetFilters ? "No more listings" : "Nothing listed yet"}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-prose text-sm leading-relaxed">
        {resetFilters
          ? "You have reached the end of the list."
          : "Categories and the fields they collect are configured in the admin console and stored in the database — adding a category takes no code and no deploy."}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {resetFilters ? (
          <ButtonLink href="/">Back to the start</ButtonLink>
        ) : (
          <>
            <ButtonLink href="/sell">Sell an item</ButtonLink>
            <ButtonLink variant="outline" href="/admin">
              Open admin console
            </ButtonLink>
          </>
        )}
      </div>
    </div>
  )
}
