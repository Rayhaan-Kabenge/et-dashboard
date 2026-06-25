import { Skeleton } from "@/components/ui/skeleton";

// Loading state: a calm wireframe of the dashboard (no spinners).
export default function DashboardSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-20 border-b border-hairline bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-xl2" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-60" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
        <Skeleton className="h-28 w-full rounded-xl2" />
        <Skeleton className="h-64 w-full rounded-xl2" />
        <Skeleton className="h-44 w-full rounded-xl2" />
        <div className="grid gap-6 lg:grid-cols-[1.9fr_1fr]">
          <Skeleton className="h-96 w-full rounded-xl2" />
          <Skeleton className="h-96 w-full rounded-xl2" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl2" />
      </main>
    </div>
  );
}
