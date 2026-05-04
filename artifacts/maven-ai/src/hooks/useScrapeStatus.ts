import { useQuery } from "@tanstack/react-query";

export interface ScrapeStatus {
  scheduler: {
    running: boolean;
    cronExpression: string;
  };
  scrapeInProgress: boolean;
  lastCompletedRun: {
    id: string;
    trigger: string;
    status: string;
    startedAt: string;
    completedAt: string;
    scrapedCounts: Record<string, number>;
    matchedProducts: number;
    matchedCompetitors: number;
    totalProducts: number;
    totalCompetitors: number;
  } | null;
  recentRuns: Array<{
    id: string;
    trigger: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  }>;
  products: {
    lastScraped: string | null;
    lastUpdated: string | null;
    autoScrapedCount: string;
    totalCount: string;
  } | null;
  competitors: {
    lastScraped: string | null;
    lastUpdated: string | null;
    autoScrapedCount: string;
    totalCount: string;
  } | null;
}

async function fetchScrapeStatus(): Promise<ScrapeStatus> {
  const res = await fetch("/api/arcelik/scrape-status");
  if (!res.ok) throw new Error("Failed to fetch scrape status");
  return res.json();
}

export function useScrapeStatus() {
  return useQuery<ScrapeStatus>({
    queryKey: ["arcelik", "scrape-status"],
    queryFn: fetchScrapeStatus,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
