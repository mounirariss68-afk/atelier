import { RefreshCw, AlertCircle, WifiOff } from "lucide-react";

function Shimmer({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`relative overflow-hidden bg-white/5 rounded-xl ${className}`}
      style={style}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shimmer className="w-8 h-8 rounded-lg !bg-gray-100" />
        <Shimmer className="h-3 w-20 !bg-gray-100 rounded" />
      </div>
      <Shimmer className="h-7 w-24 !bg-gray-100 rounded" />
      <Shimmer className="h-3 w-16 !bg-gray-100 rounded" />
    </div>
  );
}

function ChartSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-100 p-4 space-y-3 ${height}`}>
      <div className="flex items-center justify-between">
        <Shimmer className="h-4 w-32 !bg-gray-100 rounded" />
        <Shimmer className="h-3 w-16 !bg-gray-100 rounded" />
      </div>
      <div className="flex-1 flex items-end gap-2 pt-4 pb-2 px-2">
        {[40, 65, 50, 80, 55, 70, 45, 60].map((h, i) => (
          <Shimmer
            key={i}
            className="flex-1 !bg-gray-100 rounded-t"
            style={{ height: `${h}%` } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
      <Shimmer className="h-4 w-40 !bg-gray-100 rounded" />
      <div className="space-y-2.5">
        <div className="flex gap-3">
          {[1, 2, 3, 4].map((c) => (
            <Shimmer key={c} className="h-3 flex-1 !bg-gray-200 rounded" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-3">
            {[1, 2, 3, 4].map((c) => (
              <Shimmer key={c} className="h-3 flex-1 !bg-gray-100 rounded" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Shimmer className="h-4 w-28 !bg-gray-100 rounded" />
        <div className="flex gap-1.5">
          {[1, 2, 3].map((i) => (
            <Shimmer key={i} className="h-6 w-14 !bg-gray-100 rounded-full" />
          ))}
        </div>
      </div>
      <Shimmer className="h-48 w-full !bg-gray-50 rounded-lg" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="h-screen flex flex-col bg-[#F4F6F8]">
      <header className="flex-shrink-0 h-14 bg-[#0E2841] flex items-center px-4 gap-3">
        <Shimmer className="h-5 w-20 rounded" />
        <div className="h-5 w-px bg-white/20" />
        <div className="flex-1 space-y-1">
          <Shimmer className="h-2.5 w-14 rounded" />
          <Shimmer className="h-3 w-36 rounded" />
        </div>
        <Shimmer className="w-7 h-7 rounded-full" />
        <Shimmer className="w-20 h-7 rounded-lg" />
      </header>

      <div className="flex-1 min-h-0 flex">
        <nav className="flex-shrink-0 w-52 bg-white border-r border-gray-200 py-2 space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              <Shimmer className="w-5 h-5 !bg-gray-100 rounded" />
              <Shimmer className="h-3 w-20 !bg-gray-100 rounded" />
            </div>
          ))}
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="sticky top-0 z-10 bg-white/95 border-b border-gray-200 px-5 py-2.5 flex items-center gap-2">
            <Shimmer className="h-6 w-16 !bg-gray-100 rounded-lg" />
            <div className="h-4 w-px bg-gray-200" />
            {[1, 2, 3, 4].map((i) => (
              <Shimmer key={i} className="h-6 w-20 !bg-gray-100 rounded-full" />
            ))}
          </div>

          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <KpiCardSkeleton key={i} />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartSkeleton />
              <MapSkeleton />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartSkeleton height="h-56" />
              <TableSkeleton rows={4} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export function DealerPortalSkeleton() {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="flex-shrink-0 h-14 bg-[#0E2841] flex items-center px-4 gap-4">
        <div className="flex items-center gap-2.5">
          <Shimmer className="w-8 h-8 rounded-lg" />
          <div className="space-y-1">
            <Shimmer className="h-2.5 w-14 rounded" />
            <Shimmer className="h-2 w-20 rounded" />
          </div>
        </div>
        <div className="h-6 w-px bg-white/20" />
        <div className="flex-1 space-y-1">
          <Shimmer className="h-3.5 w-36 rounded" />
          <Shimmer className="h-2.5 w-24 rounded" />
        </div>
        <Shimmer className="w-7 h-7 rounded-full" />
        <Shimmer className="w-7 h-7 rounded-full" />
      </header>

      <div className="flex-1 flex min-h-0">
        <nav className="flex-shrink-0 w-52 bg-white border-r border-gray-200 py-2 space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Shimmer className="w-5 h-5 !bg-gray-100 rounded" />
              <Shimmer className="h-3 w-24 !bg-gray-100 rounded" />
            </div>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-6 space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <KpiCardSkeleton key={i} />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartSkeleton />
              <TableSkeleton rows={4} />
            </div>
            <TableSkeleton rows={5} />
          </div>
        </main>
      </div>
    </div>
  );
}

export function DataErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0E2841]">
      <div className="text-center space-y-5 max-w-sm px-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <WifiOff size={28} className="text-red-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-white">Unable to load data</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Something went wrong while fetching demo data. This could be a temporary network issue.
          </p>
        </div>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F5A623] text-[#0E2841] rounded-lg text-sm font-semibold hover:bg-[#e09520] transition-colors"
        >
          <RefreshCw size={14} />
          Try again
        </button>
      </div>
    </div>
  );
}

export function InlineLoadingPlaceholder({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center space-y-3">
        <div className="w-6 h-6 border-2 border-[#E30613] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-gray-400">{message}</p>
      </div>
    </div>
  );
}

export function InlineErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center space-y-3 max-w-xs">
        <AlertCircle size={24} className="text-red-400 mx-auto" />
        <p className="text-sm text-gray-600">{message ?? "Failed to load data"}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#E30613] bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
