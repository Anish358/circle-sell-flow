import { resolveFormSchema } from "@/lib/form-schema/resolve"

/**
 * GET /api/categories/:slug/form-schema — everything needed to render one
 * category's form, in a single call.
 *
 * This endpoint is hot (every open of the sell flow) and changes rarely, so it is
 * validated by ETag rather than cached for a fixed window:
 *
 *   - the ETag is the category's `config_version`, which the database bumps on any
 *     change affecting this resolved schema, its ancestors' included;
 *   - `must-revalidate` with `max-age=0` means a config change is visible on the
 *     very next request. A stale window would be wrong here — the admin console
 *     renders a live preview of this exact response while an admin is editing.
 *
 * So the common case costs a 304 with no body, and correctness is never traded for
 * it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const schema = await resolveFormSchema(slug)

  if (!schema) {
    return Response.json(
      { error: { code: "category_not_found", message: `No active category "${slug}".` } },
      { status: 404 },
    )
  }

  const etag = `"${schema.category.slug}-v${schema.configVersion}"`
  const headers = {
    ETag: etag,
    "Cache-Control": "public, max-age=0, must-revalidate",
  }

  // Deliberately exact, not a prefix match: this endpoint issues one ETag per URL.
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers })
  }

  return Response.json(schema, { headers })
}
