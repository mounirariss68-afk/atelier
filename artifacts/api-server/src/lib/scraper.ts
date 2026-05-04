import * as cheerio from "cheerio";
import {
  db,
  arcelikProductsTable,
  arcelikCompetitorPricesTable,
  arcelikPriceHistoryTable,
  arcelikScrapeLogsTable,
  arcelikMarketplacePricesTable,
  arcelikMarketplacePriceHistoryTable,
  arcelikProductSpecsTable,
} from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { execSync } from "child_process";
import { logger } from "./logger";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { rebuildEquivalences } from "./matching";

interface ScrapedPrice {
  modelCode: string;
  name: string;
  price: number;
  sourceUrl: string;
  scrapedAt: string;
}

export interface ScrapedMarketplaceProduct {
  marketplace: string;
  marketplaceProductId: string;
  productUrl: string;
  brand: string;
  title: string;
  category: string;
  price: number;
  capacityLiters: number | null;
  capacityKg: number | null;
  energyClass: string | null;
  scrapedAt: string;
}

// Match keys are diacritic-stripped, lowercased; canonical names follow
const N11_BRAND_MAP: Array<{ keys: string[]; canonical: string }> = [
  { keys: ["arcelik", "arçelik"], canonical: "Arçelik" },
  { keys: ["beko"], canonical: "Beko" },
  { keys: ["bosch"], canonical: "Bosch" },
  { keys: ["siemens"], canonical: "Siemens" },
  { keys: ["profilo"], canonical: "Profilo" },
  { keys: ["samsung"], canonical: "Samsung" },
  { keys: ["vestel"], canonical: "Vestel" },
  { keys: ["regal"], canonical: "Regal" },
  { keys: ["grundig", "grundıg"], canonical: "Grundig" },
  { keys: ["lg"], canonical: "LG" },
  { keys: ["altus"], canonical: "Altus" },
  { keys: ["electrolux"], canonical: "Electrolux" },
  { keys: ["whirlpool"], canonical: "Whirlpool" },
  { keys: ["hotpoint"], canonical: "Hotpoint" },
  { keys: ["indesit"], canonical: "Indesit" },
  { keys: ["kumtel"], canonical: "Kumtel" },
  { keys: ["silverline"], canonical: "Silverline" },
  { keys: ["simfer"], canonical: "Simfer" },
  { keys: ["haier"], canonical: "Haier" },
  { keys: ["hoover"], canonical: "Hoover" },
  { keys: ["dijitsu"], canonical: "Dijitsu" },
  { keys: ["windsor"], canonical: "Windsor" },
  { keys: ["daewoo"], canonical: "Daewoo" },
];

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

function extractBrandFromTitle(title: string): string {
  const lower = normalizeForMatch(title.trim());
  for (const entry of N11_BRAND_MAP) {
    for (const key of entry.keys) {
      const k = normalizeForMatch(key);
      if (lower.startsWith(k + " ") || lower.startsWith(k + "-")) {
        return entry.canonical;
      }
    }
  }
  return title.trim().split(/\s+/)[0] || "Unknown";
}

function extractCapacityLitersFromTitle(title: string): number | null {
  const m = title.match(/\b(\d{2,4})\s*(?:lt|l\b|litre)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 50 && n <= 1200 ? n : null;
}

function extractCapacityKgFromTitle(title: string): number | null {
  const m = title.match(/\b(\d{1,2}(?:[.,]\d)?)\s*kg/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return n >= 1 && n <= 25 ? n : null;
}

function extractEnergyClassFromTitle(title: string): string | null {
  const m = title.match(/\b([A-G](?:\+{1,3})?)\s*(?:enerji|sınıf)/i);
  if (m) return m[1].toUpperCase();
  const m2 = title.match(/\b(A\+{0,3}|B|C|D|E|F|G)\s+enerji/i);
  if (m2) return m2[1].toUpperCase();
  return null;
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
  const coreTokens = tokens.filter((t) => /[a-z]\d{3,}|^\d{4,}/.test(t) && t.length >= 4);
  if (coreTokens.length === 0) return undefined;

  for (const [key, scraped] of scrapedMap) {
    if (coreTokens.some((ct) => key.includes(ct))) return scraped;
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
          const out: { name: string; priceText: string; modelCode: string; gtmPrice: string }[] = [];
          // Arçelik & Beko Hybris pattern: article.prd.product-item with data-gtm-impression JSON
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
              // gtm JSON missing or malformed — fall back to attribute lookup below
            }
            const codeAttr =
              el.querySelector("[data-product-code]")?.getAttribute("data-product-code") ||
              el.getAttribute("data-product-code") ||
              "";
            const nameAttr =
              el.querySelector("[data-product-name]")?.getAttribute("data-product-name") ||
              "";
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
          // Fallback: generic product-card / product-item layouts (Vestel-like sites if used via Playwright)
          if (out.length === 0) {
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
                const modelCode = el.getAttribute("data-product-id") || "";
                if (name && priceText) out.push({ name, priceText, modelCode, gtmPrice: "" });
              });
          }
          return out;
        });

        for (const item of items) {
          // Prefer numeric gtm price ("71999.00") over rendered text ("71.999 TL")
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

async function scrapeN11(): Promise<ScrapedMarketplaceProduct[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping N11 scrape (Playwright not available)");
    return [];
  }

  // maxPages is an upper bound; the inner loop terminates early once a page
  // yields no new product IDs (true catalog-exhaustion termination, see
  // `pageAdded === 0` check below). Set high enough that the cap is rarely
  // hit before exhaustion under normal N11 catalog sizes.
  const categoryDefs = [
    { slug: "buzdolabi", category: "buzdolabi", maxPages: 15 },
    { slug: "camasir-makinesi", category: "camasir", maxPages: 15 },
    { slug: "bulasik-makinesi", category: "bulasik", maxPages: 12 },
    { slug: "firin", category: "firin", maxPages: 12 },
    { slug: "klima", category: "klima", maxPages: 12 },
    { slug: "kurutma-makinesi", category: "kurutma", maxPages: 8 },
    { slug: "kucuk-ev-aletleri", category: "kucuk-ev", maxPages: 12 },
  ];

  const results: ScrapedMarketplaceProduct[] = [];
  const seenIds = new Set<string>();

  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
  });

  try {
    for (const def of categoryDefs) {
      for (let pg = 1; pg <= def.maxPages; pg++) {
        const url =
          pg === 1
            ? `https://www.n11.com/beyaz-esya/${def.slug}`
            : `https://www.n11.com/beyaz-esya/${def.slug}?pg=${pg}`;
        const page: Page = await context.newPage();
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          // N11 uses Vue, products render after networkidle + scroll
          await page
            .waitForSelector("a.product-item[data-prod-id]", { timeout: 12000 })
            .catch(() => {});
          await page.evaluate(async () => {
            for (let i = 0; i < 6; i++) {
              window.scrollBy(0, 900);
              await new Promise((r) => setTimeout(r, 250));
            }
          });
          await page.waitForTimeout(800);

          const items = await page.evaluate(() => {
            const out: {
              id: string;
              href: string;
              title: string;
              priceText: string;
            }[] = [];
            document
              .querySelectorAll("a.product-item[data-prod-id]")
              .forEach((el) => {
                const id = el.getAttribute("data-prod-id") || "";
                const href = (el as HTMLAnchorElement).href || "";
                const title =
                  el
                    .querySelector(".product-item-title")
                    ?.textContent?.trim() || "";
                const priceText =
                  el
                    .querySelector(".basket-price .price-currency")
                    ?.textContent?.trim() ||
                  el
                    .querySelector(".price-currency")
                    ?.textContent?.trim() ||
                  "";
                if (id && title && priceText) {
                  out.push({ id, href, title, priceText });
                }
              });
            return out;
          });

          let pageAdded = 0;
          for (const it of items) {
            if (seenIds.has(it.id)) continue;
            const price = parseTurkishPrice(it.priceText);
            if (!price || price < 500) continue;
            seenIds.add(it.id);
            results.push({
              marketplace: "n11",
              marketplaceProductId: it.id,
              productUrl: it.href,
              brand: extractBrandFromTitle(it.title),
              title: it.title,
              category: def.category,
              price,
              capacityLiters: extractCapacityLitersFromTitle(it.title),
              capacityKg: extractCapacityKgFromTitle(it.title),
              energyClass: extractEnergyClassFromTitle(it.title),
              scrapedAt: new Date().toISOString(),
            });
            pageAdded++;
          }
          logger.info(
            { url, pageAdded, totalSoFar: results.length },
            "N11 page scraped",
          );
          // Stop pagination when a page yields nothing new
          if (pageAdded === 0 && pg > 1) break;
        } catch (err) {
          logger.warn({ url, err }, "N11 page scrape failed");
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await context.close();
  }

  return results;
}

async function scrapeTrendyol(): Promise<ScrapedMarketplaceProduct[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping Trendyol scrape (Playwright not available)");
    return [];
  }

  // Trendyol blocks legacy category slugs; the search endpoint is open and
  // stable, returns ~24 sponsored+organic cards per page, and is the same path
  // used by their iOS/Android apps. maxPages is an upper bound; the inner loop
  // terminates early once a page returns no new product IDs (true catalog
  // exhaustion via the `pageAdded === 0` check below).
  const categoryDefs = [
    { query: "buzdolabi", category: "buzdolabi", maxPages: 12 },
    { query: "camasir makinesi", category: "camasir", maxPages: 12 },
    { query: "bulasik makinesi", category: "bulasik", maxPages: 10 },
    { query: "ankastre firin", category: "firin", maxPages: 10 },
    { query: "klima", category: "klima", maxPages: 10 },
    { query: "kurutma makinesi", category: "kurutma", maxPages: 8 },
    { query: "kucuk ev aletleri", category: "kucuk-ev", maxPages: 8 },
  ];

  // Per-category title keyword gate. Trendyol search returns broad results
  // (sponsored/cross-sell/accessories), so require at least one category-
  // specific keyword in the listing title before accepting it.
  const TITLE_KEYWORDS: Record<string, string[]> = {
    buzdolabi: ["buzdolab", "no frost", "no-frost", "kombi dolap", "side by side"],
    camasir: ["camasir makinesi", "camaşır makines", "camasir mak"],
    bulasik: ["bulasik makinesi", "bulaşık makines", "bulasik mak"],
    firin: ["firin", "fırın", "ankastre", "ocak", "set ustu", "set üstü"],
    klima: ["klima", "split", "btu"],
    kurutma: ["kurutma makinesi", "kurutucu"],
    "kucuk-ev": [],
  };
  const titleMatchesCategory = (title: string, category: string): boolean => {
    const kws = TITLE_KEYWORDS[category];
    if (!kws || kws.length === 0) return true;
    const norm = title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i");
    return kws.some((kw) => norm.includes(kw));
  };

  const results: ScrapedMarketplaceProduct[] = [];
  const seenIds = new Set<string>();

  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: {
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    },
  });

  try {
    for (const def of categoryDefs) {
      for (let pg = 1; pg <= def.maxPages; pg++) {
        const q = encodeURIComponent(def.query);
        const url =
          pg === 1
            ? `https://www.trendyol.com/sr?q=${q}&os=1`
            : `https://www.trendyol.com/sr?q=${q}&os=1&pi=${pg}`;
        const page: Page = await context.newPage();
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await page
            .waitForSelector("a.product-card[id]", { timeout: 12000 })
            .catch(() => {});
          await page.evaluate(async () => {
            for (let i = 0; i < 6; i++) {
              window.scrollBy(0, 900);
              await new Promise((r) => setTimeout(r, 250));
            }
          });
          await page.waitForTimeout(800);

          const items = await page.evaluate(() => {
            const out: {
              id: string;
              href: string;
              title: string;
              priceText: string;
            }[] = [];
            document
              .querySelectorAll('a.product-card[id], a[data-testid="product-card"]')
              .forEach((el) => {
                const id =
                  el.getAttribute("id") ||
                  el.getAttribute("data-id") ||
                  "";
                const href = (el as HTMLAnchorElement).href || "";
                // Prefer descriptive title from the brand+name block; fall back
                // to the full innerText for parsing.
                const allText = (el as HTMLElement).innerText || "";
                const lines = allText
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(
                    (l) =>
                      l.length > 0 &&
                      !/^\d+(\.\d+)?$/.test(l) && // ratings
                      !l.startsWith("(") &&
                      !/Kargo|İndirim|Fenomen|En Çok|Günün|Bedava|Sepette|Kampanyalı|🚛/i.test(
                        l,
                      ),
                  );
                const title = lines[0] || "";
                // Pull last "X TL" or "X.YYY TL" occurrence (final price after discounts)
                const tlMatches = allText.match(/[\d.,]+\s*TL/g) || [];
                const priceText = tlMatches[tlMatches.length - 1] || "";
                if (id && title && priceText) {
                  out.push({ id, href, title, priceText });
                }
              });
            return out;
          });

          let pageAdded = 0;
          for (const it of items) {
            if (seenIds.has(it.id)) continue;
            if (!titleMatchesCategory(it.title, def.category)) continue;
            const price = parseTurkishPrice(it.priceText);
            if (!price || price < 500) continue;
            seenIds.add(it.id);
            results.push({
              marketplace: "trendyol",
              marketplaceProductId: it.id,
              productUrl: it.href,
              brand: extractBrandFromTitle(it.title),
              title: it.title,
              category: def.category,
              price,
              capacityLiters: extractCapacityLitersFromTitle(it.title),
              capacityKg: extractCapacityKgFromTitle(it.title),
              energyClass: extractEnergyClassFromTitle(it.title),
              scrapedAt: new Date().toISOString(),
            });
            pageAdded++;
          }
          logger.info(
            { url, pageAdded, totalSoFar: results.length },
            "Trendyol page scraped",
          );
          if (pageAdded === 0 && pg > 1) break;
        } catch (err) {
          logger.warn({ url, err }, "Trendyol page scrape failed");
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await context.close();
  }

  return results;
}

interface ScrapedSpecRow {
  marketplace: string;
  marketplaceProductId: string;
  capacityLiters: number | null;
  capacityKg: number | null;
  energyClass: string | null;
  productType: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  noiseLevelDb: number | null;
  spinRpm: number | null;
  rawSpecs: Record<string, string>;
}

function parseSpecNumber(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseSpecRow(
  rawSpecs: Record<string, string>,
): Omit<ScrapedSpecRow, "marketplace" | "marketplaceProductId"> {
  // N11 spec keys are Turkish; normalize to lookup
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .trim();
  const lookup: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawSpecs)) lookup[norm(k)] = v;

  const get = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = lookup[norm(k)];
      if (v) return v;
    }
    return undefined;
  };

  const cap = get("toplam kapasite", "kapasite", "net hacim");
  let capacityLiters: number | null = null;
  let capacityKg: number | null = null;
  if (cap) {
    if (/kg/i.test(cap)) {
      const n = parseSpecNumber(cap);
      if (n !== null && n >= 1 && n <= 25) capacityKg = n;
    } else {
      const n = parseSpecNumber(cap);
      if (n !== null && n >= 30 && n <= 1500) capacityLiters = Math.round(n);
    }
  }

  const energyRaw = get("enerji sinifi", "enerji sınıfı", "enerji");
  let energyClass: string | null = null;
  if (energyRaw) {
    const m = energyRaw.toUpperCase().match(/\b([A-G][+]{0,3})\b/);
    if (m) energyClass = m[1];
  }

  const productType = get("urun tipi", "ürün tipi", "tip", "tür") || null;

  const width = get("genislik", "genişlik");
  const height = get("yukseklik", "yükseklik");
  const depth = get("derinlik");
  const noise = get("ses seviyesi", "ses seviyesi (dba)", "ses");
  const rpm = get("devir sayisi", "devir sayısı", "sıkma devri", "sikma devri");

  return {
    capacityLiters,
    capacityKg,
    energyClass,
    productType,
    widthCm: width ? parseSpecNumber(width) : null,
    heightCm: height ? parseSpecNumber(height) : null,
    depthCm: depth ? parseSpecNumber(depth) : null,
    noiseLevelDb: noise
      ? (() => {
          const n = parseSpecNumber(noise);
          return n !== null && n >= 10 && n <= 100 ? Math.round(n) : null;
        })()
      : null,
    spinRpm: rpm
      ? (() => {
          const n = parseSpecNumber(rpm);
          return n !== null && n >= 200 && n <= 2500 ? Math.round(n) : null;
        })()
      : null,
    rawSpecs,
  };
}

async function scrapeN11ProductSpecs(
  productUrls: { marketplaceProductId: string; productUrl: string }[],
  maxProducts = 60,
): Promise<ScrapedSpecRow[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping N11 spec extraction (Playwright not available)");
    return [];
  }
  if (productUrls.length === 0) return [];

  const targets = productUrls.slice(0, maxProducts);
  const results: ScrapedSpecRow[] = [];

  const context: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
  });

  try {
    for (const target of targets) {
      const page: Page = await context.newPage();
      try {
        await page.goto(target.productUrl, {
          waitUntil: "domcontentloaded",
          timeout: 25000,
        });
        await page
          .waitForSelector(".attribute-list .attribute-item", { timeout: 8000 })
          .catch(() => {});
        await page.evaluate(async () => {
          for (let i = 0; i < 6; i++) {
            window.scrollBy(0, 900);
            await new Promise((r) => setTimeout(r, 200));
          }
        });
        await page.waitForTimeout(400);

        const rawSpecs = await page.evaluate(() => {
          const out: Record<string, string> = {};
          document
            .querySelectorAll(".attribute-list .attribute-item")
            .forEach((li) => {
              const k = li
                .querySelector(".attribute-key")
                ?.textContent?.trim();
              const v = li
                .querySelector(".attribute-val span, .attribute-val")
                ?.textContent?.trim();
              if (k && v) out[k] = v;
            });
          return out;
        });

        if (Object.keys(rawSpecs).length > 0) {
          results.push({
            marketplace: "n11",
            marketplaceProductId: target.marketplaceProductId,
            ...parseSpecRow(rawSpecs),
          });
        }
      } catch (err) {
        logger.warn(
          { url: target.productUrl, err },
          "N11 spec extraction failed for product",
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  logger.info(
    { extracted: results.length, attempted: targets.length },
    "N11 spec extraction completed",
  );
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

    let n11Items: ScrapedMarketplaceProduct[] = [];
    try {
      logger.info("Scraping n11.com (marketplace)...");
      n11Items = await scrapeN11();
      scrapedCounts.n11 = n11Items.length;
      logger.info({ count: n11Items.length }, "n11.com: marketplace products scraped");

      const n11ByCat = new Map<string, number>();
      for (const it of n11Items) {
        n11ByCat.set(it.category, (n11ByCat.get(it.category) ?? 0) + 1);
      }
      const n11ExpectedCats = ["buzdolabi", "camasir", "bulasik", "firin", "klima", "kurutma", "kucuk-ev"];
      const n11Empty = n11ExpectedCats.filter((c) => (n11ByCat.get(c) ?? 0) === 0);
      if (n11Empty.length > 0) {
        logger.warn(
          { emptyCategories: n11Empty, perCategory: Object.fromEntries(n11ByCat) },
          "N11 category drift: one or more expected categories returned 0 items — selectors may have changed",
        );
      }
    } catch (err) {
      logger.error({ err }, "n11.com: scrape failed");
      scrapedCounts.n11 = 0;
    }

    let trendyolItems: ScrapedMarketplaceProduct[] = [];
    try {
      logger.info("Scraping trendyol.com (marketplace)...");
      trendyolItems = await scrapeTrendyol();
      scrapedCounts.trendyol = trendyolItems.length;

      const tyByCat = new Map<string, number>();
      for (const it of trendyolItems) {
        tyByCat.set(it.category, (tyByCat.get(it.category) ?? 0) + 1);
      }
      const tyExpectedCats = ["buzdolabi", "camasir", "bulasik", "firin", "klima", "kurutma", "kucuk-ev"];
      const tyEmpty = tyExpectedCats.filter((c) => (tyByCat.get(c) ?? 0) === 0);
      if (tyEmpty.length > 0) {
        logger.warn(
          { emptyCategories: tyEmpty, perCategory: Object.fromEntries(tyByCat) },
          "Trendyol category drift: one or more expected categories returned 0 items — selectors may have changed",
        );
      }
      logger.info(
        { count: trendyolItems.length },
        "trendyol.com: marketplace products scraped",
      );
    } catch (err) {
      logger.error({ err }, "trendyol.com: scrape failed");
      scrapedCounts.trendyol = 0;
    }

    const marketplaceItems: ScrapedMarketplaceProduct[] = [
      ...n11Items,
      ...trendyolItems,
    ];

    if (marketplaceItems.length > 0) {
      const insertRows = marketplaceItems.map((it) => ({
        marketplace: it.marketplace,
        marketplaceProductId: it.marketplaceProductId,
        productUrl: it.productUrl,
        brand: it.brand,
        title: it.title,
        category: it.category,
        price: it.price,
        capacityLiters: it.capacityLiters,
        capacityKg: it.capacityKg,
        energyClass: it.energyClass,
        scrapeRunId: runId,
        scrapedAt: new Date(it.scrapedAt),
      }));
      // Batch insert in chunks to avoid parameter limits, upserting on the
      // unique (marketplace, marketplaceProductId) index so repeated scrapes
      // refresh prices instead of accumulating duplicates.
      for (let i = 0; i < insertRows.length; i += 100) {
        await db
          .insert(arcelikMarketplacePricesTable)
          .values(insertRows.slice(i, i + 100))
          .onConflictDoUpdate({
            target: [
              arcelikMarketplacePricesTable.marketplace,
              arcelikMarketplacePricesTable.marketplaceProductId,
            ],
            set: {
              productUrl: sql`excluded.product_url`,
              brand: sql`excluded.brand`,
              title: sql`excluded.title`,
              category: sql`excluded.category`,
              price: sql`excluded.price`,
              capacityLiters: sql`excluded.capacity_liters`,
              capacityKg: sql`excluded.capacity_kg`,
              energyClass: sql`excluded.energy_class`,
              scrapeRunId: sql`excluded.scrape_run_id`,
              scrapedAt: sql`excluded.scraped_at`,
            },
          });
      }
      logger.info(
        { inserted: insertRows.length, n11: n11Items.length, trendyol: trendyolItems.length },
        "Marketplace prices stored",
      );

      // Append-only per-source price history.
      try {
        const previousByKey = new Map<string, number>();
        const byMarketplace = new Map<string, string[]>();
        for (const r of insertRows) {
          const arr = byMarketplace.get(r.marketplace) ?? [];
          arr.push(r.marketplaceProductId);
          byMarketplace.set(r.marketplace, arr);
        }
        for (const [marketplace, mpIds] of byMarketplace) {
          for (let i = 0; i < mpIds.length; i += 200) {
            const slice = mpIds.slice(i, i + 200);
            const prevRows = await db
              .select({
                marketplaceProductId:
                  arcelikMarketplacePriceHistoryTable.marketplaceProductId,
                price: arcelikMarketplacePriceHistoryTable.price,
                recordedAt: arcelikMarketplacePriceHistoryTable.recordedAt,
              })
              .from(arcelikMarketplacePriceHistoryTable)
              .where(
                and(
                  eq(arcelikMarketplacePriceHistoryTable.marketplace, marketplace),
                  inArray(
                    arcelikMarketplacePriceHistoryTable.marketplaceProductId,
                    slice,
                  ),
                ),
              )
              .orderBy(sql`${arcelikMarketplacePriceHistoryTable.recordedAt} DESC`);
            for (const r of prevRows) {
              const k = `${marketplace}:${r.marketplaceProductId}`;
              if (!previousByKey.has(k)) previousByKey.set(k, r.price);
            }
          }
        }

        const historyRows = insertRows.map((r) => {
          const k = `${r.marketplace}:${r.marketplaceProductId}`;
          const prev = previousByKey.get(k) ?? null;
          const pct =
            prev && prev > 0
              ? Math.round(((r.price - prev) / prev) * 1000) / 10
              : null;
          return {
            marketplace: r.marketplace,
            marketplaceProductId: r.marketplaceProductId,
            brand: r.brand,
            category: r.category,
            price: r.price,
            previousPrice: prev,
            priceChangePercent: pct,
            scrapeRunId: runId,
            recordedAt: r.scrapedAt,
          };
        });
        for (let i = 0; i < historyRows.length; i += 200) {
          await db
            .insert(arcelikMarketplacePriceHistoryTable)
            .values(historyRows.slice(i, i + 200));
        }
        const changedCount = historyRows.filter(
          (h) => h.priceChangePercent !== null && Math.abs(h.priceChangePercent) >= 0.1,
        ).length;
        scrapedCounts.marketplaceHistory = historyRows.length;
        logger.info(
          { recorded: historyRows.length, withChange: changedCount },
          "Marketplace price history recorded",
        );
      } catch (err) {
        logger.error({ err }, "Failed to record marketplace price history");
      }
    }

    // Cap PDP scrapes per run; prioritize uncovered/oldest first.
    const SPEC_CAP_PER_RUN = 250;
    let specsExtracted = 0;
    if (n11Items.length > 0) {
      try {
        const existingSpecRows = await db
          .select({
            marketplaceProductId: arcelikProductSpecsTable.marketplaceProductId,
            extractedAt: arcelikProductSpecsTable.extractedAt,
          })
          .from(arcelikProductSpecsTable)
          .where(eq(arcelikProductSpecsTable.marketplace, "n11"));
        const existingSpecMap = new Map(
          existingSpecRows.map((r) => [
            r.marketplaceProductId,
            r.extractedAt?.getTime() ?? 0,
          ]),
        );
        const ARCELIK_FAMILY = new Set([
          "arcelik",
          "arçelik",
          "beko",
          "grundig",
          "altus",
        ]);
        const isArcelikFamily = (brand: string): boolean =>
          ARCELIK_FAMILY.has(
            brand
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/ı/g, "i")
              .trim(),
          );
        const eligible = n11Items
          .filter((it) => it.productUrl)
          .map((it) => ({
            it,
            extractedAt:
              existingSpecMap.get(it.marketplaceProductId) ?? -1,
            arcelikFamily: isArcelikFamily(it.brand),
          }))
          // Sort: Arcelik-family first (calibrates pricing baseline),
          // then uncovered (extractedAt = -1), then oldest-extracted.
          .sort((a, b) => {
            if (a.arcelikFamily !== b.arcelikFamily) {
              return a.arcelikFamily ? -1 : 1;
            }
            return a.extractedAt - b.extractedAt;
          });
        const targets = eligible
          .slice(0, SPEC_CAP_PER_RUN)
          .map((e) => ({
            marketplaceProductId: e.it.marketplaceProductId,
            productUrl: e.it.productUrl,
          }));
        const newCount = eligible.filter((e) => e.extractedAt < 0).length;
        logger.info(
          {
            cap: SPEC_CAP_PER_RUN,
            queued: targets.length,
            uncoveredInQueue: Math.min(newCount, SPEC_CAP_PER_RUN),
            totalUncovered: newCount,
          },
          "Queuing N11 PDPs for spec extraction (uncovered prioritized)",
        );
        const specs = await scrapeN11ProductSpecs(targets, SPEC_CAP_PER_RUN);
        if (specs.length > 0) {
          const specMpIds = Array.from(
            new Set(specs.map((s) => s.marketplaceProductId)),
          );
          const ids = specMpIds.length === 0
            ? []
            : await db
                .select({
                  id: arcelikMarketplacePricesTable.id,
                  marketplace: arcelikMarketplacePricesTable.marketplace,
                  marketplaceProductId:
                    arcelikMarketplacePricesTable.marketplaceProductId,
                })
                .from(arcelikMarketplacePricesTable)
                .where(
                  and(
                    eq(arcelikMarketplacePricesTable.marketplace, "n11"),
                    inArray(
                      arcelikMarketplacePricesTable.marketplaceProductId,
                      specMpIds,
                    ),
                  ),
                );
          const idMap = new Map(
            ids.map((r) => [`${r.marketplace}:${r.marketplaceProductId}`, r.id]),
          );
          const specRows = specs
            .map((s) => {
              const fk = idMap.get(`${s.marketplace}:${s.marketplaceProductId}`);
              if (!fk) return null;
              return {
                marketplacePriceId: fk,
                marketplace: s.marketplace,
                marketplaceProductId: s.marketplaceProductId,
                capacityLiters: s.capacityLiters,
                capacityKg: s.capacityKg,
                energyClass: s.energyClass,
                productType: s.productType,
                widthCm: s.widthCm,
                heightCm: s.heightCm,
                depthCm: s.depthCm,
                noiseLevelDb: s.noiseLevelDb,
                spinRpm: s.spinRpm,
                rawSpecs: s.rawSpecs,
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);
          for (let i = 0; i < specRows.length; i += 50) {
            await db
              .insert(arcelikProductSpecsTable)
              .values(specRows.slice(i, i + 50))
              .onConflictDoUpdate({
                target: [
                  arcelikProductSpecsTable.marketplace,
                  arcelikProductSpecsTable.marketplaceProductId,
                ],
                set: {
                  marketplacePriceId: sql`excluded.marketplace_price_id`,
                  capacityLiters: sql`excluded.capacity_liters`,
                  capacityKg: sql`excluded.capacity_kg`,
                  energyClass: sql`excluded.energy_class`,
                  productType: sql`excluded.product_type`,
                  widthCm: sql`excluded.width_cm`,
                  heightCm: sql`excluded.height_cm`,
                  depthCm: sql`excluded.depth_cm`,
                  noiseLevelDb: sql`excluded.noise_level_db`,
                  spinRpm: sql`excluded.spin_rpm`,
                  rawSpecs: sql`excluded.raw_specs`,
                  extractedAt: sql`now()`,
                },
              });
          }
          specsExtracted = specRows.length;
          scrapedCounts.specs = specsExtracted;
        }
      } catch (err) {
        logger.error({ err }, "N11 spec extraction failed");
      }
    }

    const totalScraped =
      Object.values(scrapedCounts).reduce((s, n) => s + n, 0);
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

    function buildEnhancedMap(items: ScrapedPrice[]): Map<string, ScrapedPrice> {
      const map = new Map<string, ScrapedPrice>();
      for (const s of items) {
        map.set(normalizeModelKey(s.modelCode), s);
        const parts = s.name.split(/\s+/);
        for (let i = 0; i < parts.length; i++) {
          for (let len = 1; len <= 4 && i + len <= parts.length; len++) {
            const combo = parts.slice(i, i + len).join(" ");
            const key = normalizeModelKey(combo);
            if (key.length >= 4 && /[a-z]/.test(key) && /\d/.test(key) && !map.has(key)) {
              map.set(key, s);
            }
          }
        }
      }
      return map;
    }

    const vestelMap = buildEnhancedMap(scraped.vestel);
    const boschMap = buildEnhancedMap(scraped.bosch);
    const samsungMap = buildEnhancedMap(scraped.samsung);

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

    if (unmatchedCompetitors > 0) {
      logger.warn(
        { unmatchedCompetitors, totalCompetitors: existingCompetitors.length },
        "Some competitor entries had no scraped match (baseline model codes may need updating)",
      );
    }

    // Only rebuild equivalences when the marketplace scrape produced data this
    // run; otherwise we'd churn equivalences against stale data.
    let equivalencesCreated = 0;
    if (marketplaceItems.length > 0) {
      try {
        const equivResult = await rebuildEquivalences(runId);
        equivalencesCreated = equivResult.created;
        scrapedCounts.equivalences = equivalencesCreated;
        logger.info(
          equivResult,
          "Cross-brand equivalences rebuilt from marketplace data",
        );

        const backfill = await db.execute(sql`
          UPDATE ${arcelikMarketplacePriceHistoryTable} h
          SET arcelik_product_id = mp.arcelik_product_id
          FROM ${arcelikMarketplacePricesTable} mp
          WHERE h.scrape_run_id = ${runId}
            AND mp.marketplace = h.marketplace
            AND mp.marketplace_product_id = h.marketplace_product_id
            AND mp.arcelik_product_id IS NOT NULL
        `);
        logger.info(
          { runId, updated: (backfill as { rowCount?: number }).rowCount ?? 0 },
          "Backfilled arcelikProductId on marketplace price history",
        );
      } catch (err) {
        logger.error({ err }, "Failed to rebuild cross-brand equivalences");
      }
    } else {
      logger.warn(
        "Skipping equivalence rebuild — N11 scrape returned no items this run",
      );
    }

    // Persist the final telemetry AFTER the equivalence rebuild so the
    // scrape_logs row reflects equivalences created in this run.
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
    try {
      await closePlaywrightBrowser();
    } catch (err) {
      logger.warn({ err }, "Failed to close Playwright browser cleanly");
    }
    scrapeInProgress = false;
  }
}
