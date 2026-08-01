import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { resolveFormSchema } from "@/lib/form-schema/resolve"
import { getListingBySlug } from "@/lib/listings/read"
import { verificationSchema } from "@/lib/listings/verification"
import { VerifyForm } from "./verify-form"

export const maxDuration = 20

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await props.params
  return { title: `Verify · ${slug}` }
}

/**
 * The hub's screen for one item.
 *
 * There is no bespoke form here. The verification schema is the seller's schema filtered
 * to the fields the assignment marks verifiable, and `DynamicForm` renders it without
 * knowing the difference — the third surface driven by the same registry rows, after the
 * sell flow and the product page.
 */
export default async function VerifyListingPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const listing = await getListingBySlug(slug)
  if (!listing) notFound()

  const schema = await resolveFormSchema(listing.categorySlug)

  // A deactivated category still has listings, and they still arrive at the hub. Say so
  // rather than rendering an empty form.
  if (!schema) {
    return (
      <Shell listing={listing}>
        <p className="rounded-lg border border-dashed px-4 py-6 text-sm">
          This listing&rsquo;s category is deactivated, so it resolves to no form. Reactivate it to
          record a verification.
        </p>
      </Shell>
    )
  }

  const verifySchema = verificationSchema(schema, listing.attributes)

  return (
    <Shell listing={listing}>
      {verifySchema.groups.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-sm leading-relaxed">
          Nothing in this category is marked for hub verification yet. Open{" "}
          <Link
            href={`/admin/categories/${listing.categorySlug}`}
            prefetch={false}
            className="underline underline-offset-2"
          >
            {listing.categoryName}
          </Link>{" "}
          and tick <span className="font-medium">Hub verifies</span> on the fields the hub can
          measure. No deploy involved — this form is generated from those rows.
        </p>
      ) : (
        <VerifyForm
          listingId={listing.id}
          listingSlug={listing.slug}
          schema={verifySchema}
          recorded={listing.verifiedAttributes}
        />
      )}
    </Shell>
  )
}

/** IST, and spelled out — "1/8/2026" means two different days depending on the reader. */
function formatIst(at: Date): string {
  return at.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })
}

function Shell({
  listing,
  children,
}: {
  listing: NonNullable<Awaited<ReturnType<typeof getListingBySlug>>>
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <nav className="text-muted-foreground text-xs">
          <Link
            href="/admin/verification"
            prefetch={false}
            className="hover:text-foreground underline-offset-2 hover:underline"
          >
            Verification
          </Link>
          <span aria-hidden="true"> › </span>
          <span>{listing.title}</span>
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{listing.title}</h1>
          <Badge variant="secondary" className="text-xs font-normal">
            {listing.categoryName}
          </Badge>
          {listing.verifiedAt ? (
            <Badge className="text-xs font-normal">
              Verified {formatIst(listing.verifiedAt)}
              {listing.verifiedByName ? ` · ${listing.verifiedByName}` : ""}
            </Badge>
          ) : null}
          <Link
            href={`/listings/${listing.slug}`}
            prefetch={false}
            className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-2"
          >
            View product page
          </Link>
        </div>
      </header>

      {children}
    </div>
  )
}
