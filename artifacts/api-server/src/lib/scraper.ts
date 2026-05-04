import * as cheerio from "cheerio";
import {
  db,
  arcelikProductsTable,
  arcelikCompetitorPricesTable,
  arcelikPriceHistoryTable,
  arcelikScrapeLogsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";
import { logger } from "./logger";
import type { Browser, BrowserContext, Page } from "playwright-core";

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

function extractFirstTurkishPrice(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:TL|₺)/);
  if (m) return parseTurkishPrice(m[1]);
  const fallback = text.match(/(\d{1,3}(?:\.\d{3})+)/);
  if (fallback) return parseTurkishPrice(fallback[1]);
  return null;
}

function normalizeModelKey(code: string): string {
  return code
    .toLowerCase()
    .replace(/[\s\-_/]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function extractModelTokens(model: string): string[] {
  return model
    .split(/[\s\-_/]+/)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 2);
}

function fuzzyMatchScraped(
  baselineModel: string,
  scrapedMap: Map<string, ScrapedPrice>,
): ScrapedPrice | undefined {
  const exactKey = normalizeModelKey(baselineModel);
  const exact = scrapedMap.get(exactKey);
  if (exact) return exact;

  const tokens = extractModelTokens(baselineModel);
  const coreToken = tokens.find((t) => /\d{3,}/.test(t));
  if (!coreToken) return undefined;

  for (const [key, scraped] of scrapedMap) {
    if (key.includes(coreToken)) return scraped;
  }
  return undefined;
}

async function fetchPage(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "fetchPage non-OK response");
      return null;
    }
    return await res.text();
  } catch (err) {
    logger.warn({ url, err }, "fetchPage error");
    return null;
  }
}

let _pwBrowser: Browser | null = null;

function findChromiumPath(): string | null {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      const p = execSync(`which ${bin}`, { encoding: "utf-8" }).trim();
      if (p) return p;
    } catch {}
  }
  logger.error("No Chromium binary found. Set PLAYWRIGHT_CHROMIUM_PATH or install chromium.");
  return null;
}

async function getPlaywrightBrowser(): Promise<Browser | null> {
  if (_pwBrowser) return _pwBrowser;
  const execPath = findChromiumPath();
  if (!execPath) return null;
  try {
    const { chromium } = await import("playwright-core");
    logger.info({ execPath }, "Launching Playwright with Chromium");
    _pwBrowser = await chromium.launch({
      headless: true,
      executablePath: execPath,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    logger.info("Playwright browser launched successfully");
    return _pwBrowser;
  } catch (err) {
    logger.warn(
      { err },
      "Playwright unavailable — browser-based scraping disabled",
    );
    return null;
  }
}

async function closePlaywrightBrowser(): Promise<void> {
  if (_pwBrowser) {
    await _pwBrowser.close().catch(() => {});
    _pwBrowser = null;
  }
}

async function scrapeWithPlaywright(
  baseUrl: string,
  categories: string[],
  brandLabel: string,
): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info(`Skipping ${brandLabel} scrape (Playwright not available)`);
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "tr-TR",
  });

  try {
    for (const cat of categories) {
      const url = `${baseUrl}/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        await page
          .waitForSelector(
            ".product-card, .product-item, [data-product-id], .product-list",
            { timeout: 10000 },
          )
          .catch(() => {});

        const items = await page.evaluate(() => {
          const out: { name: string; priceText: string; modelCode: string }[] = [];
          document
            .querySelectorAll(
              ".product-card, .product-item, [data-product-id], .product-list-item-wrap",
            )
            .forEach((el) => {
              const nameEl = el.querySelector(
                ".product-name, .product-title, h3, h2",
              );
              const priceEl = el.querySelector(
                ".product-price, .price, [data-price], .product-price-helper",
              );
              const name = nameEl?.textContent?.trim() || "";
              const priceText = priceEl?.textContent?.trim() || "";
              const modelCode =
                el.getAttribute("data-product-id") || "";
              if (name && priceText) out.push({ name, priceText, modelCode });
            });
          return out;
        });

        for (const item of items) {
          const price = extractFirstTurkishPrice(item.priceText);
          if (price && price > 1000) {
            const modelMatch = item.name.match(/\b(\d{3,5}\s*[A-Z]{1,4})\b/);
            results.push({
              modelCode:
                item.modelCode ||
                (modelMatch ? modelMatch[1].trim() : item.name.slice(0, 30)),
              name: item.name,
              price,
              sourceUrl: url,
              scrapedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        logger.warn({ url, err }, `${brandLabel} page scrape failed`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return results;
}

async function scrapeArcelik(): Promise<ScrapedPrice[]> {
  return scrapeWithPlaywright(
    "https://www.arcelik.com.tr",
    ["buzdolabi", "camasir-makinesi", "bulasik-makinesi", "ankastre-firinlar", "klima"],
    "Arçelik",
  );
}

async function scrapeBeko(): Promise<ScrapedPrice[]> {
  return scrapeWithPlaywright(
    "https://www.beko.com.tr",
    ["buzdolabi", "camasir-makinesi", "bulasik-makinesi"],
    "Beko",
  );
}

async function scrapeVestel(): Promise<ScrapedPrice[]> {
  const categories = ["buzdolabi", "camasir-makinesi", "bulasik-makineleri"];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const url = `https://www.vestel.com.tr/${cat}`;
    const html = await fetchPage(url);
    if (!html) continue;
    const $ = cheerio.load(html);
    $(".product-list-item-wrap").each((_, el) => {
      const name = $(el).find(".product-title").first().text().trim();
      const priceRaw = $(el).find(".product-price-helper").first().text().trim();
      const price = extractFirstTurkishPrice(priceRaw);
      if (name && price && price > 1000) {
        const modelMatch = name.match(
          /\b([A-Z]{2,5}\d{3,5}[A-Z0-9]*(?:\s+[A-Z]{1,3})?)\b/i,
        );
        const dataId =
          $(el).attr("data-product-id") ||
          $(el).find("[data-product-id]").first().attr("data-product-id") ||
          "";
        results.push({
          modelCode: dataId || (modelMatch ? modelMatch[1].trim().toUpperCase() : name.slice(0, 30)),
          name,
          price,
          sourceUrl: url,
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  }
  return results;
}

async function scrapeBosch(): Promise<ScrapedPrice[]> {
  const categories = [
    "buzdolaplari-derin-dondurucular",
    "camasir-makineleri",
    "bulasik-makineleri",
  ];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const url = `https://www.bosch-home.com.tr/tr/category/${cat}`;
    const html = await fetchPage(url);
    if (!html) continue;
    const $ = cheerio.load(html);
    $('[data-testid^="product-teaser-container-for-"]').each((_, el) => {
      const rawName = $(el)
        .find('[data-testid="product-teaser-header-headline"]')
        .first()
        .text()
        .trim();
      const name =
        rawName.includes("{") || rawName.includes("@media") ? "" : rawName;
      const modelCode = $(el)
        .find('[data-testid="product-code"]')
        .first()
        .text()
        .trim();
      const priceText = $(el)
        .find('[data-testid="price-main-price"]')
        .first()
        .text()
        .trim();
      const price = parseTurkishPrice(priceText);
      if (modelCode && price && price > 1000) {
        results.push({
          modelCode,
          name: name || modelCode,
          price,
          sourceUrl: url,
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  }
  return results;
}

async function scrapeSamsung(): Promise<ScrapedPrice[]> {
  const categories = [
    "refrigerators/all-refrigerators",
    "washers-and-dryers/all-washers-and-dryers",
    "dishwashers/all-dishwashers",
  ];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const url = `https://www.samsung.com/tr/${cat}/`;
    const html = await fetchPage(url, {
      Cookie: "country_codes=tr; country_region=TR",
    });
    if (!html) continue;
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || "");
        if (data["@type"] !== "ItemList" || !data.itemListElement) return;
        for (const entry of data.itemListElement) {
          const item = entry.item || entry;
          const name = item.name;
          const rawPrice = item.offers?.price;
          const price =
            typeof rawPrice === "number"
              ? Math.round(rawPrice)
              : parseTurkishPrice(String(rawPrice || ""));
          if (!name || !price || price < 1000) continue;

          let modelCode = item.sku || item.productID || item.model || "";
          if (!modelCode && item.url) {
            const slug = String(item.url).split("/").filter(Boolean).pop() || "";
            const codeMatch = slug.match(/[-]([a-z]{2}\d{2,}[a-z0-9]*)\/?$/i);
            modelCode = codeMatch ? codeMatch[1].toUpperCase() : "";
          }
          results.push({
            modelCode: modelCode || name.slice(0, 30),
            name,
            price,
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch {
        // skip malformed JSON-LD blocks
      }
    });
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

  await closePlaywrightBrowser();
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
      scraped.arcelik.map((s) => [normalizeModelKey(s.modelCode), s]),
    );
    const bekoMap = new Map(
      scraped.beko.map((s) => [normalizeModelKey(s.modelCode), s]),
    );

    for (const p of existingProducts) {
      const match =
        fuzzyMatchScraped(p.modelCode, arcelikMap) ??
        fuzzyMatchScraped(p.modelCode, bekoMap);
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
      scraped.vestel.map((s) => [normalizeModelKey(s.modelCode), s]),
    );
    const boschMap = new Map(
      scraped.bosch.map((s) => [normalizeModelKey(s.modelCode), s]),
    );
    const samsungMap = new Map(
      scraped.samsung.map((s) => [normalizeModelKey(s.modelCode), s]),
    );

    const productPriceMap = new Map(
      existingProducts.map((p) => [p.id, p.tsfPrice]),
    );

    let unmatchedCompetitors = 0;
    for (const cp of existingCompetitors) {
      let match: ScrapedPrice | undefined;
      if (cp.brand === "Vestel" || cp.brand === "Regal")
        match = fuzzyMatchScraped(cp.competitorModel, vestelMap);
      else if (
        cp.brand === "Bosch" ||
        cp.brand === "Siemens" ||
        cp.brand === "Profilo"
      )
        match = fuzzyMatchScraped(cp.competitorModel, boschMap);
      else if (cp.brand === "Samsung")
        match = fuzzyMatchScraped(cp.competitorModel, samsungMap);

      if (!match) {
        unmatchedCompetitors++;
        continue;
      }

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

    if (unmatchedCompetitors > 0) {
      logger.warn(
        { unmatchedCompetitors, totalCompetitors: existingCompetitors.length },
        "Some competitor entries had no scraped match (baseline model codes may need updating)",
      );
    }

    logger.info(
      {
        runId,
        matchedProducts,
        matchedCompetitors,
        unmatchedCompetitors,
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
