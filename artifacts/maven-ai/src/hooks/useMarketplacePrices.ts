import { useQuery } from "@tanstack/react-query";

export interface MarketplacePriceSummaryRow {
  marketplace: string;
  brand: string;
  category: string;
  productCount: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
}

export interface MarketplacePriceBreakdown {
  marketplace: string;
  productCount: number;
  brandCount: number;
  categoryCount: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
}

async function fetchMarketplacePriceSummary(): Promise<
  MarketplacePriceSummaryRow[]
> {
  const res = await fetch("/api/arcelik/marketplace-prices/summary");
  if (!res.ok) throw new Error("Failed to fetch marketplace price summary");
  const rows = (await res.json()) as MarketplacePriceSummaryRow[];
  return rows.map((r) => ({
    ...r,
    productCount: Number(r.productCount),
    minPrice: Number(r.minPrice),
    maxPrice: Number(r.maxPrice),
    avgPrice: Number(r.avgPrice),
  }));
}

export function useMarketplacePriceSummary() {
  return useQuery<MarketplacePriceSummaryRow[]>({
    queryKey: ["arcelik", "marketplace-price-summary"],
    queryFn: fetchMarketplacePriceSummary,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export interface MarketplacePriceHistoryRow {
  id: number;
  marketplace: string;
  marketplaceProductId: string;
  brand: string;
  category: string;
  price: number;
  previousPrice: number | null;
  priceChangePercent: number | null;
  arcelikProductId: string | null;
  scrapeRunId: string;
  recordedAt: string;
}

async function fetchMarketplacePriceHistory(
  sinceDays: number,
): Promise<MarketplacePriceHistoryRow[]> {
  const qs = new URLSearchParams({
    sinceDays: String(sinceDays),
    limit: "10000",
  });
  const res = await fetch(`/api/arcelik/marketplace-prices/history?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch marketplace price history");
  const rows = (await res.json()) as MarketplacePriceHistoryRow[];
  return rows.map((r) => ({ ...r, price: Number(r.price) }));
}

export function useMarketplacePriceHistory(sinceDays: number) {
  return useQuery<MarketplacePriceHistoryRow[]>({
    queryKey: ["arcelik", "marketplace-price-history", sinceDays],
    queryFn: () => fetchMarketplacePriceHistory(sinceDays),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function aggregateByMarketplace(
  rows: MarketplacePriceSummaryRow[],
): MarketplacePriceBreakdown[] {
  const byMp = new Map<
    string,
    {
      productCount: number;
      brands: Set<string>;
      categories: Set<string>;
      minPrice: number;
      maxPrice: number;
      weightedSum: number;
    }
  >();
  for (const r of rows) {
    const key = String(r.marketplace ?? "").toLowerCase();
    if (!key) continue;
    const prev = byMp.get(key) ?? {
      productCount: 0,
      brands: new Set<string>(),
      categories: new Set<string>(),
      minPrice: Number.POSITIVE_INFINITY,
      maxPrice: 0,
      weightedSum: 0,
    };
    prev.productCount += r.productCount;
    if (r.brand) prev.brands.add(r.brand);
    if (r.category) prev.categories.add(r.category);
    if (r.minPrice > 0 && r.minPrice < prev.minPrice) prev.minPrice = r.minPrice;
    if (r.maxPrice > prev.maxPrice) prev.maxPrice = r.maxPrice;
    prev.weightedSum += r.avgPrice * r.productCount;
    byMp.set(key, prev);
  }
  return [...byMp.entries()].map(([marketplace, v]) => ({
    marketplace,
    productCount: v.productCount,
    brandCount: v.brands.size,
    categoryCount: v.categories.size,
    minPrice: v.minPrice === Number.POSITIVE_INFINITY ? 0 : v.minPrice,
    maxPrice: v.maxPrice,
    avgPrice: v.productCount > 0 ? Math.round(v.weightedSum / v.productCount) : 0,
  }));
}
