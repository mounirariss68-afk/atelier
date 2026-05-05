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
      <Shimmer className="h-4 w-32 !bg-gray-100 rounded" />
      <div className="flex items-end gap-2 pt-4 pb-2 px-2">
        {[60, 80, 45, 70, 55, 90, 65, 75].map((h, i) => (
          <Shimmer key={i} className="flex-1 !bg-gray-100 rounded-t" style={{ height: `${h}%` }} />
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

export function ManagerDashboardSkeleton() {
  return (
    <div className="h-screen flex flex-col bg-[#F4F6F8]">
      <header className="flex-shrink-0 h-14 bg-[#1E3A8A] flex items-center px-4 gap-3">
        <Shimmer className="h-5 w-24 rounded" />
        <div className="h-5 w-px bg-white/20" />
        <Shimmer className="h-3 w-40 rounded" />
        <div className="flex-1" />
        <Shimmer className="w-7 h-7 rounded-full" />
      </header>
      <div className="flex-1 min-h-0 flex">
        <nav className="flex-shrink-0 w-52 bg-white border-r border-gray-200 py-2 space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              <Shimmer className="w-5 h-5 !bg-gray-100 rounded" />
              <Shimmer className="h-3 w-24 !bg-gray-100 rounded" />
            </div>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <KpiCardSkeleton key={i} />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartSkeleton />
            <TableSkeleton rows={5} />
          </div>
        </main>
      </div>
    </div>
  );
}

export function ClientPortalSkeleton() {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="flex-shrink-0 h-14 bg-[#1E3A8A] flex items-center px-4 gap-4">
        <Shimmer className="h-5 w-32 rounded" />
        <div className="flex-1" />
        <Shimmer className="w-7 h-7 rounded-full" />
      </header>
      <div className="flex-1 flex min-h-0">
        <nav className="flex-shrink-0 w-52 bg-white border-r border-gray-200 py-2 space-y-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Shimmer className="w-5 h-5 !bg-gray-100 rounded" />
              <Shimmer className="h-3 w-20 !bg-gray-100 rounded" />
            </div>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <KpiCardSkeleton key={i} />)}
          </div>
          <TableSkeleton rows={6} />
        </main>
      </div>
    </div>
  );
}

export function AgentOpsSkeleton() {
  return (
    <div className="h-screen flex flex-col bg-[#0F172A]">
      <header className="flex-shrink-0 h-14 bg-[#1E293B] flex items-center px-4 gap-3">
        <Shimmer className="h-5 w-32 rounded" />
        <div className="flex-1" />
        <Shimmer className="w-7 h-7 rounded-full" />
      </header>
      <main className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Shimmer className="h-72 rounded-xl" />
          <Shimmer className="h-48 rounded-xl" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Shimmer key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </main>
    </div>
  );
}

export function DataErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
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
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-semibold hover:bg-[#1E3A8A] transition-colors"
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
        <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto" />
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#2563EB] bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
