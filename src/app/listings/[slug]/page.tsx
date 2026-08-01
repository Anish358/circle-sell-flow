import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { BadgeCheckIcon } from "lucide-react"

import { JsonLd } from "@/components/json-ld"
import { ListingImage } from "@/components/listing-image"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { getCurrentUser } from "@/lib/auth"
import { formatPrice } from "@/lib/form-schema/format"
import { resolveListingDisplay, type DisplayAttribute } from "@/lib/listings/display"
import { CONDITIONS } from "@/lib/listings/input-schema"
import { getListingBySlug, type ListingDetail } from "@/lib/listings/read"

/**
 * A request that cannot finish in 20 seconds is not slow, it is stuck. Without this the
 * platform default let a stuck request hold a function slot for five full minutes, which is
 * how one bad request became several.
 */
export const maxDuration = 20

/**
 * The product detail page.
 *
 * Server-rendered, because this is the page a marketplace needs indexed — which is the
 * product argument for choosing a framework that renders on the server, rather than a
 * preference about tooling.
 *
 * The layout is driven entirely by configuration: which attributes appear, how they are
 * grouped, and which are prominent enough for a spec chip all come from the registry.
 * Nothing here knows what any category collects.
 */

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await props.params
  const listing = await getListingBySlug(slug)
  if (!listing) return { title: "Listing not found" }

  const description =
    listing.description?.slice(0, 160) ??
    `${listing.categoryName} in ${listing.city}, ${formatPrice(listing.pricePaise, listing.currency)}.`

  return {
    title: listing.title,
    description,
    openGraph: {
      title: listing.title,
      description,
      type: "website",
      images: listing.primaryImage ? [{ url: listing.primaryImage.url }] : undefined,
    },
  }
}

export default async function ListingPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const listing = await getListingBySlug(slug)

  if (!listing || !(await isViewable(listing))) notFound()

  const display = await resolveListingDisplay(
    listing.categoryId,
    listing.attributes,
    listing.verifiedAttributes,
  )
  const condition = CONDITIONS.find((option) => option.value === listing.condition)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <JsonLd data={productSchema(listing, display.highlights)} />

      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-6 text-xs">
        <Link href="/" className="hover:text-foreground underline-offset-2 hover:underline">
          All listings
        </Link>
        <span aria-hidden="true"> › </span>
        <span>{listing.categoryName}</span>
      </nav>

      <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:gap-10 lg:gap-12">
        <Gallery listing={listing} />

        <div className="grid content-start gap-6">
          <header className="grid gap-3">
            {listing.status === "draft" ? (
              <Badge variant="secondary" className="w-fit">
                Draft — not publicly listed
              </Badge>
            ) : null}

            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{listing.title}</h1>

            <p className="text-2xl font-semibold">
              {formatPrice(listing.pricePaise, listing.currency)}
            </p>

            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {condition ? <span className="text-foreground">{condition.label}</span> : null}
              <span aria-hidden="true">·</span>
              <span>{listing.city}</span>
              <span aria-hidden="true">·</span>
              <span>Listed by {listing.sellerName}</span>
            </div>

            <VerificationNotice listing={listing} />
          </header>

          {/* The prominent fields, as configured. What counts as a headline spec is a
              per-category decision made in the admin console, not in this file. */}
          {display.highlights.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {display.highlights.map((attribute) => (
                <li
                  key={attribute.slug}
                  className="bg-muted/60 grid gap-0.5 rounded-lg px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground text-xs">{attribute.label}</span>
                  <AttributeValue attribute={attribute} />
                </li>
              ))}
            </ul>
          ) : null}

          {listing.description ? (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold">Description</h2>
              {/* `whitespace-pre-line` keeps the paragraphs the seller typed; React
                  escapes the text itself, so no sanitising is needed here. */}
              <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">
                {listing.description}
              </p>
            </section>
          ) : null}
        </div>
      </div>

      <Separator className="my-10" />

      <section className="grid gap-8">
        <h2 className="text-sm font-semibold">Details</h2>

        <div className="grid gap-8 sm:grid-cols-2">
          {display.groups.map((group) => (
            <AttributeTable
              key={group.slug ?? "ungrouped"}
              heading={group.label}
              attributes={group.attributes}
            />
          ))}
        </div>

        {/* Values whose field has since been archived or detached from the category.
            They stay visible: a configuration change must not rewrite a listing's
            history, and quietly dropping an answer the seller gave is worse than
            showing it under a heading that explains itself. */}
        {display.orphaned.length > 0 ? (
          <AttributeTable
            heading="Additional details"
            note="Recorded when this was listed. These fields are no longer collected for this category."
            attributes={display.orphaned}
          />
        ) : null}
      </section>
    </div>
  )
}

/**
 * Who may see this listing.
 *
 * A draft is the seller's private work in progress — it must not be readable by anyone
 * who guesses or is sent the URL, which is what an unguarded detail page would allow.
 * Its own seller can still see it, so the "View listing" link after saving a draft
 * works. `removed` is gone for everybody, including its owner.
 *
 * A 404 rather than a 403: telling a stranger that a listing exists but is hidden is
 * itself a small leak.
 */
async function isViewable(listing: ListingDetail): Promise<boolean> {
  if (listing.status === "active" || listing.status === "sold") return true
  if (listing.status === "removed") return false

  const viewer = await getCurrentUser()
  return viewer?.id === listing.sellerId
}

function Gallery({ listing }: { listing: ListingDetail }) {
  return (
    <div className="grid gap-3">
      <ListingImage
        image={listing.primaryImage}
        seed={listing.slug}
        className="aspect-4/3 rounded-xl"
      />
      {listing.images.length > 1 ? (
        <ul className="grid grid-cols-4 gap-3">
          {listing.images.slice(1, 5).map((image) => (
            <li key={image.url}>
              <ListingImage
                image={image}
                seed={listing.slug}
                className="aspect-square rounded-lg"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function AttributeTable({
  heading,
  note,
  attributes,
}: {
  heading: string | null
  note?: string
  attributes: DisplayAttribute[]
}) {
  if (attributes.length === 0) return null

  return (
    <section className="grid content-start gap-3">
      {heading ? (
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {heading}
        </h3>
      ) : null}
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
      <dl className="divide-y border-y">
        {attributes.map((attribute) => (
          <div key={attribute.slug} className="grid grid-cols-2 gap-4 py-2.5 text-sm">
            <dt className="text-muted-foreground">{attribute.label}</dt>
            <dd>
              <AttributeValue attribute={attribute} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * One attribute's value, which is where Circle's whole thesis lands in the interface.
 *
 * When the hub measured the field, its measurement leads and the seller's claim follows
 * as context — never replacing it, and never quietly agreeing with it either. Showing
 * "89% ✓ Verified · seller stated 92%" is more useful than either number alone, and
 * hiding the disagreement would be the one presentation that actually erodes trust.
 */
function AttributeValue({ attribute }: { attribute: DisplayAttribute }) {
  if (attribute.verified === null) {
    return <span className="font-medium">{attribute.display}</span>
  }

  return (
    <span className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{attribute.verified}</span>
        <VerifiedMark />
      </span>
      {attribute.differs ? (
        <span className="text-muted-foreground text-xs">Seller stated {attribute.display}</span>
      ) : null}
    </span>
  )
}

function VerifiedMark() {
  return (
    <span className="text-primary inline-flex items-center gap-0.5 text-xs font-medium">
      <BadgeCheckIcon className="size-3.5" aria-hidden="true" />
      Verified
    </span>
  )
}

/**
 * The provenance line: who checked the item, and when.
 *
 * A verified value with no attached actor and timestamp is just a stronger-sounding
 * claim, which is why the database refuses to store one — this renders what it
 * guarantees.
 */
function VerificationNotice({ listing }: { listing: ListingDetail }) {
  if (!listing.verifiedAt) return null

  return (
    <p className="border-primary/30 bg-primary/5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs">
      <BadgeCheckIcon className="text-primary size-4" aria-hidden="true" />
      <span className="font-medium">Checked at a Circle hub</span>
      <span className="text-muted-foreground">
        {formatVerifiedAt(listing.verifiedAt)}
        {listing.verifiedByName ? ` · ${listing.verifiedByName}` : ""}
      </span>
    </p>
  )
}

/** IST, because that is where the hub is and where the buyer reads this. */
function formatVerifiedAt(at: Date): string {
  return at.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })
}

/**
 * schema.org Product, so a listing can appear as a rich result.
 *
 * Prominent attributes become `additionalProperty`, which means the structured data
 * gains a category's new fields automatically — the same configuration that drives the
 * form and the page also drives what search engines are told.
 *
 * Where the hub measured a value, that is the one published: structured data is a claim
 * made to third parties, so it should carry the best-evidenced answer available rather
 * than the seller's unverified one.
 */
function productSchema(listing: ListingDetail, highlights: DisplayAttribute[]) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description ?? undefined,
    category: listing.categoryName,
    image: listing.images.map((image) => image.url),
    offers: {
      "@type": "Offer",
      price: (listing.pricePaise / 100).toFixed(2),
      priceCurrency: listing.currency,
      itemCondition:
        listing.condition === "new"
          ? "https://schema.org/NewCondition"
          : "https://schema.org/UsedCondition",
      availability:
        listing.status === "active"
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      areaServed: listing.city,
    },
    additionalProperty: highlights.map((attribute) => ({
      "@type": "PropertyValue",
      name: attribute.label,
      value: attribute.verified ?? attribute.display,
    })),
  }
}
