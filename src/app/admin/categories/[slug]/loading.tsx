import { Skeleton } from "@/components/skeleton"

/**
 * Also this route's prefetch boundary, and here that matters more than the skeleton does.
 *
 * The categories list links to one of these per category, and this is the most expensive page
 * in the app: it resolves the whole form schema and runs a usage query containing two
 * recursive walks of the tree. Without a boundary of its own, opening the list prefetched
 * every editor at once — six of the heaviest render in the product, concurrently, which is
 * enough contention on a small database to have queries cancelled by the statement timeout.
 */
export default function LoadingCategoryEditor() {
  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3 w-96" />
      </div>
      <div className="grid gap-10 xl:grid-cols-[1fr_26rem]">
        <div className="grid gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  )
}
