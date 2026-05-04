import * as cheerio from "cheerio";
import {
  db,
  arcelikProductsTable,
  arcelikCompetitorPricesTable,
  arcelikPriceHistoryTable,
  arcelikScrapeLogsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

interface ScrapedPrice {
  modelCode: string;
  name: string;
  price: number;
  sourceUrl: string;
  scrapedAt: string;
}

function parseTurkishPrice(raw: string): number | null {
  const cleaned = raw
    .replace(/[^\d.,]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function scrapeArcelik(): Promise<ScrapedPrice[]> {
  const categories = [
    "buzdolabi",
    "camasir-makinesi",
    "bulasik-makinesi",
    "ankastre-firinlar",
    "klima",
  ];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.arcelik.com.tr/${cat}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $("[data-product-id], .product-card, .product-item").each((_, el) => {
      const name = $(el)
        .find(".product-name, .product-title, h3, h2")
        .first()
        .text()
        .trim();
      const priceText = $(el)
        .find(".product-price, .price, [data-price]")
        .first()
        .text()
        .trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        const modelMatch = name.match(
          /\b(\d{3,5}\s*[A-Z]{1,4}(?:\s+\w+)?)\b/,
        );
        results.push({
          modelCode: modelMatch ? modelMatch[1].trim() : name.slice(0, 30),
          name,
          price,
          sourceUrl: `https://www.arcelik.com.tr/${cat}`,
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  }
  return results;
}

async function scrapeBeko(): Promise<ScrapedPrice[]> {
  const categories = ["buzdolabi", "camasir-makinesi", "bulasik-makinesi"];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.beko.com.tr/${cat}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $("[data-product], .product-card, .product-tile").each((_, el) => {
      const name = $(el)
        .find(".product-name, .product-title, h3")
        .first()
        .text()
        .trim();
      const priceText = $(el)
        .find(".product-price, .price, .sale-price")
        .first()
        .text()
        .trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        results.push({
          modelCode:
            name.split(" ").slice(1, 4).join(" ").trim() || name.slice(0, 20),
          name,
          price,
          sourceUrl: `https://www.beko.com.tr/${cat}`,
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  }
  return results;
}

async function scrapeVestel(): Promise<ScrapedPrice[]> {
  const categories = [
    "beyaz-esya/buzdolabi",
    "beyaz-esya/camasir-makinesi",
    "beyaz-esya/bulasik-makinesi",
  ];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.vestel.com.tr/${cat}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $(".product-card, .product-item, [data-product-id]").each((_, el) => {
      const name = $(el)
        .find(".product-name, .product-title, h3")
        .first()
        .text()
        .trim();
      const priceText = $(el)
        .find(".product-price, .price, .current-price")
        .first()
        .text()
        .trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        results.push({
          modelCode:
            name.split(" ").slice(1, 3).join(" ").trim() || name.slice(0, 20),
          name,
          price,
          sourceUrl: `https://www.vestel.com.tr/${cat}`,
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  }
  return results;
}

async function scrapeBosch(): Promise<ScrapedPrice[]> {
  const categories = [
    "urun-listeleme/buzdolaplari",
    "urun-listeleme/camasir-makineleri",
    "urun-listeleme/bulasik-makineleri",
  ];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.bosch-home.com.tr/${cat}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $(".product-tile, .product-card, [data-product]").each((_, el) => {
      const name = $(el)
        .find(".product-name, .product-title, h3")
        .first()
        .text()
        .trim();
      const priceText = $(el)
        .find(".product-price, .price, .current-price")
        .first()
        .text()
        .trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        results.push({
          modelCode:
            name.split(" ").slice(0, 3).join(" ").trim() || name.slice(0, 20),
          name,
          price,
          sourceUrl: `https://www.bosch-home.com.tr/${cat}`,
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  }
  return results;
}

async function scrapeSamsung(): Promise<ScrapedPrice[]> {
  const categories = [
    "home-appliances/refrigerators/all-refrigerators",
    "home-appliances/washing-machines/all-washing-machines",
    "home-appliances/dishwashers/all-dishwashers",
  ];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.samsung.com/tr/${cat}/`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $(".product-card, [data-product-id], .product-card__item").each(
      (_, el) => {
        const name = $(el)
          .find(".product-card__name, .product-title, h3")
          .first()
          .text()
          .trim();
        const priceText = $(el)
          .find(".product-card__price, .price, [data-price]")
          .first()
          .text()
          .trim();
        const price = parseTurkishPrice(priceText);
        if (name && price && price > 1000) {
          results.push({
            modelCode:
              name.split(" ").slice(0, 3).join(" ").trim() ||
              name.slice(0, 20),
            name,
            price,
            sourceUrl: `https://www.samsung.com/tr/${cat}/`,
            scrapedAt: new Date().toISOString(),
          });
        }
      },
    );
  }
  return results;
}

type ScraperResults = {
  arcelik: ScrapedPrice[];
  beko: ScrapedPrice[];
  vestel: ScrapedPrice[];
  bosch: ScrapedPrice[];
  samsung: ScrapedPrice[];
};

async function runScrapers(): Promise<ScraperResults> {
  const scrapers = [
    { name: "arcelik.com.tr", fn: scrapeArcelik },
    { name: "beko.com.tr", fn: scrapeBeko },
    { name: "vestel.com.tr", fn: scrapeVestel },
    { name: "bosch-home.com.tr", fn: scrapeBosch },
    { name: "samsung.com/tr", fn: scrapeSamsung },
  ] as const;

  const results: ScraperResults = {
    arcelik: [],
    beko: [],
    vestel: [],
    bosch: [],
    samsung: [],
  };
  const keys = ["arcelik", "beko", "vestel", "bosch", "samsung"] as const;

  for (let i = 0; i < scrapers.length; i++) {
    const s = scrapers[i];
    logger.info(`Scraping ${s.name}...`);
    try {
      const scraped = await s.fn();
      results[keys[i]] = scraped;
      logger.info(`${s.name}: ${scraped.length} products found`);
    } catch (err) {
      logger.error(
        { err },
        `${s.name}: scrape failed`,
      );
    }
  }
  return results;
}

export interface ScrapeRunResult {
  runId: string;
  status: "completed" | "failed";
  trigger: "scheduled" | "manual";
  startedAt: string;
  completedAt: string;
  scrapedCounts: Record<string, number>;
  matchedProducts: number;
  matchedCompetitors: number;
  totalProducts: number;
  totalCompetitors: number;
  priceChanges: number;
  errorMessage?: string;
}

let scrapeInProgress = false;

export function isScrapeRunning(): boolean {
  return scrapeInProgress;
}

export async function runPriceScrape(
  trigger: "scheduled" | "manual",
): Promise<ScrapeRunResult> {
  if (scrapeInProgress) {
    throw new Error("A scrape job is already in progress");
  }

  scrapeInProgress = true;
  const runId = `scrape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();

  try {
    await db.insert(arcelikScrapeLogsTable).values({
      id: runId,
      trigger,
      status: "running",
      startedAt,
    });
    const scraped = await runScrapers();
    const scrapedCounts: Record<string, number> = {};
    for (const [key, arr] of Object.entries(scraped)) {
      scrapedCounts[key] = arr.length;
    }

    const totalScraped = Object.values(scrapedCounts).reduce(
      (s, n) => s + n,
      0,
    );
    logger.info({ totalScraped, scrapedCounts }, "Scrape completed, matching prices...");

    const existingProducts = await db
      .select()
      .from(arcelikProductsTable);
    const existingCompetitors = await db
      .select()
      .from(arcelikCompetitorPricesTable);

    const today = new Date().toISOString().split("T")[0];
    let matchedProducts = 0;
    let matchedCompetitors = 0;
    let priceChanges = 0;

    const arcelikMap = new Map(
      scraped.arcelik.map((s) => [
        s.modelCode.toLowerCase().replace(/\s+/g, ""),
        s,
      ]),
    );
    const bekoMap = new Map(
      scraped.beko.map((s) => [
        s.modelCode.toLowerCase().replace(/\s+/g, ""),
        s,
      ]),
    );

    for (const p of existingProducts) {
      const key = p.modelCode.toLowerCase().replace(/\s+/g, "");
      const match = arcelikMap.get(key) ?? bekoMap.get(key);
      if (!match) continue;

      matchedProducts++;
      const previousPrice = p.tsfPrice;
      const newPrice = match.price;
      const changePercent =
        previousPrice > 0
          ? Math.round(((newPrice - previousPrice) / previousPrice) * 10000) /
            100
          : null;

      if (previousPrice !== newPrice) {
        priceChanges++;
      }

      await db.insert(arcelikPriceHistoryTable).values({
        recordType: "product",
        referenceId: p.id,
        brand: "Arçelik",
        modelCode: p.modelCode,
        price: newPrice,
        previousPrice,
        priceChangePercent: changePercent,
        source: match.sourceUrl,
        scrapeRunId: runId,
      });

      await db
        .update(arcelikProductsTable)
        .set({
          tsfPrice: newPrice,
          dealerCost: Math.round(newPrice * (1 - p.marginPercent / 100)),
          priceDate: today,
          dataProvenance: "auto-scraped",
          scrapedAt: match.scrapedAt,
          updatedAt: new Date(),
        })
        .where(eq(arcelikProductsTable.id, p.id));
    }

    const vestelMap = new Map(
      scraped.vestel.map((s) => [
        s.modelCode.toLowerCase().replace(/\s+/g, ""),
        s,
      ]),
    );
    const boschMap = new Map(
      scraped.bosch.map((s) => [
        s.modelCode.toLowerCase().replace(/\s+/g, ""),
        s,
      ]),
    );
    const samsungMap = new Map(
      scraped.samsung.map((s) => [
        s.modelCode.toLowerCase().replace(/\s+/g, ""),
        s,
      ]),
    );

    const productPriceMap = new Map(
      existingProducts.map((p) => [p.id, p.tsfPrice]),
    );

    for (const cp of existingCompetitors) {
      const key = cp.competitorModel
        .split(" ")
        .slice(0, 2)
        .join("")
        .toLowerCase();
      let match: ScrapedPrice | undefined;
      if (cp.brand === "Vestel" || cp.brand === "Regal")
        match = vestelMap.get(key);
      else if (
        cp.brand === "Bosch" ||
        cp.brand === "Siemens" ||
        cp.brand === "Profilo"
      )
        match = boschMap.get(key);
      else if (cp.brand === "Samsung") match = samsungMap.get(key);

      if (!match) continue;

      matchedCompetitors++;
      const previousPrice = cp.competitorPrice;
      const newPrice = match.price;
      const changePercent =
        previousPrice > 0
          ? Math.round(((newPrice - previousPrice) / previousPrice) * 10000) /
            100
          : null;

      if (previousPrice !== newPrice) {
        priceChanges++;
      }

      await db.insert(arcelikPriceHistoryTable).values({
        recordType: "competitor",
        referenceId: cp.id,
        brand: cp.brand,
        modelCode: cp.competitorModel,
        price: newPrice,
        previousPrice,
        priceChangePercent: changePercent,
        source: match.sourceUrl,
        scrapeRunId: runId,
      });

      const arcelikPrice = productPriceMap.get(cp.arcelikEquivalentId);
      const priceDelta =
        arcelikPrice && arcelikPrice > 0
          ? Math.round(((newPrice - arcelikPrice) / arcelikPrice) * 100)
          : cp.priceDeltaPercent;

      await db
        .update(arcelikCompetitorPricesTable)
        .set({
          competitorPrice: newPrice,
          priceDeltaPercent: priceDelta,
          priceDate: today,
          dataProvenance: "auto-scraped",
          scrapedAt: match.scrapedAt,
          updatedAt: new Date(),
        })
        .where(eq(arcelikCompetitorPricesTable.id, cp.id));
    }

    const completedAt = new Date();

    await db
      .update(arcelikScrapeLogsTable)
      .set({
        status: "completed",
        completedAt,
        scrapedCounts,
        matchedProducts,
        matchedCompetitors,
        totalProducts: existingProducts.length,
        totalCompetitors: existingCompetitors.length,
      })
      .where(eq(arcelikScrapeLogsTable.id, runId));

    logger.info(
      {
        runId,
        matchedProducts,
        matchedCompetitors,
        priceChanges,
        totalScraped,
      },
      "Price scrape completed successfully",
    );

    return {
      runId,
      status: "completed",
      trigger,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      scrapedCounts,
      matchedProducts,
      matchedCompetitors,
      totalProducts: existingProducts.length,
      totalCompetitors: existingCompetitors.length,
      priceChanges,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";

    await db
      .update(arcelikScrapeLogsTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage,
      })
      .where(eq(arcelikScrapeLogsTable.id, runId));

    logger.error({ err, runId }, "Price scrape failed");

    return {
      runId,
      status: "failed",
      trigger,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      scrapedCounts: {},
      matchedProducts: 0,
      matchedCompetitors: 0,
      totalProducts: 0,
      totalCompetitors: 0,
      priceChanges: 0,
      errorMessage,
    };
  } finally {
    scrapeInProgress = false;
  }
}
