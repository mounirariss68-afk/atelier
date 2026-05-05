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

// MUST stay identical to extractLGCurrentPrice in
// artifacts/api-server/src/lib/scraper.ts. LG TV cards glue a discount badge
// with current+original prices into a single .cell-price string like
// "%14.29149.999,00 TL174.999,00 TL"; passing that to parseTurkishPrice
// returns ~46M. Extract every "X.XXX,XX TL" match and return the minimum —
// the sale/current price is always the lower of the two. Falls back to
// parseTurkishPrice for clean (single-price) cards.
function extractLGCurrentPrice(text: string): number | null {
  const matches = Array.from(
    text.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*TL/g),
  );
  if (matches.length === 0) return parseTurkishPrice(text);
  const prices = matches
    .map((m) => parseTurkishPrice(m[1]))
    .filter((p): p is number => p !== null && p > 1000);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

function extractFirstTurkishPrice(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:TL|₺)/);
  if (m) return parseTurkishPrice(m[1]);
  const fallback = text.match(/(\d{1,3}(?:\.\d{3})+)/);
  if (fallback) return parseTurkishPrice(fallback[1]);
  return null;
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

// ---------------------------------------------------------------------------
// Brand-site category lists. MUST stay identical to the lists in
// artifacts/api-server/src/lib/scraper.ts so seed-time and runtime walk the
// same catalogs. Categories that 404 for a given brand are skipped silently
// by the per-page try/catch — the lists are intentionally generous.
// ---------------------------------------------------------------------------
const ARCELIK_CATEGORIES = [
  "buzdolabi",
  "no-frost-buzdolabi",
  "gardirop-tipi-buzdolabi",
  "side-by-side-buzdolabi",
  "mini-buzdolabi",
  "camasir-makinesi",
  "kurutma-makinesi",
  "kurutmali-camasir-makinesi",
  "bulasik-makinesi",
  "ankastre-firinlar",
  "ankastre-bulasik-makinesi",
  "ankastre-buzdolabi",
  "ankastre-set",
  "klima",
  "aspirator",
  "set-ustu-ocak",
  "mikrodalga-firin",
  "elektrikli-supurge",
  "televizyon",
  "kucuk-ev-aletleri",
] as const;

const BEKO_CATEGORIES = [
  "buzdolabi",
  "no-frost-buzdolabi",
  "side-by-side-buzdolabi",
  "mini-buzdolabi",
  "camasir-makinesi",
  "kurutma-makinesi",
  "kurutmali-camasir-makinesi",
  "bulasik-makinesi",
  "ankastre-firinlar",
  "ankastre-bulasik-makinesi",
  "ankastre-buzdolabi",
  "ankastre-set",
  "klima",
  "aspirator",
  "set-ustu-ocak",
  "mikrodalga-firin",
  "elektrikli-supurge",
  "televizyon",
  "kucuk-ev-aletleri",
] as const;

// Vestel uses canonical /{slug}-c-{id} URLs. Plain slug pages either redirect
// or render limited inventory — only the -c-{id} routes show the full
// catalog. Discovered via Playwright crawl of the homepage navigation
// (May 2026). MUST stay identical to artifacts/api-server/src/lib/scraper.ts.
const VESTEL_CATEGORIES = [
  "buzdolabi-c-13",
  "camasir-makineleri-c-14",
  "bulasik-makineleri-c-11",
  "kurutma-makineleri-c-16",
  "kurutmali-camasir-makinesi-c-59",
  "derin-dondurucular-c-15",
  "ankastre-buzdolabi-c-1312",
  "ankastre-firinlar-c-30",
  "ankastre-bulasik-makineleri-c-28",
  "ankastre-ocaklar-c-32",
  "ankastre-davlumbazlar-c-29",
  "ankastre-mikrodalga-firinlar-c-31",
  "ankastre-setler-c-33",
  "solo-firin-c-20",
  "mini-firin-c-18",
  "mikrodalga-firin-c-17",
  "set-ustu-ocak-c-19",
  "aspiratorler-c-10",
  "elektrikli-supurgeler-c-34",
  "robot-supurge-c-1110",
  "klimalar-c-40",
  "televizyonlar-c-26",
] as const;

// All 11 top-level Bosch product categories under /tr/category/{slug}.
// Discovered via Playwright crawl of the homepage navigation (May 2026).
// Excludes /kampanyalar (promo) and /oyuncaklar (toys).
// MUST stay identical to artifacts/api-server/src/lib/scraper.ts.
const BOSCH_CATEGORIES = [
  "buzdolaplari-derin-dondurucular",
  "camasir-ve-kurutma-makineleri",
  "bulasik-makineleri",
  "pisirme-grubu",
  "ankastre-urunler",
  "mutfak-aletleri",
  "mutfak-makineleri",
  "kahve-makineleri",
  "elektrikli-supurgeler",
  "klimalar",
  "su-sebilleri-ve-su-aritma",
] as const;

const SAMSUNG_CATEGORIES = [
  "refrigerators/all-refrigerators",
  "washers-and-dryers/all-washers-and-dryers",
  "dishwashers/all-dishwashers",
  "cooking-appliances/ovens",
  "cooking-appliances/hobs",
  "cooking-appliances/hoods",
  "microwave-ovens",
  "vacuum-cleaners",
  "tvs/all-tvs",
  "monitors/all-monitors",
] as const;

// MUST stay identical to LG_CATEGORIES in artifacts/api-server/src/lib/scraper.ts.
// NOTE: LG TR sells refrigerators/washers/dishwashers/klima/TVs but does NOT
// sell ovens or other cooking appliances on lg.com/tr (every /firin, /ocak,
// /mikrodalga URL returns 404). The 11 LG competitor entries in baseline cover
// buzdolabi (3), camasir (3), bulasik (1), tv-elektronik (3), klima (1) — no
// ovens — so this matches what the LG TR catalog actually offers.
const LG_CATEGORIES = [
  "buzdolabi/tuem-buzdolaplar",
  "buzdolabi/dondurucu-altta-buzdolabi",
  "buzdolabi/dondurucu-ustte-buzdolabi",
  "buzdolabi/gardirop-tipi-buzdolabi",
  "camasir-makinesi/camasir-makineleri",
  "camasir-makinesi/kurutma-makineleri",
  "camasir-makinesi/kurutmali-camasir-makineleri",
  "camasir-makinesi/washtower",
  "bulasik-makinesi/tum-bulasik-makineleri",
  "klima/tum-klimalar",
  "tv-soundbar/oled",
  "tv-soundbar/oled-evo",
  "tv-soundbar/qned",
  "tv-soundbar/qned-evo",
  "tv-soundbar/nanocell",
  "tv-by-resolution/4k-tvs",
] as const;

// MUST stay identical to PROFILO_CATEGORIES in artifacts/api-server/src/lib/scraper.ts.
const PROFILO_CATEGORIES = [
  "beyaz-esya/buzdolabi-ve-derin-dondurucular/buzdolaplari",
  "beyaz-esya/buzdolabi-ve-derin-dondurucular/derin-dondurucular",
  "beyaz-esya/camasir-ve-kurutma-makineleri/camasir-makineleri",
  "beyaz-esya/camasir-ve-kurutma-makineleri/kurutma-makineleri",
  "beyaz-esya/bulasik-makineleri",
  "beyaz-esya/firinlar-ocaklar-ve-aspiratorler/firinlar",
  "beyaz-esya/firinlar-ocaklar-ve-aspiratorler/set-ustu-ocaklar",
  "beyaz-esya/firinlar-ocaklar-ve-aspiratorler/midi-ve-mikrodalga-firinlar",
  "ankastre/firinlar",
  "ankastre/bulasik-makinesi",
  "ankastre/aspiratorler-davlumbazlar",
  "elektrikli-supurgeler",
] as const;

// MUST stay identical to GRUNDIG_CATEGORIES in artifacts/api-server/src/lib/scraper.ts.
const GRUNDIG_CATEGORIES = [
  "buzdolabi",
  "mini-buzdolabi",
  "camasir-makinesi",
  "bulasik-makinesi",
  "ankastre-firin",
  "ankastre-standart-firin",
  "buhar-destekli-firin",
  "az-yagli-pisirici",
  "pisirici",
  "kucuk-ev-aletleri",
] as const;

function dedupeByModel(items: ScrapedPrice[]): ScrapedPrice[] {
  const seen = new Map<string, ScrapedPrice>();
  for (const item of items) {
    const key = normalizeModelKey(item.modelCode);
    if (key && !seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
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
  const items = await scrapeWithPlaywright(
    "https://www.arcelik.com.tr",
    [...ARCELIK_CATEGORIES],
    "Arçelik",
  );
  return dedupeByModel(items);
}

async function scrapeBeko(): Promise<ScrapedPrice[]> {
  const items = await scrapeWithPlaywright(
    "https://www.beko.com.tr",
    [...BEKO_CATEGORIES],
    "Beko",
  );
  return dedupeByModel(items);
}

// Vestel category pages stream products via scroll-triggered AJAX. Use
// Playwright to scroll-to-bottom in a bounded loop until the product count
// stabilises. Cap at 25 iterations to bound wall time.
async function scrapeVestel(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    console.log("  Skipping Vestel scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
  });

  try {
    for (const cat of VESTEL_CATEGORIES) {
      const url = `https://www.vestel.com.tr/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page
          .waitForSelector(".product-list-item-wrap", { timeout: 10000 })
          .catch(() => {});

        let prevCount = 0;
        let stableScrolls = 0;
        for (let i = 0; i < 25; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(800);
          const count = await page.locator(".product-list-item-wrap").count();
          if (count === prevCount) {
            stableScrolls++;
            if (stableScrolls >= 2) break;
          } else {
            stableScrolls = 0;
            prevCount = count;
          }
        }

        const items = await page.evaluate(() => {
          const out: { name: string; priceText: string; modelCode: string }[] = [];
          document.querySelectorAll(".product-list-item-wrap").forEach((el) => {
            const name =
              el.querySelector(".product-title, .product-name, h3")?.textContent?.trim() || "";
            const priceText =
              el
                .querySelector(".product-price-helper, .product-price, .price")
                ?.textContent?.trim() || "";
            const modelCode =
              el.getAttribute("data-product-id") ||
              el.querySelector("[data-product-id]")?.getAttribute("data-product-id") ||
              "";
            if (name && priceText) out.push({ name, priceText, modelCode });
          });
          return out;
        });

        let pageAdded = 0;
        for (const item of items) {
          const price = extractFirstTurkishPrice(item.priceText);
          if (!price || price <= 1000) continue;
          const modelMatch = item.name.match(
            /\b([A-Z]{2,5}\d{3,5}[A-Z0-9]*(?:\s+[A-Z]{1,3})?)\b/i,
          );
          results.push({
            modelCode:
              item.modelCode ||
              (modelMatch ? modelMatch[1].trim().toUpperCase() : item.name.slice(0, 30)),
            name: item.name,
            price,
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          });
          pageAdded++;
        }
        console.log(`    Vestel ${cat}: ${pageAdded} accepted (${prevCount} on DOM)`);
      } catch {
        console.log(`  Vestel page scrape failed: ${url}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// Bosch category pages reveal additional products via a "Daha fazla görüntüle"
// button. Click in a bounded loop (max 30) until the button disappears or the
// product count stops growing.
async function scrapeBosch(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    console.log("  Skipping Bosch scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
  });

  try {
    for (const cat of BOSCH_CATEGORIES) {
      const url = `https://www.bosch-home.com.tr/tr/category/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page
          .waitForSelector('[data-testid^="product-teaser-container-for-"]', { timeout: 10000 })
          .catch(() => {});

        const productLocator = page.locator(
          '[data-testid^="product-teaser-container-for-"]',
        );
        let prevCount = 0;
        let stableClicks = 0;
        for (let i = 0; i < 30; i++) {
          const btn = page
            .locator(
              'button:has-text("Daha fazla görüntüle"), button:has-text("Daha fazla"), [data-testid*="show-more"]',
            )
            .first();
          const visible = await btn.isVisible().catch(() => false);
          if (!visible) break;
          const beforeCount = await productLocator.count();
          await btn.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1200);
          const afterCount = await productLocator.count();
          if (afterCount === beforeCount) {
            stableClicks++;
            if (stableClicks >= 2) break;
          } else {
            stableClicks = 0;
            prevCount = afterCount;
          }
        }

        const items = await page.evaluate(() => {
          const out: { name: string; modelCode: string; priceText: string }[] = [];
          document
            .querySelectorAll('[data-testid^="product-teaser-container-for-"]')
            .forEach((el) => {
              const rawName =
                el
                  .querySelector('[data-testid="product-teaser-header-headline"]')
                  ?.textContent?.trim() || "";
              const name =
                rawName.includes("{") || rawName.includes("@media") ? "" : rawName;
              const modelCode =
                el.querySelector('[data-testid="product-code"]')?.textContent?.trim() || "";
              const priceText =
                el.querySelector('[data-testid="price-main-price"]')?.textContent?.trim() || "";
              if (modelCode && priceText) out.push({ name, modelCode, priceText });
            });
          return out;
        });

        let pageAdded = 0;
        for (const item of items) {
          const price = parseTurkishPrice(item.priceText);
          if (!price || price <= 1000) continue;
          results.push({
            modelCode: item.modelCode,
            name: item.name || item.modelCode,
            price,
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          });
          pageAdded++;
        }
        console.log(`    Bosch ${cat}: ${pageAdded} accepted (${prevCount} on DOM)`);
      } catch {
        console.log(`  Bosch page scrape failed: ${url}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// Samsung TR category pages embed JSON-LD ItemList (capped at ~18 entries)
// and a React-rendered product grid. Read both: JSON-LD first (richest data),
// then DOM cards to capture anything beyond the JSON-LD truncation. Scroll to
// trigger lazy-loading before extracting.
async function scrapeSamsung(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    console.log("  Skipping Samsung scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "tr-TR,tr;q=0.9" },
  });
  await context.addCookies([
    { name: "country_codes", value: "tr", domain: ".samsung.com", path: "/" },
    { name: "country_region", value: "TR", domain: ".samsung.com", path: "/" },
  ]);

  try {
    for (const cat of SAMSUNG_CATEGORIES) {
      const url = `https://www.samsung.com/tr/${cat}/`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

        for (let i = 0; i < 12; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(500);
        }

        for (let i = 0; i < 8; i++) {
          const btn = page
            .locator(
              'button:has-text("Daha fazla"), button:has-text("Show more"), button:has-text("Daha Fazla")',
            )
            .first();
          const visible = await btn.isVisible().catch(() => false);
          if (!visible) break;
          await btn.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(900);
        }

        const items = await page.evaluate(() => {
          const out: { name: string; modelCode: string; priceText: string }[] = [];
          const seenSku = new Set<string>();

          document
            .querySelectorAll('script[type="application/ld+json"]')
            .forEach((el) => {
              try {
                const data = JSON.parse(el.textContent || "");
                if (
                  data["@type"] !== "ItemList" ||
                  !Array.isArray(data.itemListElement)
                )
                  return;
                for (const entry of data.itemListElement) {
                  const item = entry.item || entry;
                  const name = String(item.name || "").trim();
                  const rawPrice = item.offers?.price;
                  const priceText =
                    typeof rawPrice === "number"
                      ? String(rawPrice)
                      : String(rawPrice || "");
                  let modelCode = String(item.sku || item.productID || item.model || "");
                  if (!modelCode && item.url) {
                    const slug = String(item.url).split("/").filter(Boolean).pop() || "";
                    const codeMatch = slug.match(/[-]([a-z]{2}\d{2,}[a-z0-9]*)\/?$/i);
                    modelCode = codeMatch ? codeMatch[1].toUpperCase() : "";
                  }
                  if (!name || !priceText) continue;
                  const dedupeKey = (modelCode || name).toLowerCase();
                  if (seenSku.has(dedupeKey)) continue;
                  seenSku.add(dedupeKey);
                  out.push({
                    name,
                    modelCode: modelCode || name.slice(0, 30),
                    priceText,
                  });
                }
              } catch {
                // skip malformed JSON-LD blocks
              }
            });

          document
            .querySelectorAll(
              '[data-modelid], [data-model-code], .product-card-v2, .product__item, .product-list__item, .pd-comparison-card',
            )
            .forEach((el) => {
              const sku =
                el.getAttribute("data-modelid") ||
                el.getAttribute("data-model-code") ||
                el.getAttribute("data-pd-modelcode") ||
                "";
              const name =
                el
                  .querySelector(
                    '.product-card__title, .product__title, h3, .pd-comparison-card__title',
                  )
                  ?.textContent?.trim() || "";
              const priceText =
                el
                  .querySelector(
                    '.product-card__price, .product__price, .pd-comparison-card__price, [class*="price"]',
                  )
                  ?.textContent?.trim() || "";
              if (!sku || !name || !priceText) return;
              const dedupeKey = sku.toLowerCase();
              if (seenSku.has(dedupeKey)) return;
              seenSku.add(dedupeKey);
              out.push({ name, modelCode: sku, priceText });
            });

          return out;
        });

        let pageAdded = 0;
        for (const item of items) {
          let price: number | null = null;
          const directNum = parseFloat(item.priceText);
          if (!isNaN(directNum) && directNum > 1000) price = Math.round(directNum);
          if (price === null) price = extractFirstTurkishPrice(item.priceText);
          if (!price || price <= 1000) continue;
          results.push({
            modelCode: item.modelCode || item.name.slice(0, 30),
            name: item.name,
            price,
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          });
          pageAdded++;
        }
        console.log(`    Samsung ${cat}: ${pageAdded} accepted`);
      } catch {
        console.log(`  Samsung page scrape failed: ${url}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// MUST stay behaviorally identical to scrapeLG in
// artifacts/api-server/src/lib/scraper.ts. Uses console.log instead of logger.
async function scrapeLG(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    console.log("  Skipping LG scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
  });

  try {
    for (const cat of LG_CATEGORIES) {
      const url = `https://www.lg.com/tr/${cat}/`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page
          .waitForSelector("li.c-product-list__item", { timeout: 10000 })
          .catch(() => {});

        const productLocator = page.locator("li.c-product-list__item");
        let prevCount = 0;
        let stableScrolls = 0;
        for (let i = 0; i < 20; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(700);
          const count = await productLocator.count();
          if (count === prevCount) {
            stableScrolls++;
            if (stableScrolls >= 2) break;
          } else {
            stableScrolls = 0;
            prevCount = count;
          }
        }

        const items = await page.evaluate(() => {
          const out: { name: string; modelCode: string; priceText: string }[] = [];
          document.querySelectorAll("li.c-product-list__item").forEach((el) => {
            const sku =
              el.querySelector(".c-product-item__sku")?.textContent?.trim() || "";
            const topText =
              el.querySelector(".neo-card--top, .neo-card--default")?.textContent?.trim() || "";
            const name = topText
              .replace(sku, "")
              .replace(/Copy model name.*$/, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200);
            const priceText =
              // MUST use .cell-price specifically; the parent
              // .neo-price--price concatenates the discount badge, current
              // price, and strikethrough original into one text node which
              // would corrupt parseTurkishPrice. See scraper.ts for details.
              el.querySelector(".cell-price")?.textContent?.trim() || "";
            if (sku && priceText) out.push({ name: name || sku, modelCode: sku, priceText });
          });
          return out;
        });

        let pageAdded = 0;
        for (const item of items) {
          // TV cards glue a discount badge into .cell-price; use the
          // multi-price parser so we pick the current (sale) price, not the
          // bogus concatenation.
          const price = extractLGCurrentPrice(item.priceText);
          if (!price || price <= 1000) continue;
          results.push({
            modelCode: item.modelCode,
            name: item.name,
            price,
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          });
          pageAdded++;
        }
        console.log(`    LG ${cat}: ${pageAdded} accepted (${prevCount} on DOM)`);
      } catch {
        console.log(`  LG page scrape failed: ${url}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// MUST stay behaviorally identical to scrapeProfilo in
// artifacts/api-server/src/lib/scraper.ts. Uses console.log instead of logger.
async function scrapeProfilo(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    console.log("  Skipping Profilo scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
  });

  try {
    for (const cat of PROFILO_CATEGORIES) {
      const url = `https://www.profilo.com/tr/tr/category/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page
          .waitForSelector('[data-testid^="product-teaser-container-for-"]', { timeout: 10000 })
          .catch(() => {});

        const productLocator = page.locator(
          '[data-testid^="product-teaser-container-for-"]',
        );
        let prevCount = 0;
        let stableClicks = 0;
        for (let i = 0; i < 30; i++) {
          const btn = page
            .locator(
              'button:has-text("Daha fazla görüntüle"), button:has-text("Daha fazla"), [data-testid*="show-more"]',
            )
            .first();
          const visible = await btn.isVisible().catch(() => false);
          if (!visible) break;
          const beforeCount = await productLocator.count();
          await btn.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1200);
          const afterCount = await productLocator.count();
          if (afterCount === beforeCount) {
            stableClicks++;
            if (stableClicks >= 2) break;
          } else {
            stableClicks = 0;
            prevCount = afterCount;
          }
        }

        const items = await page.evaluate(() => {
          const out: { name: string; modelCode: string; priceText: string }[] = [];
          document
            .querySelectorAll('[data-testid^="product-teaser-container-for-"]')
            .forEach((el) => {
              const rawName =
                el
                  .querySelector('[data-testid="product-teaser-header-headline"]')
                  ?.textContent?.trim() || "";
              const name =
                rawName.includes("{") || rawName.includes("@media") ? "" : rawName;
              const modelCode =
                el.querySelector('[data-testid="product-code"]')?.textContent?.trim() || "";
              const priceText =
                el.querySelector('[data-testid="price-main-price"]')?.textContent?.trim() || "";
              if (modelCode && priceText) out.push({ name, modelCode, priceText });
            });
          return out;
        });

        let pageAdded = 0;
        for (const item of items) {
          const price = parseTurkishPrice(item.priceText);
          if (!price || price <= 1000) continue;
          results.push({
            modelCode: item.modelCode,
            name: item.name || item.modelCode,
            price,
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          });
          pageAdded++;
        }
        console.log(`    Profilo ${cat}: ${pageAdded} accepted (${prevCount} on DOM)`);
      } catch {
        console.log(`  Profilo page scrape failed: ${url}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// MUST stay behaviorally identical to scrapeGrundig in
// artifacts/api-server/src/lib/scraper.ts. Uses console.log instead of logger.
async function scrapeGrundig(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    console.log("  Skipping Grundig scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
  });

  try {
    for (const cat of GRUNDIG_CATEGORIES) {
      const url = `https://www.grundig.com.tr/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page
          .waitForSelector("article.prd.product-item", { timeout: 10000 })
          .catch(() => {});

        const productLocator = page.locator("article.prd.product-item");
        let prevCount = 0;
        let stableScrolls = 0;
        for (let i = 0; i < 20; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(700);
          const count = await productLocator.count();
          if (count === prevCount) {
            stableScrolls++;
            if (stableScrolls >= 2) break;
          } else {
            stableScrolls = 0;
            prevCount = count;
          }
        }

        const items = await page.evaluate(() => {
          const out: { name: string; modelCode: string; priceText: string; gtmPrice: string }[] = [];
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
              // missing/malformed gtm payload — fall back to DOM attrs
            }
            const codeAttr =
              el.querySelector("[data-product-code]")?.getAttribute("data-product-code") ||
              el.getAttribute("data-product-code") ||
              "";
            const nameAttr =
              el.querySelector("[data-product-name]")?.getAttribute("data-product-name") || "";
            const priceText =
              el.querySelector("span.prc.prc-last")?.textContent?.trim() ||
              el.querySelector(".prd-price, .prd-footer")?.textContent?.trim() ||
              "";
            const name = gtmName || nameAttr;
            const modelCode = gtmId || codeAttr;
            if (name && (priceText || gtmPrice)) out.push({ name, modelCode, priceText, gtmPrice });
          });
          return out;
        });

        let pageAdded = 0;
        for (const item of items) {
          let price: number | null = null;
          if (item.gtmPrice) {
            const n = parseFloat(item.gtmPrice);
            if (!isNaN(n) && n > 0) price = Math.round(n);
          }
          if (price === null) price = extractFirstTurkishPrice(item.priceText);
          if (!price || price <= 1000) continue;
          results.push({
            modelCode: item.modelCode || item.name.slice(0, 30),
            name: item.name,
            price,
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          });
          pageAdded++;
        }
        console.log(`    Grundig ${cat}: ${pageAdded} accepted (${prevCount} on DOM)`);
      } catch {
        console.log(`  Grundig page scrape failed: ${url}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// Siemens TR (siemens-home.bsh-group.com/tr) is a marketing-only site —
// no online catalog. Stub returns []; Siemens entries fall through to the
// Bosch (BSH-shared) match map.
async function scrapeSiemens(): Promise<ScrapedPrice[]> {
  console.log("  Siemens TR has no online catalog (marketing-only site) — returning []");
  return [];
}

// Electrolux/AEG TR (electrolux.com.tr, aeg.com.tr) are marketing-only
// sites — no online catalog. Stub returns []; competitor prices for
// Electrolux/AEG remain unmatched until the marketplace pipeline supplies them.
async function scrapeElectrolux(): Promise<ScrapedPrice[]> {
  console.log("  Electrolux/AEG TR have no online catalog (marketing-only sites) — returning []");
  return [];
}

type ScraperResults = {
  arcelik: ScrapedPrice[];
  beko: ScrapedPrice[];
  vestel: ScrapedPrice[];
  bosch: ScrapedPrice[];
  samsung: ScrapedPrice[];
  lg: ScrapedPrice[];
  siemens: ScrapedPrice[];
  profilo: ScrapedPrice[];
  electrolux: ScrapedPrice[];
  grundig: ScrapedPrice[];
};

async function runScrapers(): Promise<ScraperResults> {
  const scrapers = [
    { name: "arcelik.com.tr", fn: scrapeArcelik },
    { name: "beko.com.tr", fn: scrapeBeko },
    { name: "vestel.com.tr", fn: scrapeVestel },
    { name: "bosch-home.com.tr", fn: scrapeBosch },
    { name: "samsung.com/tr", fn: scrapeSamsung },
    { name: "lg.com/tr", fn: scrapeLG },
    { name: "siemens-home.bsh-group.com/tr", fn: scrapeSiemens },
    { name: "profilo.com", fn: scrapeProfilo },
    { name: "electrolux.com.tr", fn: scrapeElectrolux },
    { name: "grundig.com.tr", fn: scrapeGrundig },
  ] as const;

  const results: ScraperResults = {
    arcelik: [], beko: [], vestel: [], bosch: [], samsung: [],
    lg: [], siemens: [], profilo: [], electrolux: [], grundig: [],
  };
  const keys = [
    "arcelik", "beko", "vestel", "bosch", "samsung",
    "lg", "siemens", "profilo", "electrolux", "grundig",
  ] as const;

  // Run brand scrapers in pairs (concurrency=2) to keep RAM bounded under
  // the 10-minute cron budget while cutting wall time roughly in half.
  // Mirror of artifacts/api-server/src/lib/scraper.ts runScrapers logic.
  const CONCURRENCY = 2;
  for (let i = 0; i < scrapers.length; i += CONCURRENCY) {
    const batch = scrapers.slice(i, i + CONCURRENCY);
    for (const s of batch) console.log(`  Scraping ${s.name}...`);
    const settled = await Promise.allSettled(batch.map((s) => s.fn()));
    for (let j = 0; j < batch.length; j++) {
      const idx = i + j;
      const s = batch[j];
      const outcome = settled[j];
      if (outcome.status === "fulfilled") {
        results[keys[idx]] = outcome.value;
        console.log(`  ✓ ${s.name}: ${outcome.value.length} products found`);
      } else {
        const msg = outcome.reason instanceof Error ? outcome.reason.message : "unknown error";
        console.log(`  ✗ ${s.name}: scrape failed (${msg})`);
      }
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
  const grundigMap = new Map(scraped.grundig.map((s) => [normalizeModelKey(s.modelCode), s]));

  const matchedScrapedKeys = new Set<string>();

  for (const p of products) {
    const match =
      fuzzyMatchScraped(p.modelCode as string, arcelikMap) ??
      fuzzyMatchScraped(p.modelCode as string, bekoMap) ??
      fuzzyMatchScraped(p.modelCode as string, grundigMap);
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
  for (const [key, item] of grundigMap) {
    if (!matchedScrapedKeys.has(key)) unmatched.push(`grundig: ${item.name} (${item.modelCode})`);
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
  const lgMap = new Map(scraped.lg.map((s) => [normalizeModelKey(s.modelCode), s]));
  const profiloMap = new Map(scraped.profilo.map((s) => [normalizeModelKey(s.modelCode), s]));
  const electroluxMap = new Map(scraped.electrolux.map((s) => [normalizeModelKey(s.modelCode), s]));
  const productPriceMap = new Map(products.map((p) => [p.id as string, p.tsfPrice as number]));

  const matchedKeys = new Set<string>();

  for (const cp of competitors) {
    let match: ScrapedPrice | undefined;
    if (cp.brand === "Vestel" || cp.brand === "Regal")
      match = fuzzyMatchScraped(cp.competitorModel as string, vestelMap);
    else if (cp.brand === "Bosch")
      match = fuzzyMatchScraped(cp.competitorModel as string, boschMap);
    else if (cp.brand === "Profilo")
      match =
        fuzzyMatchScraped(cp.competitorModel as string, profiloMap) ??
        fuzzyMatchScraped(cp.competitorModel as string, boschMap);
    else if (cp.brand === "Siemens")
      // Siemens TR has no online catalog; fall through to BSH-shared maps.
      match =
        fuzzyMatchScraped(cp.competitorModel as string, boschMap) ??
        fuzzyMatchScraped(cp.competitorModel as string, profiloMap);
    else if (cp.brand === "Samsung")
      match = fuzzyMatchScraped(cp.competitorModel as string, samsungMap);
    else if (cp.brand === "LG")
      match = fuzzyMatchScraped(cp.competitorModel as string, lgMap);
    else if (cp.brand === "Electrolux/AEG" || cp.brand === "Electrolux" || cp.brand === "AEG")
      match = fuzzyMatchScraped(cp.competitorModel as string, electroluxMap);

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
  for (const [key, item] of lgMap) {
    if (!matchedKeys.has(key)) unmatched.push(`lg: ${item.name} (${item.modelCode})`);
  }
  for (const [key, item] of profiloMap) {
    if (!matchedKeys.has(key)) unmatched.push(`profilo: ${item.name} (${item.modelCode})`);
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
