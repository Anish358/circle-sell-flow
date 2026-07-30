import { getCategoryTree } from "@/lib/categories"

/**
 * GET /api/categories — the active category tree.
 *
 * Nested rather than flat, because the picker renders it as a tree and every
 * consumer would otherwise have to reassemble it.
 */
export async function GET() {
  const tree = await getCategoryTree()
  return Response.json({ categories: tree })
}
