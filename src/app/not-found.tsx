import { ButtonLink } from "@/components/button-link"

/**
 * The 404, which on a marketplace is a routine page rather than an error.
 *
 * Listings are sold, withdrawn and — because drafts are private — invisible to everyone
 * but their seller, so a dead link is the normal end of a listing's life and not a
 * failure. It deserves the app's own layout and a way onwards, not the framework default.
 *
 * Deliberately says nothing about *why*. `notFound()` is what a draft belonging to
 * somebody else returns, and distinguishing "no such listing" from "not yours to see"
 * would leak the existence of private rows to anyone guessing URLs.
 */
export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-20">
      <h1 className="text-xl font-semibold tracking-tight">This page is not here</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        The listing may have sold, been withdrawn, or never existed. The link is not coming back,
        but everything else still is.
      </p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/">Browse listings</ButtonLink>
        <ButtonLink variant="outline" href="/sell">
          Sell an item
        </ButtonLink>
      </div>
    </div>
  )
}
