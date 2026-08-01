import { ActiveFilters } from "@/components/browse/active-filters"
import { BrowseSidebar } from "@/components/browse/browse-sidebar"
import { CategoryNav } from "@/components/browse/category-nav"
import { FacetPanel } from "@/components/browse/facet-panel"
import { ButtonLink } from "@/components/button-link"
import { ListingCard } from "@/components/listing-card"
import { getCategoryTree } from "@/lib/categories"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import {
  CATEGORY_PARAM,
  CURSOR_PARAM,
  browseUrl,
  buildFacets,
  firstPage,
  readSelections,
  toAttributeFilters,
  toParams,
  withoutFacets,
  type SearchParams,
} from "@/lib/listings/facets"
import { decodeCursor, encodeCursor, getListingPage } from "@/lib/listings/read"

/**
 * A request that cannot finish in 20 seconds is not slow, it is stuck. Without this the
 * platform default let a stuck request hold a function slot for five full minutes, which is
 * how one bad request became several.
 */
export const maxDuration = 20

/**
 * Browse.
 *
 * Server-rendered, and reading only common columns — so the page that gets the most
 * traffic never touches `attributes` unless the buyer actually filters on one.
 *
 * The filters are the second surface the registry pays for. The same `filterable` flag
 * an admin ticks on an assignment produces the facets here, from the same resolved
 * schema the sell form is built from — so a category invented after this file was
 * written arrives with working filters, and there is nothing to keep in step.
 */
export default async function HomePage(props: { searchParams: Promise<SearchParams> }) {
  const raw = await props.searchParams
  const params = toParams(raw)
  const categorySlug = params.get(CATEGORY_PARAM)

  // Issued together: the nav needs the whole tree, the facets need one category's
  // resolved schema, and neither reads the other's result.
  const [tree, schema] = await Promise.all([
    getCategoryTree(),
    // Null for a category that does not exist or has been deactivated. Browse then
    // falls back to everything rather than 404-ing: a link shared last month should
    // not become a dead end because an admin retired a category this morning.
    categorySlug ? resolveFormSchema(categorySlug) : Promise.resolve(null),
  ])

  const facets = schema ? buildFacets(schema) : []
  const selections = readSelections(facets, params)

  const { listings, nextCursor } = await getListingPage({
    cursor: decodeCursor(params.get(CURSOR_PARAM) ?? undefined),
    categorySlug: schema?.category.slug,
    // Validated against this category's registry before it reaches SQL — a param
    // naming a field that is not filterable here never becomes a predicate.
    filters: toAttributeFilters(selections),
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <BrowseSidebar activeCount={selections.length}>
          <CategoryNav tree={tree} current={schema?.category.slug ?? null} />
          {/* Renders nothing when the category has no filterable fields — which is
              itself the demonstration: filters are configuration, not code. */}
          <FacetPanel facets={facets} query={params.toString()} />
        </BrowseSidebar>

        <main className="grid content-start gap-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {schema ? schema.category.name : "Listings"}
            </h1>
            {schema && schema.category.path.length > 1 ? (
              <p className="text-muted-foreground text-sm">
                {schema.category.path.map((step) => step.name).join(" › ")}
              </p>
            ) : null}
          </div>

          <ActiveFilters selections={selections} params={raw} />

          {listings.length === 0 ? (
            <EmptyState
              filtered={selections.length > 0}
              paged={params.has(CURSOR_PARAM)}
              clearHref={browseUrl(withoutFacets(params))}
            />
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3">
              {listings.map((listing) => (
                <ListingCard key={listing.slug} listing={listing} />
              ))}
            </div>
          )}

          {nextCursor ? (
            <nav className="mt-6 flex justify-center">
              {/* A link rather than a button, so the next page is crawlable and the
                  browser's back button behaves. Built from the current params, so
                  paging keeps the category and the filters. */}
              <ButtonLink variant="outline" href={browseUrl(nextPage(params, nextCursor))}>
                Show more
              </ButtonLink>
            </nav>
          ) : null}
        </main>
      </div>
    </div>
  )
}

/** The same view, one page further in. */
function nextPage(params: URLSearchParams, cursor: Parameters<typeof encodeCursor>[0]) {
  const next = firstPage(params)
  next.set(CURSOR_PARAM, encodeCursor(cursor))
  return next
}

function EmptyState({
  filtered,
  paged,
  clearHref,
}: {
  filtered: boolean
  paged: boolean
  clearHref: string
}) {
  const heading = filtered
    ? "Nothing matches these filters"
    : paged
      ? "No more listings"
      : "Nothing listed yet"

  return (
    <div className="py-10">
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <p className="text-muted-foreground mt-3 max-w-prose text-sm leading-relaxed">
        {filtered
          ? "Try widening a range or removing a filter. Filters apply to this category's fields, which are configured in the admin console — not written in code."
          : paged
            ? "You have reached the end of the list."
            : "Categories and the fields they collect are configured in the admin console and stored in the database — adding a category takes no code and no deploy."}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {filtered ? (
          <ButtonLink href={clearHref}>Clear filters</ButtonLink>
        ) : paged ? (
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
