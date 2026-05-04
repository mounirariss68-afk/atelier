import { useQuery } from "@tanstack/react-query";

export interface PriceHistoryRecord {
  id: number;
  recordType: string;
  referenceId: string;
  brand: string;
  modelCode: string;
  price: number;
  previousPrice: number | null;
  priceChangePercent: number | null;
  source: string;
  scrapeRunId: string;
  recordedAt: string;
}

export interface PriceHistorySummary {
  referenceId: string;
  brand: string;
  modelCode: string;
  recordType: string;
  latestPrice: number;
  earliestPrice: number;
  minPrice: number;
  maxPrice: number;
  dataPoints: number;
  firstSeen: string;
  lastSeen: string;
}

async function fetchPriceHistory(params?: {
  referenceId?: string;
  brand?: string;
  recordType?: string;
  limit?: number;
}): Promise<PriceHistoryRecord[]> {
  const qs = new URLSearchParams();
  if (params?.referenceId) qs.set("referenceId", params.referenceId);
  if (params?.brand) qs.set("brand", params.brand);
  if (params?.recordType) qs.set("recordType", params.recordType);
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `/api/arcelik/price-history${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch price history");
  return res.json();
}

async function fetchPriceHistorySummary(): Promise<PriceHistorySummary[]> {
  const res = await fetch("/api/arcelik/price-history/summary");
  if (!res.ok) throw new Error("Failed to fetch price history summary");
  return res.json();
}

export function usePriceHistory(params?: {
  referenceId?: string;
  brand?: string;
  recordType?: string;
  limit?: number;
}) {
  return useQuery<PriceHistoryRecord[]>({
    queryKey: ["arcelik", "price-history", params ?? {}],
    queryFn: () => fetchPriceHistory(params),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function usePriceHistorySummary() {
  return useQuery<PriceHistorySummary[]>({
    queryKey: ["arcelik", "price-history-summary"],
    queryFn: fetchPriceHistorySummary,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
