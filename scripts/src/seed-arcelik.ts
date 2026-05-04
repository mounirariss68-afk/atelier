import {
  db,
  pool,
  arcelikProductsTable,
  arcelikCompetitorPricesTable,
  arcelikDataSourcesTable,
  arcelikCitiesTable,
  arcelikDealersTable,
  arcelikCampaignsTable,
  arcelikCalendarTable,
  arcelikKpiBenchmarksTable,
} from "@workspace/db";
import * as cheerio from "cheerio";
import type { InferInsertModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";
import type { Browser, BrowserContext, Page } from "playwright-core";

const DRY_RUN = process.argv.includes("--dry-run");
const NO_SCRAPE = process.argv.includes("--no-scrape");
const FORCE = process.argv.includes("--force");

const MIN_COVERAGE_ARG = process.argv.find((a) => a.startsWith("--min-coverage="));
const parsedCoverage = MIN_COVERAGE_ARG ? parseInt(MIN_COVERAGE_ARG.split("=")[1], 10) : 10;
const MIN_COVERAGE_PERCENT = Number.isFinite(parsedCoverage) && parsedCoverage >= 0 && parsedCoverage <= 100
  ? parsedCoverage
  : 10;

interface ScrapedPrice {
  modelCode: string;
  name: string;
  price: number;
  sourceUrl: string;
  scrapedAt: string;
}

interface BaselineData {
  _provenance: {
    description: string;
    sources: Record<string, string>;
    verificationDate: string;
    lastUpdated: string;
    note: string;
  };
  products: Array<Record<string, unknown>>;
  competitorPrices: Array<Record<string, unknown>>;
  cities: Array<Record<string, unknown>>;
  dealers: Array<Record<string, unknown>>;
  campaigns: Array<Record<string, unknown>>;
  calendar: Array<Record<string, unknown>>;
  kpiBenchmarks: Array<Record<string, unknown>>;
}

function loadBaseline(): BaselineData {
  const baselinePath = resolve(import.meta.dirname, "arcelik-baseline.json");
  const raw = readFileSync(baselinePath, "utf-8");
  const data = JSON.parse(raw) as BaselineData;
  console.log(`Loaded baseline from ${baselinePath}`);
  console.log(`  Provenance: ${data._provenance.description}`);
  console.log(`  Verified: ${data._provenance.verificationDate}`);
  console.log(`  Products: ${data.products.length}, Competitors: ${data.competitorPrices.length}`);
  return data;
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

async function fetchPage(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.log(`  fetchPage ${url}: HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.log(`  fetchPage ${url}: ${err instanceof Error ? err.message : "failed"}`);
    return null;
  }
}

let _pwBrowser: Browser | null = null;

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
  const coreTokens = tokens.filter((t) => /[a-z]\d{3,}|^\d{4,}/.test(t) && t.length >= 4);
  if (coreTokens.length === 0) return undefined;

  for (const [key, scraped] of scrapedMap) {
    if (coreTokens.some((ct) => key.includes(ct))) return scraped;
  }
  return undefined;
}

function findChromiumPath(): string | null {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      const p = execSync(`which ${bin}`, { encoding: "utf-8" }).trim();
      if (p) return p;
    } catch {}
  }
  console.log("  No Chromium binary found. Set PLAYWRIGHT_CHROMIUM_PATH or install chromium.");
  return null;
}

async function getPlaywrightBrowser(): Promise<Browser | null> {
  if (_pwBrowser) return _pwBrowser;
  const execPath = findChromiumPath();
  if (!execPath) return null;
  try {
    const { chromium } = await import("playwright-core");
    console.log(`  Launching Playwright with Chromium at: ${execPath}`);
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
    return _pwBrowser;
  } catch {
    console.log("  Playwright unavailable — browser-based scraping disabled");
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
  if (!browser) return [];

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
          const out: { name: string; priceText: string; modelCode: string; gtmPrice: string }[] = [];
          document.querySelectorAll("article.prd.product-item").forEach((el) => {
            const gtmRaw = el.getAttribute("data-gtm-impression") || "";
            let gtmName = "";
            let gtmId = "";
            let gtmPrice = "";
            try {
              const gtm = JSON.parse(gtmRaw);
              gtmName = String(gtm.name || "").trim();
              gtmId = String(gtm.id || "").trim();
              gtmPrice = String(gtm.price || "").trim();
            } catch {
              // gtm JSON missing or malformed
            }
            const codeAttr =
              el.querySelector("[data-product-code]")?.getAttribute("data-product-code") ||
              el.getAttribute("data-product-code") ||
              "";
            const nameAttr =
              el.querySelector("[data-product-name]")?.getAttribute("data-product-name") || "";
            const priceText =
              el.querySelector("span.prc.prc-last")?.textContent?.trim() ||
              el.querySelector(".prd-price")?.textContent?.trim() ||
              "";
            const name = gtmName || nameAttr;
            const modelCode = gtmId || codeAttr;
            if (name && (priceText || gtmPrice)) {
              out.push({ name, priceText, modelCode, gtmPrice });
            }
          });
          if (out.length === 0) {
            document
              .querySelectorAll(
                ".product-card, .product-item, [data-product-id], .product-list-item-wrap",
              )
              .forEach((el) => {
                const nameEl = el.querySelector(".product-name, .product-title, h3, h2");
                const priceEl = el.querySelector(
                  ".product-price, .price, [data-price], .product-price-helper",
                );
                const name = nameEl?.textContent?.trim() || "";
                const priceText = priceEl?.textContent?.trim() || "";
                const modelCode = el.getAttribute("data-product-id") || "";
                if (name && priceText) out.push({ name, priceText, modelCode, gtmPrice: "" });
              });
          }
          return out;
        });

        for (const item of items) {
          let price: number | null = null;
          if (item.gtmPrice) {
            const n = parseFloat(item.gtmPrice);
            if (!isNaN(n)) price = Math.round(n);
          }
          if (price === null) price = extractFirstTurkishPrice(item.priceText);
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
      } catch {
        console.log(`  ${brandLabel} page scrape failed: ${url}`);
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

  const results: ScraperResults = { arcelik: [], beko: [], vestel: [], bosch: [], samsung: [] };
  const keys = ["arcelik", "beko", "vestel", "bosch", "samsung"] as const;

  for (let i = 0; i < scrapers.length; i++) {
    const s = scrapers[i];
    console.log(`  Scraping ${s.name}...`);
    try {
      const scraped = await s.fn();
      results[keys[i]] = scraped;
      console.log(`  ✓ ${s.name}: ${scraped.length} products found`);
    } catch (err) {
      console.log(`  ✗ ${s.name}: scrape failed (${err instanceof Error ? err.message : "unknown error"})`);
    }
  }

  await closePlaywrightBrowser();
  return results;
}

function applyScrapedPrices(
  products: Array<Record<string, unknown>>,
  scraped: ScraperResults,
): { updated: number; unmatched: string[] } {
  const today = new Date().toISOString().split("T")[0];
  let updated = 0;
  const unmatched: string[] = [];

  const arcelikMap = new Map(scraped.arcelik.map((s) => [normalizeModelKey(s.modelCode), s]));
  const bekoMap = new Map(scraped.beko.map((s) => [normalizeModelKey(s.modelCode), s]));

  const matchedScrapedKeys = new Set<string>();

  for (const p of products) {
    const match =
      fuzzyMatchScraped(p.modelCode as string, arcelikMap) ??
      fuzzyMatchScraped(p.modelCode as string, bekoMap);
    if (match) {
      p.tsfPrice = match.price;
      p.dealerCost = Math.round(match.price * (1 - (p.marginPercent as number) / 100));
      p.priceDate = today;
      p.dataProvenance = "auto-scraped";
      p.scrapedAt = match.scrapedAt;
      matchedScrapedKeys.add(normalizeModelKey(match.modelCode));
      updated++;
    }
  }

  for (const [key, item] of arcelikMap) {
    if (!matchedScrapedKeys.has(key)) unmatched.push(`arcelik: ${item.name} (${item.modelCode})`);
  }
  for (const [key, item] of bekoMap) {
    if (!matchedScrapedKeys.has(key)) unmatched.push(`beko: ${item.name} (${item.modelCode})`);
  }

  return { updated, unmatched };
}

function applyScrapedCompetitorPrices(
  competitors: Array<Record<string, unknown>>,
  scraped: ScraperResults,
  products: Array<Record<string, unknown>>,
): { updated: number; unmatched: string[] } {
  const today = new Date().toISOString().split("T")[0];
  let updated = 0;
  const unmatched: string[] = [];

  const vestelMap = new Map(scraped.vestel.map((s) => [normalizeModelKey(s.modelCode), s]));
  const boschMap = new Map(scraped.bosch.map((s) => [normalizeModelKey(s.modelCode), s]));
  const samsungMap = new Map(scraped.samsung.map((s) => [normalizeModelKey(s.modelCode), s]));
  const productPriceMap = new Map(products.map((p) => [p.id as string, p.tsfPrice as number]));

  const matchedKeys = new Set<string>();

  for (const cp of competitors) {
    let match: ScrapedPrice | undefined;
    if (cp.brand === "Vestel" || cp.brand === "Regal")
      match = fuzzyMatchScraped(cp.competitorModel as string, vestelMap);
    else if (cp.brand === "Bosch" || cp.brand === "Siemens" || cp.brand === "Profilo")
      match = fuzzyMatchScraped(cp.competitorModel as string, boschMap);
    else if (cp.brand === "Samsung")
      match = fuzzyMatchScraped(cp.competitorModel as string, samsungMap);

    if (match) {
      cp.competitorPrice = match.price;
      cp.priceDate = today;
      cp.dataProvenance = "auto-scraped";
      cp.scrapedAt = match.scrapedAt;
      matchedKeys.add(normalizeModelKey(match.modelCode));
      updated++;
    }

    const arcelikPrice = productPriceMap.get(cp.arcelikEquivalentId as string);
    if (arcelikPrice && arcelikPrice > 0) {
      cp.priceDeltaPercent = Math.round(((cp.competitorPrice as number) - arcelikPrice) / arcelikPrice * 100);
    }
  }

  for (const [key, item] of vestelMap) {
    if (!matchedKeys.has(key)) unmatched.push(`vestel: ${item.name} (${item.modelCode})`);
  }
  for (const [key, item] of boschMap) {
    if (!matchedKeys.has(key)) unmatched.push(`bosch: ${item.name} (${item.modelCode})`);
  }
  for (const [key, item] of samsungMap) {
    if (!matchedKeys.has(key)) unmatched.push(`samsung: ${item.name} (${item.modelCode})`);
  }

  return { updated, unmatched };
}

async function upsertAll<T extends PgTable>(
  table: T,
  data: InferInsertModel<T>[],
  label: string,
) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would upsert ${data.length} ${label}`);
    return;
  }
  const idCol = (table as unknown as typeof arcelikProductsTable).id;
  for (const row of data) {
    await db.insert(table).values(row).onConflictDoUpdate({
      target: idCol,
      set: row,
    });
  }
  console.log(`Upserted ${data.length} ${label}`);
}

const DATA_SOURCES = [
  { id: "src-arcelik-ar", category: "market-share", name: "Arçelik A.Ş. 2024 Faaliyet Raporu", nameEn: "Arçelik A.Ş. 2024 Annual Report", sourceType: "annual-report", sourceUrl: "https://www.arcelikglobal.com/en/investor-relations/presentations-and-reports/annual-reports/", sourceDate: "2025-03-28", description: "Türkiye beyaz eşya pazar payı %45–48, brüt marj %30.2, gelir dağılımı verileri", descriptionEn: "Turkey white goods market share 45–48%, gross margin 30.2%, revenue breakdown data" },
  { id: "src-arcelik-prices", category: "product-prices", name: "arcelik.com.tr Ürün Kataloğu", nameEn: "arcelik.com.tr Product Catalog", sourceType: "website-catalog", sourceUrl: "https://www.arcelik.com.tr/beyaz-esya", sourceDate: "2026-05-01", description: "Arçelik TSF listefiyatları — buzdolabı, çamaşır, bulaşık, fırın, klima kategorileri", descriptionEn: "Arçelik TSF list prices — refrigerator, washing machine, dishwasher, oven, AC categories" },
  { id: "src-beko-prices", category: "product-prices", name: "beko.com.tr Ürün Kataloğu", nameEn: "beko.com.tr Product Catalog", sourceType: "website-catalog", sourceUrl: "https://www.beko.com.tr/beyaz-esya", sourceDate: "2026-05-01", description: "Beko TSF listefiyatları — tüm beyaz eşya ve küçük ev aletleri", descriptionEn: "Beko TSF list prices — all white goods and small appliances" },
  { id: "src-vestel-prices", category: "competitor-prices", name: "vestel.com.tr Ürün Kataloğu", nameEn: "vestel.com.tr Product Catalog", sourceType: "website-catalog", sourceUrl: "https://www.vestel.com.tr/beyaz-esya", sourceDate: "2026-05-01", description: "Vestel rakip fiyatları — beyaz eşya ve TV kategorileri", descriptionEn: "Vestel competitor prices — white goods and TV categories" },
  { id: "src-bosch-prices", category: "competitor-prices", name: "bosch-home.com.tr Ürün Kataloğu", nameEn: "bosch-home.com.tr Product Catalog", sourceType: "website-catalog", sourceUrl: "https://www.bosch-home.com.tr/urun-listeleme", sourceDate: "2026-05-01", description: "Bosch rakip fiyatları — premium beyaz eşya segmenti", descriptionEn: "Bosch competitor prices — premium white goods segment" },
  { id: "src-samsung-prices", category: "competitor-prices", name: "samsung.com/tr Ürün Kataloğu", nameEn: "samsung.com/tr Product Catalog", sourceType: "website-catalog", sourceUrl: "https://www.samsung.com/tr/home-appliances/", sourceDate: "2026-05-01", description: "Samsung rakip fiyatları — beyaz eşya ve TV kategorileri", descriptionEn: "Samsung competitor prices — home appliances and TV categories" },
  { id: "src-vestel-ar", category: "market-share", name: "Vestel Elektronik 2024 Faaliyet Raporu", nameEn: "Vestel Electronics 2024 Annual Report", sourceType: "annual-report", sourceUrl: "https://www.vestelinvestorrelations.com/en/financial-reports.aspx", sourceDate: "2025-04-15", description: "Vestel Türkiye pazar payı verileri, gelir ve marj bilgileri", descriptionEn: "Vestel Turkey market share data, revenue and margin figures" },
  { id: "src-bsh-turkey", category: "market-share", name: "BSH Türkiye Pazar Verileri (Kamuya açık)", nameEn: "BSH Turkey Market Data (Public filings)", sourceType: "public-filing", sourceUrl: "https://www.bsh-group.com/tr/hakkimizda", sourceDate: "2025-02-01", description: "BSH (Bosch, Siemens, Profilo) Türkiye pazar payı ve bayi ağı verileri", descriptionEn: "BSH (Bosch, Siemens, Profilo) Turkey market share and dealer network data" },
  { id: "src-turkbesd", category: "market-share", name: "TÜRKBESD Beyaz Eşya Sektör Raporu 2024", nameEn: "TURKBESD White Goods Industry Report 2024", sourceType: "industry-report", sourceUrl: "https://www.turkbesd.org/istatistikler", sourceDate: "2025-01-20", description: "Türkiye beyaz eşya üretim, iç satış ve ihracat istatistikleri", descriptionEn: "Turkey white goods production, domestic sales and export statistics" },
  { id: "src-arcelik-dealer", category: "dealer-network", name: "Arçelik Bayi ve Servis Ağı", nameEn: "Arçelik Dealer & Service Network", sourceType: "website-catalog", sourceUrl: "https://www.arcelik.com.tr/magazalarimiz", sourceDate: "2026-04-15", description: "Arçelik yetkili bayi sayıları (il bazında) ve servis noktaları", descriptionEn: "Arçelik authorized dealer counts (by province) and service points" },
  { id: "src-turkey-map", category: "map", name: "Türkiye İl Sınırları Haritası (Coğrafi veri)", nameEn: "Turkey Provincial Boundaries Map (Geographic data)", sourceType: "geographic", sourceUrl: "https://commons.wikimedia.org/wiki/File:Turkey_location_map.svg", sourceDate: "2024-01-01", description: "Türkiye 81 il sınırları ve 7 coğrafi bölge haritası, Wikimedia Commons kaynaklı", descriptionEn: "Turkey 81 province boundaries and 7 geographic regions map, sourced from Wikimedia Commons" },
];

function recomputeDeltas(
  competitors: Array<Record<string, unknown>>,
  products: Array<Record<string, unknown>>,
) {
  const productPriceMap = new Map(products.map((p) => [p.id as string, p.tsfPrice as number]));
  let recomputed = 0;
  for (const cp of competitors) {
    const arcelikPrice = productPriceMap.get(cp.arcelikEquivalentId as string);
    if (arcelikPrice && arcelikPrice > 0) {
      cp.priceDeltaPercent = Math.round(((cp.competitorPrice as number) - arcelikPrice) / arcelikPrice * 100);
      recomputed++;
    }
  }
  console.log(`\n📐 Recomputed priceDeltaPercent for ${recomputed}/${competitors.length} competitor entries`);
}

interface CoverageResult {
  productCoverage: number;
  competitorCoverage: number;
  scrapedProducts: number;
  scrapedCompetitors: number;
  totalProducts: number;
  totalCompetitors: number;
}

function printCoverageReport(
  products: Array<Record<string, unknown>>,
  competitors: Array<Record<string, unknown>>,
): CoverageResult {
  const categories = new Set(products.map((p) => p.category as string));
  const brands = new Set(competitors.map((c) => c.brand as string));
  const scrapedProducts = products.filter((p) => p.dataProvenance === "auto-scraped").length;
  const scrapedCompetitors = competitors.filter((c) => c.dataProvenance === "auto-scraped").length;
  const manualProducts = products.filter((p) => p.dataProvenance === "manual-verified").length;
  const manualCompetitors = competitors.filter((c) => c.dataProvenance === "manual-verified").length;
  const productCoverage = Math.round((scrapedProducts / products.length) * 100);
  const competitorCoverage = Math.round((scrapedCompetitors / competitors.length) * 100);

  console.log("\n📋 Data Coverage Report:");
  console.log(`  Products: ${products.length} across ${categories.size} categories`);
  console.log(`  Competitor prices: ${competitors.length} across ${brands.size} brands`);
  console.log(`  Provenance breakdown:`);
  console.log(`    Products — auto-scraped: ${scrapedProducts}, manual-verified: ${manualProducts}`);
  console.log(`    Competitors — auto-scraped: ${scrapedCompetitors}, manual-verified: ${manualCompetitors}`);
  console.log(`  Scrape coverage: products ${productCoverage}%, competitors ${competitorCoverage}%`);
  if (scrapedProducts === 0 && scrapedCompetitors === 0) {
    console.log("  ⚠️  No auto-scraped prices. All data from manual-verified baselines.");
    console.log("     Run with default (no --no-scrape) to attempt live scraping.");
  }

  return {
    productCoverage,
    competitorCoverage,
    scrapedProducts,
    scrapedCompetitors,
    totalProducts: products.length,
    totalCompetitors: competitors.length,
  };
}

function enforceMinCoverage(coverage: CoverageResult): boolean {
  const combinedCoverage = Math.round(
    ((coverage.scrapedProducts + coverage.scrapedCompetitors) /
      (coverage.totalProducts + coverage.totalCompetitors)) * 100
  );

  console.log(`\n🔒 Enforcement gate: combined scrape coverage ${combinedCoverage}%, minimum required ${MIN_COVERAGE_PERCENT}%`);

  if (combinedCoverage < MIN_COVERAGE_PERCENT) {
    console.log(`  ❌ BELOW THRESHOLD — scrape coverage ${combinedCoverage}% < ${MIN_COVERAGE_PERCENT}%`);
    console.log(`     ${coverage.scrapedProducts}/${coverage.totalProducts} products scraped, ${coverage.scrapedCompetitors}/${coverage.totalCompetitors} competitors scraped`);
    console.log(`     Likely cause: target sites use JS rendering (Samsung, Bosch) or are blocking requests.`);
    console.log(`     Options:`);
    console.log(`       --force              Bypass enforcement and seed with available data`);
    console.log(`       --no-scrape          Use manual-verified baseline data (skip scraping)`);
    console.log(`       --min-coverage=N     Adjust minimum coverage threshold (default: ${MIN_COVERAGE_PERCENT}%)`);
    return false;
  }

  console.log(`  ✅ PASSED — ${combinedCoverage}% >= ${MIN_COVERAGE_PERCENT}%`);
  return true;
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== Seeding Arçelik data ===");

  const baseline = loadBaseline();

  const products = baseline.products.map((p) => ({ ...p }));
  const competitorPrices = baseline.competitorPrices.map((c) => ({ ...c }));

  if (NO_SCRAPE) {
    console.log("\nSkipping live scrape (--no-scrape flag set)");
    console.log("Using verified baseline data sourced from arcelik.com.tr, beko.com.tr, vestel.com.tr, bosch-home.com.tr, samsung.com/tr");
  } else {
    console.log("\n🔍 Scraping live prices from websites (default behavior, pass --no-scrape to skip)...");
    const scraped = await runScrapers();
    const totalScraped = Object.values(scraped).reduce((s, arr) => s + arr.length, 0);

    if (totalScraped > 0) {
      console.log(`\n📊 Scraped ${totalScraped} total prices from live sites, merging with dataset...`);

      const productResult = applyScrapedPrices(products, scraped);
      console.log(`  Applied ${productResult.updated}/${products.length} scraped product prices`);
      if (productResult.unmatched.length > 0) {
        console.log(`  ⚠️  ${productResult.unmatched.length} scraped product prices could not be matched to baseline SKUs:`);
        for (const u of productResult.unmatched.slice(0, 20)) console.log(`    - ${u}`);
        if (productResult.unmatched.length > 20) console.log(`    ... and ${productResult.unmatched.length - 20} more`);
      }

      const compResult = applyScrapedCompetitorPrices(competitorPrices, scraped, products);
      console.log(`  Applied ${compResult.updated}/${competitorPrices.length} scraped competitor prices`);
      if (compResult.unmatched.length > 0) {
        console.log(`  ⚠️  ${compResult.unmatched.length} scraped competitor prices could not be matched:`);
        for (const u of compResult.unmatched.slice(0, 20)) console.log(`    - ${u}`);
        if (compResult.unmatched.length > 20) console.log(`    ... and ${compResult.unmatched.length - 20} more`);
      }
    } else {
      console.log("\n⚠️  No prices scraped (sites may be blocking requests or using JS rendering).");
    }

    recomputeDeltas(competitorPrices, products);
    const coverage = printCoverageReport(products, competitorPrices);

    if (!FORCE) {
      const passed = enforceMinCoverage(coverage);
      if (!passed) {
        console.log("\n🛑 Seeding aborted: scrape coverage below minimum threshold.");
        console.log("   Use --force to bypass or --no-scrape to use baseline data.");
        await pool.end();
        process.exit(1);
      }
    } else {
      console.log("\n⚡ --force flag set: bypassing coverage enforcement gate");
    }
  }

  if (NO_SCRAPE) {
    recomputeDeltas(competitorPrices, products);
    printCoverageReport(products, competitorPrices);
  }

  await upsertAll(arcelikDataSourcesTable, DATA_SOURCES as InferInsertModel<typeof arcelikDataSourcesTable>[], "data sources");
  await upsertAll(arcelikProductsTable, products as InferInsertModel<typeof arcelikProductsTable>[], "products");
  await upsertAll(arcelikCompetitorPricesTable, competitorPrices as InferInsertModel<typeof arcelikCompetitorPricesTable>[], "competitor prices");
  await upsertAll(arcelikCitiesTable, baseline.cities as InferInsertModel<typeof arcelikCitiesTable>[], "cities");
  await upsertAll(arcelikDealersTable, baseline.dealers as InferInsertModel<typeof arcelikDealersTable>[], "dealers");
  await upsertAll(arcelikCampaignsTable, baseline.campaigns as InferInsertModel<typeof arcelikCampaignsTable>[], "campaigns");
  await upsertAll(arcelikCalendarTable, baseline.calendar as InferInsertModel<typeof arcelikCalendarTable>[], "calendar entries");
  await upsertAll(arcelikKpiBenchmarksTable, baseline.kpiBenchmarks as InferInsertModel<typeof arcelikKpiBenchmarksTable>[], "KPI benchmarks");

  console.log("Done!");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
