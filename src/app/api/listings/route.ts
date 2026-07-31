import { requireUser } from "@/lib/auth"
import { createListing } from "@/lib/listings/create"

/**
 * A request that cannot finish in 20 seconds is not slow, it is stuck. Without this the
 * platform default let a stuck request hold a function slot for five full minutes, which is
 * how one bad request became several.
 */
export const maxDuration = 20

/**
 * POST /api/listings — create a listing.
 *
 * Thin on purpose: parse the body, get the seller from the session, hand both to
 * `createListing`. The route decides status codes; it makes no decisions about
 * what is valid, so the same logic is reachable from a server action or a script
 * without duplicating any of it.
 */
export async function POST(request: Request) {
  const seller = await requireUser()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: { code: "invalid_json", message: "Body must be JSON." } },
      { status: 400 },
    )
  }

  const result = await createListing(body, seller.id)

  if (!result.ok) {
    return Response.json(
      {
        error: {
          code: result.code,
          message: result.message,
          fieldErrors: result.fieldErrors,
          schemaChanged: result.schemaChanged,
        },
      },
      { status: result.status },
    )
  }

  return Response.json(
    {
      listing: {
        id: result.listing.id,
        slug: result.listing.slug,
        status: result.listing.status,
        schemaVersion: result.listing.schemaVersion,
      },
    },
    {
      // A replayed idempotent request returns the original listing, and 200 rather
      // than 201 says plainly that nothing new was created.
      status: result.reused ? 200 : 201,
      headers: { Location: `/listings/${result.listing.slug}` },
    },
  )
}
