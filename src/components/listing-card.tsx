import Link from "next/link"
import { BadgeCheckIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatPrice } from "@/lib/form-schema/format"
import type { ListingCard as Listing } from "@/lib/listings/read"
import { CONDITIONS } from "@/lib/listings/input-schema"
import { ListingImage } from "./listing-image"

/**
 * One listing on the browse grid.
 *
 * Reads only common columns — title, price, condition, city, category. Nothing here
 * touches `attributes`, which is why the storage choice for category-specific values
 * costs the busiest page in the app nothing at all.
 */
export function ListingCard({ listing }: { listing: Listing }) {
  const condition = CONDITIONS.find((option) => option.value === listing.condition)

  return (
    <article className="group">
      <Link
        href={`/listings/${listing.slug}`}
        className="focus-visible:ring-ring/50 grid gap-3 rounded-xl outline-none focus-visible:ring-3"
      >
        <ListingImage
          image={listing.primaryImage}
          seed={listing.slug}
          className="aspect-4/3 rounded-xl"
        />

        <div className="grid gap-1">
          <p className="text-base font-semibold">
            {formatPrice(listing.pricePaise, listing.currency)}
          </p>
          {/* Two lines maximum: titles vary wildly in length and a ragged grid reads
              as broken. */}
          <h3 className="line-clamp-2 text-sm leading-snug">{listing.title}</h3>
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span>{listing.city}</span>
            <span aria-hidden="true">·</span>
            <span>{listing.categoryName}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {condition ? (
              <Badge variant="secondary" className="w-fit text-xs font-normal">
                {condition.label}
              </Badge>
            ) : null}
            {/* One boolean from a common column, so the browse grid still reads no
                attributes. What was measured is the product page's job. */}
            {listing.verifiedAt ? (
              <Badge className="w-fit gap-1 text-xs font-normal">
                <BadgeCheckIcon className="size-3" aria-hidden="true" />
                Verified
              </Badge>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  )
}
