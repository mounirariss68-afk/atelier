import { Router, type IRouter } from "express";
import {
  db,
  arcelikProductsTable,
  arcelikCompetitorPricesTable,
  arcelikDataSourcesTable,
  arcelikCitiesTable,
  arcelikDealersTable,
  arcelikCampaignsTable,
  arcelikCalendarTable,
  arcelikKpiBenchmarksTable,
  arcelikPriceHistoryTable,
  arcelikScrapeLogsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { runPriceScrape, isScrapeRunning } from "../lib/scraper";
import { getSchedulerStatus } from "../lib/scheduler";

const router: IRouter = Router();

router.get("/products", async (_req, res) => {
  try {
    const { category, priceTier } = _req.query;
    let rows;
    if (category && priceTier) {
      rows = await db
        .select()
        .from(arcelikProductsTable)
        .where(
          and(
            eq(arcelikProductsTable.category, String(category)),
            eq(arcelikProductsTable.priceTier, String(priceTier)),
          ),
        );
    } else if (category) {
      rows = await db
        .select()
        .from(arcelikProductsTable)
        .where(eq(arcelikProductsTable.category, String(category)));
    } else if (priceTier) {
      rows = await db
        .select()
        .from(arcelikProductsTable)
        .where(eq(arcelikProductsTable.priceTier, String(priceTier)));
    } else {
      rows = await db.select().from(arcelikProductsTable);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.get("/competitor-prices", async (_req, res) => {
  try {
    const { brand, category } = _req.query;
    let rows;
    if (brand && category) {
      rows = await db
        .select()
        .from(arcelikCompetitorPricesTable)
        .where(
          and(
            eq(arcelikCompetitorPricesTable.brand, String(brand)),
            eq(arcelikCompetitorPricesTable.category, String(category)),
          ),
        );
    } else if (brand) {
      rows = await db
        .select()
        .from(arcelikCompetitorPricesTable)
        .where(eq(arcelikCompetitorPricesTable.brand, String(brand)));
    } else if (category) {
      rows = await db
        .select()
        .from(arcelikCompetitorPricesTable)
        .where(eq(arcelikCompetitorPricesTable.category, String(category)));
    } else {
      rows = await db.select().from(arcelikCompetitorPricesTable);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch competitor prices" });
  }
});

router.get("/cities", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikCitiesTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch cities" });
  }
});

router.get("/dealers", async (_req, res) => {
  try {
    const { city } = _req.query;
    let rows;
    if (city) {
      rows = await db
        .select()
        .from(arcelikDealersTable)
        .where(eq(arcelikDealersTable.city, String(city)));
    } else {
      rows = await db.select().from(arcelikDealersTable);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch dealers" });
  }
});

router.get("/campaigns", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikCampaignsTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

router.get("/calendar", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikCalendarTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch calendar" });
  }
});

router.get("/data-sources", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikDataSourcesTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch data sources" });
  }
});

router.get("/kpi-benchmarks", async (_req, res) => {
  try {
    const rows = await db.select().from(arcelikKpiBenchmarksTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch KPI benchmarks" });
  }
});

router.get("/price-history", async (_req, res) => {
  try {
    const { referenceId, brand, recordType, limit } = _req.query;
    const maxRows = Math.min(Number(limit) || 500, 2000);

    let query = db
      .select()
      .from(arcelikPriceHistoryTable)
      .orderBy(desc(arcelikPriceHistoryTable.recordedAt))
      .limit(maxRows);

    const conditions = [];
    if (referenceId) {
      conditions.push(
        eq(arcelikPriceHistoryTable.referenceId, String(referenceId)),
      );
    }
    if (brand) {
      conditions.push(eq(arcelikPriceHistoryTable.brand, String(brand)));
    }
    if (recordType) {
      conditions.push(
        eq(arcelikPriceHistoryTable.recordType, String(recordType)),
      );
    }

    if (conditions.length > 0) {
      query = query.where(
        conditions.length === 1 ? conditions[0] : and(...conditions),
      ) as typeof query;
    }

    const rows = await query;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch price history" });
  }
});

router.get("/price-history/summary", async (_req, res) => {
  try {
    const rows = await db
      .select({
        referenceId: arcelikPriceHistoryTable.referenceId,
        brand: arcelikPriceHistoryTable.brand,
        modelCode: arcelikPriceHistoryTable.modelCode,
        recordType: arcelikPriceHistoryTable.recordType,
        latestPrice: sql<number>`(array_agg(${arcelikPriceHistoryTable.price} ORDER BY ${arcelikPriceHistoryTable.recordedAt} DESC))[1]`,
        earliestPrice: sql<number>`(array_agg(${arcelikPriceHistoryTable.price} ORDER BY ${arcelikPriceHistoryTable.recordedAt} ASC))[1]`,
        minPrice: sql<number>`min(${arcelikPriceHistoryTable.price})`,
        maxPrice: sql<number>`max(${arcelikPriceHistoryTable.price})`,
        dataPoints: sql<number>`count(*)`,
        firstSeen: sql<string>`min(${arcelikPriceHistoryTable.recordedAt})`,
        lastSeen: sql<string>`max(${arcelikPriceHistoryTable.recordedAt})`,
      })
      .from(arcelikPriceHistoryTable)
      .groupBy(
        arcelikPriceHistoryTable.referenceId,
        arcelikPriceHistoryTable.brand,
        arcelikPriceHistoryTable.modelCode,
        arcelikPriceHistoryTable.recordType,
      );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch price history summary" });
  }
});

router.get("/scrape-status", async (_req, res) => {
  try {
    const recentLogs = await db
      .select()
      .from(arcelikScrapeLogsTable)
      .orderBy(desc(arcelikScrapeLogsTable.startedAt))
      .limit(10);

    const lastCompleted = recentLogs.find((l) => l.status === "completed");

    const productLastUpdated = await db
      .select({
        lastScraped: sql<string>`max(${arcelikProductsTable.scrapedAt})`,
        lastUpdated: sql<string>`max(${arcelikProductsTable.updatedAt})`,
        autoScrapedCount: sql<number>`count(*) filter (where ${arcelikProductsTable.dataProvenance} = 'auto-scraped')`,
        totalCount: sql<number>`count(*)`,
      })
      .from(arcelikProductsTable);

    const competitorLastUpdated = await db
      .select({
        lastScraped: sql<string>`max(${arcelikCompetitorPricesTable.scrapedAt})`,
        lastUpdated: sql<string>`max(${arcelikCompetitorPricesTable.updatedAt})`,
        autoScrapedCount: sql<number>`count(*) filter (where ${arcelikCompetitorPricesTable.dataProvenance} = 'auto-scraped')`,
        totalCount: sql<number>`count(*)`,
      })
      .from(arcelikCompetitorPricesTable);

    const scheduler = getSchedulerStatus();

    res.json({
      scheduler,
      scrapeInProgress: isScrapeRunning(),
      lastCompletedRun: lastCompleted ?? null,
      recentRuns: recentLogs,
      products: productLastUpdated[0] ?? null,
      competitors: competitorLastUpdated[0] ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch scrape status");
    res.status(500).json({ error: "Failed to fetch scrape status" });
  }
});

let lastManualScrapeTime = 0;
const MANUAL_SCRAPE_COOLDOWN_MS = 5 * 60 * 1000;

router.post("/scrape", async (_req, res) => {
  try {
    const now = Date.now();
    if (now - lastManualScrapeTime < MANUAL_SCRAPE_COOLDOWN_MS) {
      const waitSec = Math.ceil((MANUAL_SCRAPE_COOLDOWN_MS - (now - lastManualScrapeTime)) / 1000);
      res.status(429).json({ error: `Rate limited. Try again in ${waitSec}s` });
      return;
    }

    if (isScrapeRunning()) {
      res.status(409).json({ error: "A scrape job is already in progress" });
      return;
    }

    lastManualScrapeTime = now;
    res.json({ message: "Scrape job started", status: "running" });

    runPriceScrape("manual").catch((err) => {
      logger.error({ err }, "Manual scrape job failed");
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to start scrape job" });
  }
});

export default router;
