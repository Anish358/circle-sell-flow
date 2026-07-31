import { getCategoryTree } from "@/lib/categories"

/**
 * A request that cannot finish in 20 seconds is not slow, it is stuck. Without this the
 * platform default let a stuck request hold a function slot for five full minutes, which is
 * how one bad request became several.
 */
export const maxDuration = 20

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
