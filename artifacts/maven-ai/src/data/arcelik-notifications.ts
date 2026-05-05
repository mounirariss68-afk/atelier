import type { PriceHistoryRecord } from "@/hooks/usePriceHistory";
import type { ArcelikProduct, CompetitorPrice, ProductCategory } from "./arcelik-seed";

export const NOTIFICATION_THRESHOLD_PERCENT = 3;
export const CRITICAL_THRESHOLD_PERCENT = 10;
export const HIGH_THRESHOLD_PERCENT = 5;

export type NotificationSeverity = "critical" | "high" | "medium";
export type PriceDirection = "up" | "down";
export type NotificationRecordType = "product" | "competitor";

export interface NotificationNavTarget {
  brand: string;
  modelCode: string;
  recordType: NotificationRecordType;
  category: ProductCategory | null;
  /** Monotonic key so consumers can detect repeat clicks on the same target */
  nonce: number;
}

export interface PriceNotification {
  id: string;
  brand: string;
  modelCode: string;
  recordType: NotificationRecordType;
  category: ProductCategory | null;
  direction: PriceDirection;
  changePercent: number;
  newPrice: number;
  previousPrice: number | null;
  recordedAt: string;
  severity: NotificationSeverity;
  source: string;
}

interface BuildOptions {
  thresholdPercent?: number;
  maxItems?: number;
}

function severityFor(absChange: number): NotificationSeverity {
  if (absChange >= CRITICAL_THRESHOLD_PERCENT) return "critical";
  if (absChange >= HIGH_THRESHOLD_PERCENT) return "high";
  return "medium";
}

export function buildPriceNotifications(
  records: PriceHistoryRecord[] | undefined,
  products: ArcelikProduct[],
  competitorPrices: CompetitorPrice[],
  opts: BuildOptions = {},
): PriceNotification[] {
  if (!records || records.length === 0) return [];
  const threshold = opts.thresholdPercent ?? NOTIFICATION_THRESHOLD_PERCENT;
  const maxItems = opts.maxItems ?? 50;

  const productById = new Map(products.map((p) => [p.id, p] as const));
  const competitorById = new Map(competitorPrices.map((c) => [c.id, c] as const));
  // Products that have at least one competitor mapping — required for the
  // ProductComparisonView to render a row when the user navigates in.
  const productsWithCompetitors = new Set(
    competitorPrices
      .map((c) => c.arcelikEquivalentId)
      .filter((id): id is string => Boolean(id)),
  );

  const filtered = records
    .filter((r) => {
      if (r.priceChangePercent === null || r.previousPrice === null) return false;
      if (Math.abs(r.priceChangePercent) < threshold) return false;
      // For product notifications, only emit when the product exists in the
      // catalog AND has competitor mappings, so click-through lands on a
      // populated comparison view rather than an empty state.
      if (r.recordType === "product") {
        if (!productById.has(r.referenceId)) return false;
        if (!productsWithCompetitors.has(r.referenceId)) return false;
      } else {
        if (!competitorById.has(r.referenceId)) return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
    )
    .slice(0, maxItems);

  return filtered.map((r) => {
    const change = r.priceChangePercent as number;
    const absChange = Math.abs(change);
    const recordType: NotificationRecordType =
      r.recordType === "product" ? "product" : "competitor";

    let category: ProductCategory | null = null;
    let modelCode = r.modelCode;
    if (recordType === "product") {
      const p = productById.get(r.referenceId);
      if (p) {
        category = p.category;
        // Prefer the catalog's modelCode so search lookup matches reliably.
        modelCode = p.modelCode;
      }
    } else {
      const c = competitorById.get(r.referenceId);
      if (c) category = c.category;
    }

    return {
      id: `${r.referenceId}__${r.recordedAt}`,
      brand: r.brand,
      modelCode,
      recordType,
      category,
      direction: change >= 0 ? "up" : "down",
      changePercent: change,
      newPrice: r.price,
      previousPrice: r.previousPrice,
      recordedAt: r.recordedAt,
      severity: severityFor(absChange),
      source: r.source,
    };
  });
}

export function formatRelativeTime(iso: string, lang: "tr" | "en"): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (lang === "tr") {
    if (day >= 1) return `${day} gün önce`;
    if (hr >= 1) return `${hr} saat önce`;
    if (min >= 1) return `${min} dakika önce`;
    return "az önce";
  }
  if (day >= 1) return `${day}d ago`;
  if (hr >= 1) return `${hr}h ago`;
  if (min >= 1) return `${min}m ago`;
  return "just now";
}
