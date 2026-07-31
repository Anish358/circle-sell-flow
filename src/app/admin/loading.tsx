import { Skeleton } from "@/components/skeleton"

export default function LoadingAdmin() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <Skeleton className="mb-6 h-8 w-72" />
      <div className="grid gap-2">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
