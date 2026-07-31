import { FormSkeleton, Skeleton } from "@/components/skeleton"

export default function LoadingSell() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <Skeleton className="mb-2 h-8 w-48" />
      <Skeleton className="mb-8 h-4 w-64" />
      <FormSkeleton />
    </div>
  )
}
