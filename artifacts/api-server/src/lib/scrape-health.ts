import {
  db,
  arcelikScrapeLogsTable,
  type MarketplaceHealthAlert,
} from "@workspace/db";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { MARKETPLACE_SOURCES } from "./marketplace-sources";
import { logger } from "./logger";

export type { MarketplaceHealthAlert };

export interface ScrapeRunHealth {
  status: "healthy" | "unhealthy";
  alerts: MarketplaceHealthAlert[];
  thresholdFraction: number;
  baselineWindowDays: number;
  evaluatedMarketplaces: string[];
}

export interface HealthThresholdConfig {
  thresholdFraction: number;
  baselineWindowDays: number;
  minBaselineSamples: number;
  baselineRunLimit: number;
}

// Defaults are intentionally conservative: 50% of the rolling 7-day average,
// requiring at least two prior completed runs before we'll flag a "below
// baseline" alert. A run that returns 0 products is alerted as soon as ANY
// prior run had nonzero output, since silent zero is the regression we are
// most worried about (cf. task #124, the Trendyol incident).
export function loadHealthThresholdConfig(
  overrides?: Partial<HealthThresholdConfig>,
): HealthThresholdConfig {
  const env = (k: string) => process.env[k];
  const num = (raw: string | undefined, fallback: number) => {
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    thresholdFraction:
      overrides?.thresholdFraction ??
      num(env("SCRAPE_HEALTH_THRESHOLD_FRACTION"), 0.5),
    baselineWindowDays:
      overrides?.baselineWindowDays ??
      num(env("SCRAPE_HEALTH_WINDOW_DAYS"), 7),
    minBaselineSamples:
      overrides?.minBaselineSamples ??
      num(env("SCRAPE_HEALTH_MIN_SAMPLES"), 2),
    baselineRunLimit:
      overrides?.baselineRunLimit ??
      num(env("SCRAPE_HEALTH_BASELINE_LIMIT"), 30),
  };
}

/**
 * Evaluate one scrape run's per-marketplace counts against the historical
 * baseline derived from prior completed runs in the same rolling window.
 *
 * Pure-ish: reads from arcelik_scrape_logs but writes nothing. The caller
 * persists the returned alerts onto the run row.
 *
 * Marketplace-agnostic: iterates over MARKETPLACE_SOURCES so adding a new
 * marketplace requires no changes here. The list comes from the same
 * shared module the chat assistant already uses, so adding "hepsiburada"
 * later wires the alert through automatically.
 */
export async function evaluateScrapeRunHealth(
  currentCounts: Record<string, number>,
  options?: {
    excludeRunId?: string;
    config?: Partial<HealthThresholdConfig>;
    marketplaces?: readonly string[];
  },
): Promise<ScrapeRunHealth> {
  const cfg = loadHealthThresholdConfig(options?.config);
  const marketplaces = options?.marketplaces ?? MARKETPLACE_SOURCES;
  const since = new Date(
    Date.now() - cfg.baselineWindowDays * 24 * 60 * 60 * 1000,
  );

  const conditions = [
    eq(arcelikScrapeLogsTable.status, "completed"),
    gte(arcelikScrapeLogsTable.startedAt, since),
  ];
  if (options?.excludeRunId) {
    conditions.push(ne(arcelikScrapeLogsTable.id, options.excludeRunId));
  }

  const recent = await db
    .select({
      scrapedCounts: arcelikScrapeLogsTable.scrapedCounts,
    })
    .from(arcelikScrapeLogsTable)
    .where(and(...conditions))
    .orderBy(desc(arcelikScrapeLogsTable.startedAt))
    .limit(cfg.baselineRunLimit);

  const alerts: MarketplaceHealthAlert[] = [];
  for (const mp of marketplaces) {
    const samples: number[] = [];
    for (const row of recent) {
      const counts = row.scrapedCounts;
      if (!counts) continue;
      const v = counts[mp];
      if (typeof v === "number" && Number.isFinite(v)) samples.push(v);
    }
    const current = Number(currentCounts[mp] ?? 0);
    const maxSeen = samples.reduce((a, b) => Math.max(a, b), 0);

    // Silent-zero check: this run produced nothing, but at least one prior
    // run did. Fires even with a single historical sample so a brand-new
    // marketplace that breaks immediately still alerts.
    if (current === 0 && maxSeen > 0) {
      const baselineAvg =
        samples.length > 0
          ? samples.reduce((a, b) => a + b, 0) / samples.length
          : maxSeen;
      alerts.push({
        marketplace: mp,
        currentCount: 0,
        baselineAvg: Math.round(baselineAvg),
        baselineSamples: samples.length,
        dropPercent: 100,
        reason: "zero",
      });
      continue;
    }

    // Below-threshold check: needs enough history for the average to mean
    // something. Avoids flapping when we only have one prior sample.
    if (samples.length < cfg.minBaselineSamples) continue;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (avg <= 0) continue;
    if (current < avg * cfg.thresholdFraction) {
      alerts.push({
        marketplace: mp,
        currentCount: current,
        baselineAvg: Math.round(avg),
        baselineSamples: samples.length,
        dropPercent: Math.round((1 - current / avg) * 1000) / 10,
        reason: "below_threshold",
      });
    }
  }

  return {
    status: alerts.length > 0 ? "unhealthy" : "healthy",
    alerts,
    thresholdFraction: cfg.thresholdFraction,
    baselineWindowDays: cfg.baselineWindowDays,
    evaluatedMarketplaces: [...marketplaces],
  };
}

/**
 * Format a one-line summary suitable for logs and email subject lines.
 */
export function formatHealthSummary(health: ScrapeRunHealth): string {
  if (health.status === "healthy") {
    return `All ${health.evaluatedMarketplaces.length} marketplaces healthy (>= ${Math.round(health.thresholdFraction * 100)}% of ${health.baselineWindowDays}d baseline)`;
  }
  const parts = health.alerts.map((a) => {
    if (a.reason === "zero") {
      return `${a.marketplace}=0 (baseline ~${a.baselineAvg})`;
    }
    return `${a.marketplace}=${a.currentCount} (-${a.dropPercent}% vs baseline ${a.baselineAvg})`;
  });
  return `Marketplace scrape regression: ${parts.join(", ")}`;
}

export function logHealthEvaluation(
  runId: string,
  health: ScrapeRunHealth,
): void {
  if (health.status === "healthy") {
    logger.info(
      {
        runId,
        marketplaces: health.evaluatedMarketplaces,
        thresholdFraction: health.thresholdFraction,
      },
      "Scrape run health: OK",
    );
    return;
  }
  logger.error(
    {
      runId,
      alerts: health.alerts,
      thresholdFraction: health.thresholdFraction,
      baselineWindowDays: health.baselineWindowDays,
    },
    `SCRAPE_HEALTH_ALERT: ${formatHealthSummary(health)}`,
  );
}
