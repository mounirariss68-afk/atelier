import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ArcelikProduct,
  CompetitorPrice,
  CityData,
  DealerProfile,
  CampaignTemplate,
  CalendarEntry,
  DataSource,
  KpiBenchmark,
} from "@/data/arcelik-seed";
import { DashboardSkeleton, DealerPortalSkeleton, DataErrorState } from "@/components/demo/arcelik/DataLoadingStates";

export interface ArcelikData {
  products: ArcelikProduct[];
  competitorPrices: CompetitorPrice[];
  cities: CityData[];
  dealers: DealerProfile[];
  campaigns: CampaignTemplate[];
  promotionalCalendar: CalendarEntry[];
  dataSources: DataSource[];
  kpiBenchmarks: KpiBenchmark[];
}

const EMPTY: ArcelikData = {
  products: [],
  competitorPrices: [],
  cities: [],
  dealers: [],
  campaigns: [],
  promotionalCalendar: [],
  dataSources: [],
  kpiBenchmarks: [],
};

let _snapshot: ArcelikData = EMPTY;
let _snapshotReady = false;

export function getArcelikDataSnapshot(): ArcelikData {
  return _snapshot;
}

export function isArcelikDataReady(): boolean {
  return _snapshotReady;
}

const BASE = "/api/arcelik";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

async function fetchAllArcelikData(): Promise<ArcelikData> {
  const [
    products,
    competitorPrices,
    cities,
    dealers,
    campaigns,
    promotionalCalendar,
    dataSources,
    kpiBenchmarks,
  ] = await Promise.all([
    fetchJson<ArcelikProduct[]>(`${BASE}/products`),
    fetchJson<CompetitorPrice[]>(`${BASE}/competitor-prices`),
    fetchJson<CityData[]>(`${BASE}/cities`),
    fetchJson<DealerProfile[]>(`${BASE}/dealers`),
    fetchJson<CampaignTemplate[]>(`${BASE}/campaigns`),
    fetchJson<CalendarEntry[]>(`${BASE}/calendar`),
    fetchJson<DataSource[]>(`${BASE}/data-sources`),
    fetchJson<KpiBenchmark[]>(`${BASE}/kpi-benchmarks`),
  ]);
  const data: ArcelikData = {
    products,
    competitorPrices,
    cities,
    dealers,
    campaigns,
    promotionalCalendar,
    dataSources,
    kpiBenchmarks,
  };
  _snapshot = data;
  _snapshotReady = true;
  return data;
}

const ArcelikDataCtx = createContext<ArcelikData>(EMPTY);

export function useArcelikData(): ArcelikData {
  return useContext(ArcelikDataCtx);
}

export function ArcelikDataProvider({
  children,
  fallback,
  variant = "business",
}: {
  children: ReactNode;
  fallback?: ReactNode;
  variant?: "business" | "dealer";
}) {
  const { data, isLoading, isError, refetch } = useQuery<ArcelikData>({
    queryKey: ["arcelik", "all-data"],
    queryFn: fetchAllArcelikData,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  if (isLoading && !data) {
    if (fallback) return <>{fallback}</>;
    return variant === "dealer" ? <DealerPortalSkeleton /> : <DashboardSkeleton />;
  }

  if (isError && !data) {
    if (fallback) return <>{fallback}</>;
    return <DataErrorState onRetry={() => refetch()} />;
  }

  const value = data ?? EMPTY;

  return (
    <ArcelikDataCtx.Provider value={value}>{children}</ArcelikDataCtx.Provider>
  );
}
