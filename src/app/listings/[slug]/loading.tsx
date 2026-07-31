import { Skeleton } from "@/components/skeleton"

/**
 * Also the prefetch boundary for this route.
 *
 * `/listings/[slug]` is dynamic, and Next prefetches a dynamic route down to its nearest
 * `loading` boundary. Without this file there was no boundary, so every card on the
 * homepage entering the viewport prefetched a complete product page — server render and
 * database queries and all. That turned one homepage visit into a dozen page renders.
 */
export default function LoadingListing() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <Skeleton className="mb-6 h-3 w-40" />
      <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:gap-10 lg:gap-12">
        <Skeleton className="aspect-4/3 rounded-xl" />
        <div className="grid content-start gap-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-56" />
          <div className="mt-2 flex gap-2">
            <Skeleton className="h-14 w-24 rounded-lg" />
            <Skeleton className="h-14 w-24 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
