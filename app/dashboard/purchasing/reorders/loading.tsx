import { Skeleton } from '@/components/ui/skeleton'

export default function ReordersLoading() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading reorders">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-5 w-96 max-w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
