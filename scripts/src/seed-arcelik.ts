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
import { resolve } from "path";

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

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
  const categories = ["buzdolabi", "camasir-makinesi", "bulasik-makinesi", "ankastre-firinlar", "klima"];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.arcelik.com.tr/${cat}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $('[data-product-id], .product-card, .product-item').each((_, el) => {
      const name = $(el).find('.product-name, .product-title, h3, h2').first().text().trim();
      const priceText = $(el).find('.product-price, .price, [data-price]').first().text().trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        const modelMatch = name.match(/\b(\d{3,5}\s*[A-Z]{1,4}(?:\s+\w+)?)\b/);
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
    $('[data-product], .product-card, .product-tile').each((_, el) => {
      const name = $(el).find('.product-name, .product-title, h3').first().text().trim();
      const priceText = $(el).find('.product-price, .price, .sale-price').first().text().trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        results.push({
          modelCode: name.split(" ").slice(1, 4).join(" ").trim() || name.slice(0, 20),
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
  const categories = ["beyaz-esya/buzdolabi", "beyaz-esya/camasir-makinesi", "beyaz-esya/bulasik-makinesi"];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.vestel.com.tr/${cat}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $('.product-card, .product-item, [data-product-id]').each((_, el) => {
      const name = $(el).find('.product-name, .product-title, h3').first().text().trim();
      const priceText = $(el).find('.product-price, .price, .current-price').first().text().trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        results.push({
          modelCode: name.split(" ").slice(1, 3).join(" ").trim() || name.slice(0, 20),
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
  const categories = ["urun-listeleme/buzdolaplari", "urun-listeleme/camasir-makineleri", "urun-listeleme/bulasik-makineleri"];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.bosch-home.com.tr/${cat}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $('.product-tile, .product-card, [data-product]').each((_, el) => {
      const name = $(el).find('.product-name, .product-title, h3').first().text().trim();
      const priceText = $(el).find('.product-price, .price, .current-price').first().text().trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        results.push({
          modelCode: name.split(" ").slice(0, 3).join(" ").trim() || name.slice(0, 20),
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
  const categories = ["home-appliances/refrigerators/all-refrigerators", "home-appliances/washing-machines/all-washing-machines", "home-appliances/dishwashers/all-dishwashers"];
  const results: ScrapedPrice[] = [];
  for (const cat of categories) {
    const html = await fetchPage(`https://www.samsung.com/tr/${cat}/`);
    if (!html) continue;
    const $ = cheerio.load(html);
    $('.product-card, [data-product-id], .product-card__item').each((_, el) => {
      const name = $(el).find('.product-card__name, .product-title, h3').first().text().trim();
      const priceText = $(el).find('.product-card__price, .price, [data-price]').first().text().trim();
      const price = parseTurkishPrice(priceText);
      if (name && price && price > 1000) {
        results.push({
          modelCode: name.split(" ").slice(0, 3).join(" ").trim() || name.slice(0, 20),
          name,
          price,
          sourceUrl: `https://www.samsung.com/tr/${cat}/`,
          scrapedAt: new Date().toISOString(),
        });
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
  return results;
}

function applyScrapedPrices(
  products: Array<Record<string, unknown>>,
  scraped: ScraperResults,
): { updated: number; unmatched: string[] } {
  const today = new Date().toISOString().split("T")[0];
  let updated = 0;
  const unmatched: string[] = [];

  const arcelikMap = new Map(scraped.arcelik.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));
  const bekoMap = new Map(scraped.beko.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));

  const matchedScrapedKeys = new Set<string>();

  for (const p of products) {
    const key = (p.modelCode as string).toLowerCase().replace(/\s+/g, "");
    const match = arcelikMap.get(key) ?? bekoMap.get(key);
    if (match) {
      p.tsfPrice = match.price;
      p.dealerCost = Math.round(match.price * (1 - (p.marginPercent as number) / 100));
      p.priceDate = today;
      p.dataProvenance = "auto-scraped";
      p.scrapedAt = match.scrapedAt;
      matchedScrapedKeys.add(key);
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

  const vestelMap = new Map(scraped.vestel.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));
  const boschMap = new Map(scraped.bosch.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));
  const samsungMap = new Map(scraped.samsung.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));
  const productPriceMap = new Map(products.map((p) => [p.id as string, p.tsfPrice as number]));

  const matchedKeys = new Set<string>();

  for (const cp of competitors) {
    const key = (cp.competitorModel as string).split(" ").slice(0, 2).join("").toLowerCase();
    let match: ScrapedPrice | undefined;
    if (cp.brand === "Vestel" || cp.brand === "Regal") match = vestelMap.get(key);
    else if (cp.brand === "Bosch" || cp.brand === "Siemens" || cp.brand === "Profilo") match = boschMap.get(key);
    else if (cp.brand === "Samsung") match = samsungMap.get(key);

    if (match) {
      cp.competitorPrice = match.price;
      cp.priceDate = today;
      cp.dataProvenance = "auto-scraped";
      cp.scrapedAt = match.scrapedAt;
      matchedKeys.add(key);
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
