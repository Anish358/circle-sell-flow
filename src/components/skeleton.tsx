import { cn } from "@/lib/utils"

/**
 * A placeholder block for loading states.
 *
 * These exist for two reasons, and the second is the less obvious one:
 *
 *  1. a click gets immediate feedback instead of a page that appears to do nothing;
 *  2. a `loading.tsx` boundary is where Next stops prefetching a **dynamic** route. Without
 *     one, hovering or scrolling past a link prefetches the whole thing — server render and
 *     database queries included — so a grid of links quietly became a grid of full page
 *     renders. The boundary turns that into prefetching the shell only.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("bg-muted animate-pulse rounded-md", className)} aria-hidden="true" />
}

/** One listing card's worth of placeholder. */
export function CardSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="aspect-4/3 rounded-xl" />
      <div className="grid gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  )
}

/** A stand-in for a generated form, whose real shape is not known until it is resolved. */
export function FormSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-5">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}
