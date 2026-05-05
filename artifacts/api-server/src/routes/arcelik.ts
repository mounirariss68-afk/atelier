import { Router, type IRouter, type Request, type Response } from "express";
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
  arcelikMarketplacePricesTable,
  arcelikMarketplacePriceHistoryTable,
  arcelikProductEquivalencesTable,
  arcelikProductSpecsTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { runPriceScrape, isScrapeRunning } from "../lib/scraper";
import { getSchedulerStatus } from "../lib/scheduler";
import {
  runCompetitiveResponseAgent,
  runPriceElasticityAgent,
  runCannibalizationAgent,
  runDealerOptimizationAgent,
  runAllAgents,
  type AgentType,
} from "../lib/agents";

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

// GET /competitor-prices
//   Returns brand-site competitor price snapshots (one row per
//   competitor SKU). Filters: ?brand, ?category.
//   ?includeMarketplace=true augments each row with a
//   `marketplaceObservations` array containing every marketplace
//   listing currently linked to the same Arçelik product
//   (joined via arcelikEquivalentId↔arcelikProductId).
//   Semantics: PRODUCT-CENTRIC, not brand-scoped — the augmented
//   observations may include other competitor brands so long as
//   they map to the same Arçelik catalog SKU.
router.get("/competitor-prices", async (_req, res) => {
  try {
    const { brand, category, includeMarketplace } = _req.query;
    const conditions = [];
    if (brand) conditions.push(eq(arcelikCompetitorPricesTable.brand, String(brand)));
    if (category) conditions.push(eq(arcelikCompetitorPricesTable.category, String(category)));
    const baseQuery = db.select().from(arcelikCompetitorPricesTable);
    const rows = conditions.length
      ? await baseQuery.where(and(...conditions))
      : await baseQuery;

    if (String(includeMarketplace).toLowerCase() === "true") {
      const productIds = Array.from(
        new Set(
          rows
            .map((r) => r.arcelikEquivalentId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const mpByProductId = new Map<
        string,
        Array<{
          marketplace: string;
          brand: string;
          title: string;
          price: number;
          sourceUrl: string;
          matchConfidence: number | null;
          scrapedAt: Date;
        }>
      >();
      if (productIds.length > 0) {
        const mpRows = await db
          .select({
            arcelikProductId: arcelikMarketplacePricesTable.arcelikProductId,
            marketplace: arcelikMarketplacePricesTable.marketplace,
            brand: arcelikMarketplacePricesTable.brand,
            title: arcelikMarketplacePricesTable.title,
            price: arcelikMarketplacePricesTable.price,
            sourceUrl: arcelikMarketplacePricesTable.productUrl,
            matchConfidence: arcelikMarketplacePricesTable.matchConfidence,
            scrapedAt: arcelikMarketplacePricesTable.scrapedAt,
          })
          .from(arcelikMarketplacePricesTable)
          .where(inArray(arcelikMarketplacePricesTable.arcelikProductId, productIds));
        for (const r of mpRows) {
          if (!r.arcelikProductId) continue;
          const arr = mpByProductId.get(r.arcelikProductId) ?? [];
          arr.push({
            marketplace: r.marketplace,
            brand: r.brand,
            title: r.title,
            price: r.price,
            sourceUrl: r.sourceUrl,
            matchConfidence: r.matchConfidence,
            scrapedAt: r.scrapedAt,
          });
          mpByProductId.set(r.arcelikProductId, arr);
        }
      }
      const enriched = rows.map((row) => ({
        ...row,
        marketplaceObservations: row.arcelikEquivalentId
          ? mpByProductId.get(row.arcelikEquivalentId) ?? []
          : [],
      }));
      res.json(enriched);
      return;
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

router.get("/marketplace-prices", async (_req, res) => {
  try {
    const { brand, category, marketplace, arcelikProductId, limit } =
      _req.query;
    const maxRows = Math.min(Number(limit) || 500, 5000);
    const conditions = [];
    if (brand) conditions.push(eq(arcelikMarketplacePricesTable.brand, String(brand)));
    if (category)
      conditions.push(
        eq(arcelikMarketplacePricesTable.category, String(category)),
      );
    if (marketplace)
      conditions.push(
        eq(arcelikMarketplacePricesTable.marketplace, String(marketplace)),
      );
    if (arcelikProductId)
      conditions.push(
        eq(
          arcelikMarketplacePricesTable.arcelikProductId,
          String(arcelikProductId),
        ),
      );

    let query = db
      .select()
      .from(arcelikMarketplacePricesTable)
      .orderBy(desc(arcelikMarketplacePricesTable.scrapedAt))
      .limit(maxRows);

    if (conditions.length > 0) {
      query = query.where(
        conditions.length === 1 ? conditions[0] : and(...conditions),
      ) as typeof query;
    }

    const rows = await query;
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch marketplace prices");
    res.status(500).json({ error: "Failed to fetch marketplace prices" });
  }
});

router.get("/coverage", async (_req, res) => {
  try {
    const sinceDays = Math.min(Number(_req.query.sinceDays) || 14, 90);
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * sinceDays);

    const [byMarketplaceCategory, specsBySource, equivalencesBySource, scrapeRuns] =
      await Promise.all([
        db
          .select({
            marketplace: arcelikMarketplacePricesTable.marketplace,
            category: arcelikMarketplacePricesTable.category,
            skuCount: sql<number>`count(distinct ${arcelikMarketplacePricesTable.marketplaceProductId})::int`,
            linkedCount: sql<number>`count(distinct ${arcelikMarketplacePricesTable.marketplaceProductId}) filter (where ${arcelikMarketplacePricesTable.arcelikProductId} is not null)::int`,
            avgPrice: sql<number>`round(avg(${arcelikMarketplacePricesTable.price}))::int`,
          })
          .from(arcelikMarketplacePricesTable)
          .where(gte(arcelikMarketplacePricesTable.scrapedAt, since))
          .groupBy(
            arcelikMarketplacePricesTable.marketplace,
            arcelikMarketplacePricesTable.category,
          ),
        db
          .select({
            marketplace: arcelikProductSpecsTable.marketplace,
            specCount: sql<number>`count(*)::int`,
          })
          .from(arcelikProductSpecsTable)
          .groupBy(arcelikProductSpecsTable.marketplace),
        db
          .select({
            source: arcelikProductEquivalencesTable.source,
            count: sql<number>`count(*)::int`,
            avgConfidence: sql<number>`round(avg(${arcelikProductEquivalencesTable.matchConfidence})::numeric, 3)::float`,
          })
          .from(arcelikProductEquivalencesTable)
          .groupBy(arcelikProductEquivalencesTable.source),
        db
          .select({
            runId: arcelikScrapeLogsTable.id,
            startedAt: arcelikScrapeLogsTable.startedAt,
            status: arcelikScrapeLogsTable.status,
            scrapedCounts: arcelikScrapeLogsTable.scrapedCounts,
          })
          .from(arcelikScrapeLogsTable)
          .where(gte(arcelikScrapeLogsTable.startedAt, since))
          .orderBy(desc(arcelikScrapeLogsTable.startedAt))
          .limit(20),
      ]);

    // Collapse "n11/run-123" → "n11".
    const equivByMarketplace: Record<
      string,
      { count: number; avgConfidence: number }
    > = {};
    for (const r of equivalencesBySource) {
      const mp = String(r.source).split("/")[0];
      const prev = equivByMarketplace[mp] ?? { count: 0, avgConfidence: 0 };
      const newCount = prev.count + r.count;
      const newAvg =
        (prev.avgConfidence * prev.count + r.avgConfidence * r.count) /
        Math.max(1, newCount);
      equivByMarketplace[mp] = {
        count: newCount,
        avgConfidence: Math.round(newAvg * 1000) / 1000,
      };
    }

    const byMarketplace: Record<string, { totalSkus: number; linkedSkus: number; categories: number }> = {};
    for (const r of byMarketplaceCategory) {
      const mp = String(r.marketplace);
      const prev = byMarketplace[mp] ?? { totalSkus: 0, linkedSkus: 0, categories: 0 };
      byMarketplace[mp] = {
        totalSkus: prev.totalSkus + r.skuCount,
        linkedSkus: prev.linkedSkus + r.linkedCount,
        categories: prev.categories + 1,
      };
    }

    res.json({
      windowDays: sinceDays,
      generatedAt: new Date().toISOString(),
      byMarketplace,
      byMarketplaceCategory,
      specsByMarketplace: specsBySource,
      equivalencesByMarketplace: equivByMarketplace,
      recentRuns: scrapeRuns,
    });
  } catch (err) {
    logger.error({ err }, "Failed to compute coverage report");
    res.status(500).json({ error: "Failed to compute coverage report" });
  }
});

router.get("/marketplace-prices/history", async (_req, res) => {
  try {
    const { marketplace, marketplaceProductId, brand, sinceDays, limit } =
      _req.query;
    const days = Math.min(Number(sinceDays) || 30, 365);
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * days);
    const maxRows = Math.min(Number(limit) || 1000, 10000);

    const conditions = [gte(arcelikMarketplacePriceHistoryTable.recordedAt, since)];
    if (marketplace)
      conditions.push(
        eq(arcelikMarketplacePriceHistoryTable.marketplace, String(marketplace)),
      );
    if (marketplaceProductId)
      conditions.push(
        eq(
          arcelikMarketplacePriceHistoryTable.marketplaceProductId,
          String(marketplaceProductId),
        ),
      );
    if (brand)
      conditions.push(
        eq(arcelikMarketplacePriceHistoryTable.brand, String(brand)),
      );

    const rows = await db
      .select()
      .from(arcelikMarketplacePriceHistoryTable)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(arcelikMarketplacePriceHistoryTable.recordedAt))
      .limit(maxRows);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch marketplace price history");
    res.status(500).json({ error: "Failed to fetch marketplace price history" });
  }
});

router.get("/marketplace-prices/summary", async (_req, res) => {
  try {
    const recentSince = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14);
    const rows = await db
      .select({
        marketplace: arcelikMarketplacePricesTable.marketplace,
        brand: arcelikMarketplacePricesTable.brand,
        category: arcelikMarketplacePricesTable.category,
        productCount: sql<number>`count(*)`,
        minPrice: sql<number>`min(${arcelikMarketplacePricesTable.price})`,
        maxPrice: sql<number>`max(${arcelikMarketplacePricesTable.price})`,
        avgPrice: sql<number>`round(avg(${arcelikMarketplacePricesTable.price}))`,
      })
      .from(arcelikMarketplacePricesTable)
      .where(gte(arcelikMarketplacePricesTable.scrapedAt, recentSince))
      .groupBy(
        arcelikMarketplacePricesTable.marketplace,
        arcelikMarketplacePricesTable.brand,
        arcelikMarketplacePricesTable.category,
      );
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch marketplace summary");
    res.status(500).json({ error: "Failed to fetch marketplace summary" });
  }
});

router.get("/equivalences", async (_req, res) => {
  try {
    const { arcelikProductId, brand, minConfidence, limit } = _req.query;
    const maxRows = Math.min(Number(limit) || 500, 5000);
    const minConf = Number(minConfidence);

    const conditions = [];
    if (arcelikProductId)
      conditions.push(
        eq(
          arcelikProductEquivalencesTable.arcelikProductId,
          String(arcelikProductId),
        ),
      );
    if (brand)
      conditions.push(
        eq(arcelikProductEquivalencesTable.competitorBrand, String(brand)),
      );
    if (Number.isFinite(minConf))
      conditions.push(
        gte(arcelikProductEquivalencesTable.matchConfidence, minConf),
      );

    let query = db
      .select()
      .from(arcelikProductEquivalencesTable)
      .orderBy(desc(arcelikProductEquivalencesTable.matchConfidence))
      .limit(maxRows);

    if (conditions.length > 0) {
      query = query.where(
        conditions.length === 1 ? conditions[0] : and(...conditions),
      ) as typeof query;
    }

    const rows = await query;
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch equivalences");
    res.status(500).json({ error: "Failed to fetch equivalences" });
  }
});

// Structured specs scraped from marketplace PDPs (Tüm Özellikler). Filter by
// marketplace product id when provided; otherwise return the most recent
// extractions. Used by the comparison view to show side-by-side spec tables.
router.get("/product-specs", async (_req, res) => {
  try {
    const { marketplace, marketplaceProductId, limit } = _req.query;
    const maxRows = Math.min(Number(limit) || 200, 2000);
    const conditions = [];
    if (marketplace)
      conditions.push(
        eq(arcelikProductSpecsTable.marketplace, String(marketplace)),
      );
    if (marketplaceProductId)
      conditions.push(
        eq(
          arcelikProductSpecsTable.marketplaceProductId,
          String(marketplaceProductId),
        ),
      );
    let query = db
      .select()
      .from(arcelikProductSpecsTable)
      .orderBy(desc(arcelikProductSpecsTable.extractedAt))
      .limit(maxRows);
    if (conditions.length > 0) {
      query = query.where(
        conditions.length === 1 ? conditions[0] : and(...conditions),
      ) as typeof query;
    }
    const rows = await query;
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch product specs");
    res.status(500).json({ error: "Failed to fetch product specs" });
  }
});

// Multi-source aggregated competitor pricing. Combines hardcoded competitor
// prices (from brand-site scrapers like Bosch/Vestel/Samsung) with marketplace
// observations (n11 + trendyol) keyed by arcelik product, computing best/avg/
// range across sources and a per-source breakdown.
// GET /competitor-prices/multi-source
//   Per Arçelik product, aggregates pricing observations across
//   ALL sources (brand-site competitor scrapes + every marketplace
//   linked via the equivalence engine). Filters: ?arcelikProductId,
//   ?brand, ?category.
//   Semantics: PRODUCT-CENTRIC. Each result group is keyed by
//   Arçelik product and may contain observations from multiple
//   competitor brands. Returns {bestPrice, avgPrice,
//   priceRange{min,max,spreadPct}, perSource[{source,count,
//   bestPrice,avgPrice}], observations[]}.
router.get("/competitor-prices/multi-source", async (_req, res) => {
  try {
    const { arcelikProductId, brand, category } = _req.query;

    const competitorConditions = [];
    if (brand)
      competitorConditions.push(
        eq(arcelikCompetitorPricesTable.brand, String(brand)),
      );
    if (category)
      competitorConditions.push(
        eq(arcelikCompetitorPricesTable.category, String(category)),
      );
    if (arcelikProductId)
      competitorConditions.push(
        eq(
          arcelikCompetitorPricesTable.arcelikEquivalentId,
          String(arcelikProductId),
        ),
      );
    const competitorBaseQuery = db
      .select()
      .from(arcelikCompetitorPricesTable);
    const competitorRows =
      competitorConditions.length === 0
        ? await competitorBaseQuery
        : await competitorBaseQuery.where(
            competitorConditions.length === 1
              ? competitorConditions[0]
              : and(...competitorConditions),
          );

    // Marketplace prices joined with their algorithmic Arçelik link
    const marketplaceConditions = [];
    if (brand)
      marketplaceConditions.push(
        eq(arcelikMarketplacePricesTable.brand, String(brand)),
      );
    if (category)
      marketplaceConditions.push(
        eq(arcelikMarketplacePricesTable.category, String(category)),
      );
    if (arcelikProductId)
      marketplaceConditions.push(
        eq(
          arcelikMarketplacePricesTable.arcelikProductId,
          String(arcelikProductId),
        ),
      );
    const marketplaceBaseQuery = db
      .select()
      .from(arcelikMarketplacePricesTable);
    const marketplaceRows =
      marketplaceConditions.length === 0
        ? await marketplaceBaseQuery
        : await marketplaceBaseQuery.where(
            marketplaceConditions.length === 1
              ? marketplaceConditions[0]
              : and(...marketplaceConditions),
          );

    // Group by arcelikProductId (or by competitor brand+model when no product link)
    type Observation = {
      source: string;
      sourceType: "brand-site" | "marketplace";
      brand: string;
      model: string;
      price: number;
      url?: string;
      scrapedAt?: string;
    };
    const buckets = new Map<
      string,
      { arcelikProductId: string | null; observations: Observation[] }
    >();

    const keyFor = (productId: string | null, brand: string, model: string) =>
      productId ? `p:${productId}` : `m:${brand}:${model}`;

    for (const cp of competitorRows) {
      const k = keyFor(cp.arcelikEquivalentId, cp.brand, cp.competitorModel);
      const bucket = buckets.get(k) ?? {
        arcelikProductId: cp.arcelikEquivalentId,
        observations: [],
      };
      bucket.observations.push({
        source: "brand-site",
        sourceType: "brand-site",
        brand: cp.brand,
        model: cp.competitorModel,
        price: cp.competitorPrice,
        scrapedAt: cp.scrapedAt ?? undefined,
      });
      buckets.set(k, bucket);
    }
    for (const mp of marketplaceRows) {
      const k = keyFor(mp.arcelikProductId, mp.brand, mp.title);
      const bucket = buckets.get(k) ?? {
        arcelikProductId: mp.arcelikProductId,
        observations: [],
      };
      bucket.observations.push({
        source: mp.marketplace,
        sourceType: "marketplace",
        brand: mp.brand,
        model: mp.title,
        price: mp.price,
        url: mp.productUrl,
        scrapedAt: mp.scrapedAt?.toISOString?.() ?? String(mp.scrapedAt),
      });
      buckets.set(k, bucket);
    }

    const aggregated = Array.from(buckets.entries()).map(([key, b]) => {
      const prices = b.observations.map((o) => o.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const avgPrice = Math.round(prices.reduce((s, n) => s + n, 0) / prices.length);
      const bySource: Record<string, number[]> = {};
      for (const o of b.observations) {
        (bySource[o.source] ??= []).push(o.price);
      }
      const perSource = Object.entries(bySource).map(([source, ps]) => ({
        source,
        count: ps.length,
        bestPrice: Math.min(...ps),
        avgPrice: Math.round(ps.reduce((s, n) => s + n, 0) / ps.length),
      }));
      return {
        key,
        arcelikProductId: b.arcelikProductId,
        sourceCount: Object.keys(bySource).length,
        observationCount: b.observations.length,
        bestPrice: minPrice,
        avgPrice,
        priceRange: { min: minPrice, max: maxPrice, spreadPct: minPrice > 0 ? Math.round(((maxPrice - minPrice) / minPrice) * 100) : 0 },
        perSource,
        observations: b.observations,
      };
    });

    aggregated.sort((a, b) => b.sourceCount - a.sourceCount || b.observationCount - a.observationCount);

    res.json({
      total: aggregated.length,
      groups: aggregated.slice(0, 500),
    });
  } catch (err) {
    logger.error({ err }, "Failed to compute multi-source aggregation");
    res.status(500).json({ error: "Failed to compute multi-source aggregation" });
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

// ---------- AI Agent endpoints ----------
// In-memory rate limit per-IP for agent endpoints (prevents abuse of LLM tokens).
const agentRateBuckets = new Map<string, number[]>();
const AGENT_RATE_MAX = 10;
const AGENT_RATE_WINDOW_MS = 60_000;

function agentRateLimitOk(ip: string): boolean {
  const now = Date.now();
  const bucket = (agentRateBuckets.get(ip) ?? []).filter((t) => now - t < AGENT_RATE_WINDOW_MS);
  if (bucket.length >= AGENT_RATE_MAX) {
    agentRateBuckets.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  agentRateBuckets.set(ip, bucket);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of agentRateBuckets) {
    const fresh = bucket.filter((t) => now - t < AGENT_RATE_WINDOW_MS);
    if (fresh.length === 0) agentRateBuckets.delete(ip);
    else agentRateBuckets.set(ip, fresh);
  }
}, AGENT_RATE_WINDOW_MS).unref?.();

function parseAgentOpts(req: Request): { language: "tr" | "en"; forceBaseline: boolean } {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const langRaw = body["language"] ?? req.query["language"];
  const language: "tr" | "en" = langRaw === "en" ? "en" : "tr";
  const fbRaw = body["forceBaseline"] ?? req.query["forceBaseline"];
  const forceBaseline = fbRaw === true || fbRaw === "true" || fbRaw === 1 || fbRaw === "1";
  return { language, forceBaseline };
}

const AGENT_RUNNERS: Record<
  AgentType,
  (opts: { language: "tr" | "en"; forceBaseline: boolean }) => ReturnType<typeof runCompetitiveResponseAgent>
> = {
  "competitive-response": runCompetitiveResponseAgent,
  "price-elasticity": runPriceElasticityAgent,
  "cannibalization": runCannibalizationAgent,
  "dealer-optimization": runDealerOptimizationAgent,
};

function makeAgentHandler(agentType: AgentType) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const ip = req.ip ?? "anon";
      if (!agentRateLimitOk(ip)) {
        res.status(429).json({ error: "Rate limited. Try again in a minute." });
        return;
      }
      const opts = parseAgentOpts(req);
      const result = await AGENT_RUNNERS[agentType](opts);
      res.json(result);
    } catch (err) {
      logger.error({ err, agentType }, "Agent endpoint failed");
      res.status(500).json({ error: `Agent ${agentType} failed` });
    }
  };
}

router.post("/agent/competitive-response", makeAgentHandler("competitive-response"));
router.post("/agent/price-elasticity", makeAgentHandler("price-elasticity"));
router.post("/agent/cannibalization", makeAgentHandler("cannibalization"));
router.post("/agent/dealer-optimization", makeAgentHandler("dealer-optimization"));

router.post("/agent/run-all", async (req, res) => {
  try {
    const ip = req.ip ?? "anon";
    if (!agentRateLimitOk(ip)) {
      res.status(429).json({ error: "Rate limited. Try again in a minute." });
      return;
    }
    const opts = parseAgentOpts(req);
    const results = await runAllAgents(opts);
    res.json({
      generatedAt: new Date().toISOString(),
      language: opts.language,
      results,
    });
  } catch (err) {
    logger.error({ err }, "Agent run-all failed");
    res.status(500).json({ error: "Agent run-all failed" });
  }
});

export default router;
