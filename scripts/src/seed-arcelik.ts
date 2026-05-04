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

const DRY_RUN = process.argv.includes("--dry-run");
const NO_SCRAPE = process.argv.includes("--no-scrape");

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

async function runScrapers(): Promise<{
  arcelik: ScrapedPrice[];
  beko: ScrapedPrice[];
  vestel: ScrapedPrice[];
  bosch: ScrapedPrice[];
  samsung: ScrapedPrice[];
}> {
  const scrapers = [
    { name: "arcelik.com.tr", fn: scrapeArcelik },
    { name: "beko.com.tr", fn: scrapeBeko },
    { name: "vestel.com.tr", fn: scrapeVestel },
    { name: "bosch-home.com.tr", fn: scrapeBosch },
    { name: "samsung.com/tr", fn: scrapeSamsung },
  ] as const;

  const results = { arcelik: [] as ScrapedPrice[], beko: [] as ScrapedPrice[], vestel: [] as ScrapedPrice[], bosch: [] as ScrapedPrice[], samsung: [] as ScrapedPrice[] };
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
  products: typeof FALLBACK_PRODUCTS,
  scraped: Awaited<ReturnType<typeof runScrapers>>,
): typeof FALLBACK_PRODUCTS {
  const today = new Date().toISOString().split("T")[0];
  let updated = 0;

  const arcelikMap = new Map(scraped.arcelik.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));
  const bekoMap = new Map(scraped.beko.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));

  for (const p of products) {
    const key = p.modelCode.toLowerCase().replace(/\s+/g, "");
    const match = arcelikMap.get(key) ?? bekoMap.get(key);
    if (match) {
      p.tsfPrice = match.price;
      p.dealerCost = Math.round(match.price * (1 - p.marginPercent / 100));
      p.priceDate = today;
      (p as Record<string, unknown>).dataProvenance = "auto-scraped";
      (p as Record<string, unknown>).scrapedAt = match.scrapedAt;
      updated++;
    }
  }
  console.log(`  Applied ${updated}/${products.length} scraped product prices`);
  return products;
}

function applyScrapedCompetitorPrices(
  competitors: typeof FALLBACK_COMPETITOR_PRICES,
  scraped: Awaited<ReturnType<typeof runScrapers>>,
  products: typeof FALLBACK_PRODUCTS,
): typeof FALLBACK_COMPETITOR_PRICES {
  const today = new Date().toISOString().split("T")[0];
  let updated = 0;

  const vestelMap = new Map(scraped.vestel.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));
  const boschMap = new Map(scraped.bosch.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));
  const samsungMap = new Map(scraped.samsung.map((s) => [s.modelCode.toLowerCase().replace(/\s+/g, ""), s]));
  const productPriceMap = new Map(products.map((p) => [p.id, p.tsfPrice]));

  for (const cp of competitors) {
    const key = cp.competitorModel.split(" ").slice(0, 2).join("").toLowerCase();
    let match: ScrapedPrice | undefined;
    if (cp.brand === "Vestel" || cp.brand === "Regal") match = vestelMap.get(key);
    else if (cp.brand === "Bosch" || cp.brand === "Siemens" || cp.brand === "Profilo") match = boschMap.get(key);
    else if (cp.brand === "Samsung") match = samsungMap.get(key);

    if (match) {
      cp.competitorPrice = match.price;
      cp.priceDate = today;
      (cp as Record<string, unknown>).dataProvenance = "auto-scraped";
      (cp as Record<string, unknown>).scrapedAt = match.scrapedAt;
      updated++;
    }

    const arcelikPrice = productPriceMap.get(cp.arcelikEquivalentId);
    if (arcelikPrice && arcelikPrice > 0) {
      cp.priceDeltaPercent = Math.round(((cp.competitorPrice - arcelikPrice) / arcelikPrice) * 100);
    }
  }
  console.log(`  Applied ${updated}/${competitors.length} scraped competitor prices`);
  console.log(`  Recomputed priceDeltaPercent for all ${competitors.length} competitor entries`);
  return competitors;
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

const FALLBACK_PRODUCTS = [
  { id: "buz-01", modelCode: "5088 NFK", name: "Arçelik 5088 NFK No-Frost Buzdolabı", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 27499, dealerCost: 19249, marginPercent: 30, energyClass: "A++", features: ["No-Frost","Ion Fresh teknolojisi","560 L hacim","Dijital dokunmatik ekran"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-02", modelCode: "5076 NFK", name: "Arçelik 5076 NFK No-Frost", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 23999, dealerCost: 16799, marginPercent: 30, energyClass: "A++", features: ["No-Frost","480 L hacim","Antibakteriyel filtre"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-03", modelCode: "5060 NFK", name: "Arçelik 5060 NFK A+++", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 21499, dealerCost: 15264, marginPercent: 29, energyClass: "A+++", features: ["No-Frost","430 L hacim","Enerji tasarruflu"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-04", modelCode: "5044 NFK", name: "Arçelik 5044 NFK Ekonomik", category: "buzdolabi", subcategory: "no-frost", priceTier: "entry", tsfPrice: 18499, dealerCost: 13319, marginPercent: 28, energyClass: "A+", features: ["No-Frost","380 L hacim"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-05", modelCode: "970560 EI", name: "Beko 970560 EI Kombi No-Frost", category: "buzdolabi", subcategory: "kombi", priceTier: "mid", tsfPrice: 31999, dealerCost: 22079, marginPercent: 31, energyClass: "A++", features: ["Kombi tip","No-Frost","580 L hacim","Harvest Fresh"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-06", modelCode: "9505 NFK", name: "Beko 9505 NFK", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 25499, dealerCost: 17849, marginPercent: 30, energyClass: "A++", features: ["No-Frost","500 L","NeoFrost Dual Cooling"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-07", modelCode: "274560 EI", name: "Arçelik 274560 EI Side-by-Side", category: "buzdolabi", subcategory: "side-by-side", priceTier: "premium", tsfPrice: 46999, dealerCost: 31959, marginPercent: 32, energyClass: "A++", features: ["Side-by-Side","620 L hacim","Su ve buz dispenseri","Dokunmatik panel"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-08", modelCode: "1060 TY", name: "Arçelik Mini 1060 TY", category: "buzdolabi", subcategory: "mini", priceTier: "entry", tsfPrice: 14999, dealerCost: 10949, marginPercent: 27, energyClass: "A+", features: ["Mini buzdolabı","90 L hacim","Ofis/yatak odası için"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-09", modelCode: "825 NFK", name: "Beko 825 NFK No-Frost", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 22499, dealerCost: 15974, marginPercent: 29, energyClass: "A++", features: ["No-Frost","450 L","Mavi Işık teknolojisi"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-10", modelCode: "GRND 5100", name: "Grundig GRND 5100 Premium", category: "buzdolabi", subcategory: "premium", priceTier: "premium", tsfPrice: 37999, dealerCost: 26219, marginPercent: 31, energyClass: "A+++", features: ["Full No-Frost","550 L","Vitamin Zone","Premium cam kapı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-11", modelCode: "5030 NFK", name: "Arçelik 5030 NFK Giriş Seviye", category: "buzdolabi", subcategory: "no-frost", priceTier: "entry", tsfPrice: 15999, dealerCost: 11679, marginPercent: 27, energyClass: "A+", features: ["No-Frost","320 L hacim","Mekanik kontrol"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-12", modelCode: "970680 EI", name: "Beko 970680 EI Kombi Premium", category: "buzdolabi", subcategory: "kombi", priceTier: "premium", tsfPrice: 39999, dealerCost: 27199, marginPercent: 32, energyClass: "A+++", features: ["Kombi tip","Full No-Frost","640 L hacim","Harvest Fresh","Wi-Fi"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-13", modelCode: "284570 EI", name: "Arçelik 284570 EI Side-by-Side Premium", category: "buzdolabi", subcategory: "side-by-side", priceTier: "premium", tsfPrice: 54999, dealerCost: 36849, marginPercent: 33, energyClass: "A+++", features: ["Side-by-Side","680 L hacim","Su/buz dispenseri","HomeWhiz","Kamera"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-14", modelCode: "GRND 4800", name: "Grundig GRND 4800 No-Frost", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 28999, dealerCost: 20009, marginPercent: 31, energyClass: "A++", features: ["Full No-Frost","500 L","Vitamin Zone","LED aydınlatma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "buz-15", modelCode: "1080 TY", name: "Beko 1080 TY Mini Buzdolabı", category: "buzdolabi", subcategory: "mini", priceTier: "entry", tsfPrice: 12499, dealerCost: 9249, marginPercent: 26, energyClass: "A+", features: ["Mini buzdolabı","70 L hacim","Kompakt tasarım"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-01", modelCode: "9124 D", name: "Arçelik 9124 D İnverter Çamaşır Makinesi", category: "camasir", subcategory: "inverter", priceTier: "mid", tsfPrice: 19999, dealerCost: 13999, marginPercent: 30, energyClass: "A", features: ["9 kg","1200 devir","İnverter motor","Buhar teknolojisi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-02", modelCode: "8124 D", name: "Arçelik 8124 D Çamaşır Makinesi", category: "camasir", subcategory: "standart", priceTier: "mid", tsfPrice: 17499, dealerCost: 12599, marginPercent: 28, energyClass: "A", features: ["8 kg","1200 devir","15 program"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-03", modelCode: "10143 D", name: "Arçelik 10143 D Premium", category: "camasir", subcategory: "premium", priceTier: "premium", tsfPrice: 26999, dealerCost: 18629, marginPercent: 31, energyClass: "A", features: ["10 kg","1400 devir","İnverter","Wi-Fi","HomeWhiz"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-04", modelCode: "BK 9141 E", name: "Beko BK 9141 E İnverter", category: "camasir", subcategory: "inverter", priceTier: "mid", tsfPrice: 18499, dealerCost: 12949, marginPercent: 30, energyClass: "A", features: ["9 kg","1400 devir","ProSmart İnverter"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-05", modelCode: "BK 10142 DA", name: "Beko BK 10142 DA", category: "camasir", subcategory: "standart", priceTier: "mid", tsfPrice: 23499, dealerCost: 16449, marginPercent: 30, energyClass: "A", features: ["10 kg","1400 devir","AquaTech"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-06", modelCode: "7103 D", name: "Arçelik 7103 D Ekonomik", category: "camasir", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 14499, dealerCost: 10584, marginPercent: 27, energyClass: "A", features: ["7 kg","1000 devir","Ekonomik seri"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-07", modelCode: "9143 YD", name: "Arçelik 9143 YD Kurutmalı", category: "camasir", subcategory: "kurutmali", priceTier: "premium", tsfPrice: 32999, dealerCost: 22769, marginPercent: 31, energyClass: "A", features: ["9 kg yıkama / 6 kg kurutma","1400 devir","Isı pompalı kurutma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-08", modelCode: "BK 851 YKI", name: "Beko BK 851 YKI Slim", category: "camasir", subcategory: "slim", priceTier: "entry", tsfPrice: 15999, dealerCost: 11519, marginPercent: 28, energyClass: "A", features: ["8 kg","Dar gövde (45cm)","1000 devir"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-09", modelCode: "GWN 39430", name: "Grundig GWN 39430 Premium", category: "camasir", subcategory: "premium", priceTier: "premium", tsfPrice: 28999, dealerCost: 20009, marginPercent: 31, energyClass: "A", features: ["9 kg","1400 devir","Alerjik program","Buhar"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-10", modelCode: "8103 D", name: "Arçelik 8103 D A+++", category: "camasir", subcategory: "standart", priceTier: "entry", tsfPrice: 16999, dealerCost: 12239, marginPercent: 28, energyClass: "A+++", features: ["8 kg","1000 devir","A+++ enerji sınıfı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-11", modelCode: "6103 D", name: "Arçelik 6103 D Kompakt", category: "camasir", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 12999, dealerCost: 9619, marginPercent: 26, energyClass: "A", features: ["6 kg","1000 devir","Kompakt tasarım"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-12", modelCode: "10163 YD", name: "Arçelik 10163 YD Kurutmalı Premium", category: "camasir", subcategory: "kurutmali", priceTier: "premium", tsfPrice: 38999, dealerCost: 26519, marginPercent: 32, energyClass: "A", features: ["10 kg yıkama / 7 kg kurutma","1600 devir","HomeWhiz","Buhar tazeleme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-13", modelCode: "BK 7101 E", name: "Beko BK 7101 E Ekonomik", category: "camasir", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 13499, dealerCost: 9989, marginPercent: 26, energyClass: "A", features: ["7 kg","1000 devir","Hızlı yıkama"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-14", modelCode: "GWN 49630", name: "Grundig GWN 49630 İnverter", category: "camasir", subcategory: "inverter", priceTier: "mid", tsfPrice: 21499, dealerCost: 15049, marginPercent: 30, energyClass: "A", features: ["9 kg","1400 devir","İnverter","FibreProtect"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cam-15", modelCode: "BK 961 YKI", name: "Beko BK 961 YKI Slim İnverter", category: "camasir", subcategory: "slim", priceTier: "mid", tsfPrice: 19499, dealerCost: 13649, marginPercent: 30, energyClass: "A", features: ["9 kg","Dar gövde (45cm)","1200 devir","İnverter"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-01", modelCode: "6344", name: "Arçelik 6344 İnverter Bulaşık Makinesi", category: "bulasik", subcategory: "inverter", priceTier: "mid", tsfPrice: 17999, dealerCost: 12599, marginPercent: 30, energyClass: "A++", features: ["14 kişilik","İnverter motor","Hijyen program"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-02", modelCode: "6266", name: "Arçelik 6266 A++ Bulaşık Makinesi", category: "bulasik", subcategory: "standart", priceTier: "mid", tsfPrice: 15499, dealerCost: 11159, marginPercent: 28, energyClass: "A++", features: ["13 kişilik","6 program","Yarım yük"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-03", modelCode: "BM 6016", name: "Beko BM 6016 Bulaşık Makinesi", category: "bulasik", subcategory: "standart", priceTier: "mid", tsfPrice: 16499, dealerCost: 11549, marginPercent: 30, energyClass: "A++", features: ["14 kişilik","AutoDose","Hijyen Intense"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-04", modelCode: "6566", name: "Arçelik 6566 Premium Bulaşık Makinesi", category: "bulasik", subcategory: "premium", priceTier: "premium", tsfPrice: 23999, dealerCost: 16559, marginPercent: 31, energyClass: "A+++", features: ["14 kişilik","CornerIntense","AquaFlex","Wi-Fi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-05", modelCode: "BM 9006 I", name: "Beko BM 9006 I İnverter", category: "bulasik", subcategory: "inverter", priceTier: "mid", tsfPrice: 20499, dealerCost: 14349, marginPercent: 30, energyClass: "A++", features: ["14 kişilik","İnverter","Tray Wash","Sessiz çalışma"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-06", modelCode: "6144", name: "Arçelik 6144 Ekonomik Bulaşık", category: "bulasik", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 12499, dealerCost: 9249, marginPercent: 26, energyClass: "A+", features: ["12 kişilik","4 program","Ekonomik seri"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-07", modelCode: "GNF 51030", name: "Grundig GNF 51030 Premium", category: "bulasik", subcategory: "premium", priceTier: "premium", tsfPrice: 25999, dealerCost: 17939, marginPercent: 31, energyClass: "A+++", features: ["14 kişilik","AutoDose","GlassCare","Zeolith kurutma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-08", modelCode: "BM 5005", name: "Beko BM 5005 Ekonomik", category: "bulasik", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 13999, dealerCost: 10219, marginPercent: 27, energyClass: "A+", features: ["13 kişilik","5 program"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-09", modelCode: "6044", name: "Arçelik 6044 Giriş Seviye Bulaşık", category: "bulasik", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 10999, dealerCost: 8249, marginPercent: 25, energyClass: "A+", features: ["12 kişilik","4 program","Hızlı yıkama"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-10", modelCode: "6466", name: "Arçelik 6466 İnverter A+++", category: "bulasik", subcategory: "inverter", priceTier: "mid", tsfPrice: 19499, dealerCost: 13649, marginPercent: 30, energyClass: "A+++", features: ["14 kişilik","İnverter","Hijyen Plus","Yarım yük"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-11", modelCode: "BM 7020 I", name: "Beko BM 7020 I Premium", category: "bulasik", subcategory: "premium", priceTier: "premium", tsfPrice: 27999, dealerCost: 19039, marginPercent: 32, energyClass: "A+++", features: ["14 kişilik","İnverter","AutoDose","SteamGloss","Wi-Fi"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-12", modelCode: "6366", name: "Arçelik 6366 Standart A++", category: "bulasik", subcategory: "standart", priceTier: "mid", tsfPrice: 16999, dealerCost: 12069, marginPercent: 29, energyClass: "A++", features: ["14 kişilik","8 program","Hijyen program","Yarım yük"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-13", modelCode: "GNF 41830", name: "Grundig GNF 41830 İnverter", category: "bulasik", subcategory: "inverter", priceTier: "mid", tsfPrice: 21999, dealerCost: 15179, marginPercent: 31, energyClass: "A++", features: ["14 kişilik","İnverter","GlassCare","Extra Kurutma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-14", modelCode: "BM 4505", name: "Beko BM 4505 Kompakt", category: "bulasik", subcategory: "kompakt", priceTier: "entry", tsfPrice: 8999, dealerCost: 6749, marginPercent: 25, energyClass: "A+", features: ["8 kişilik","Tezgah altı","4 program","Kompakt"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "bul-15", modelCode: "6666", name: "Arçelik 6666 Premium Plus Bulaşık", category: "bulasik", subcategory: "premium", priceTier: "premium", tsfPrice: 29999, dealerCost: 20399, marginPercent: 32, energyClass: "A+++", features: ["14 kişilik","CornerIntense Pro","AquaFlex","HomeWhiz","Zeolith"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-01", modelCode: "AFD 6001", name: "Arçelik AFD 6001 Ankastre Fırın", category: "firin", subcategory: "ankastre", priceTier: "mid", tsfPrice: 13999, dealerCost: 9659, marginPercent: 31, energyClass: "A", features: ["Ankastre","Turbo fırın","80 L iç hacim","Teleskopik ray"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-02", modelCode: "AO 6614", name: "Arçelik AO 6614 Ankastre Ocak", category: "firin", subcategory: "ocak", priceTier: "entry", tsfPrice: 8999, dealerCost: 6299, marginPercent: 30, energyClass: "-", features: ["Ankastre ocak","4 gözlü","Cam yüzey","Otomatik ateşleme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-03", modelCode: "BIM 25400 XMS", name: "Beko BIM 25400 XMS Ankastre Fırın", category: "firin", subcategory: "ankastre", priceTier: "mid", tsfPrice: 15999, dealerCost: 11199, marginPercent: 30, energyClass: "A", features: ["Ankastre","Multifunksiyon","Split&Cook","70 L"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-04", modelCode: "AFD 7002 S", name: "Arçelik AFD 7002 S Premium Fırın", category: "firin", subcategory: "premium", priceTier: "premium", tsfPrice: 20999, dealerCost: 14069, marginPercent: 33, energyClass: "A+", features: ["Ankastre","Buhar destekli pişirme","Pyrolytic temizleme","TFT ekran"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-05", modelCode: "AO 8800", name: "Arçelik AO 8800 İndüksiyonlu Ocak", category: "firin", subcategory: "induksiyonlu", priceTier: "mid", tsfPrice: 17499, dealerCost: 12074, marginPercent: 31, energyClass: "-", features: ["İndüksiyon","4 bölge","FlexZone","Timer"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-06", modelCode: "BIM 22301 X", name: "Beko BIM 22301 X Ankastre", category: "firin", subcategory: "ankastre", priceTier: "entry", tsfPrice: 11999, dealerCost: 8639, marginPercent: 28, energyClass: "A", features: ["Ankastre","8 fonksiyon","65 L"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-07", modelCode: "GEBM 34000 X", name: "Grundig GEBM 34000 X Premium", category: "firin", subcategory: "premium", priceTier: "premium", tsfPrice: 24999, dealerCost: 16499, marginPercent: 34, energyClass: "A+", features: ["Ankastre","Chef Assist","Full-touch ekran","Pyrolytic"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-08", modelCode: "ASM 6650", name: "Arçelik ASM 6650 Set Üstü Ocak", category: "firin", subcategory: "set-ustu", priceTier: "entry", tsfPrice: 9999, dealerCost: 6999, marginPercent: 30, energyClass: "-", features: ["Set üstü","4 gözlü","Emaye ızgara","Otomatik ateşleme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-09", modelCode: "AO 4414", name: "Arçelik AO 4414 Ekonomik Ocak", category: "firin", subcategory: "ocak", priceTier: "entry", tsfPrice: 6999, dealerCost: 5039, marginPercent: 28, energyClass: "-", features: ["Ankastre ocak","4 gözlü","Emaye yüzey"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-10", modelCode: "AFD 8003 S", name: "Arçelik AFD 8003 S Premium Plus Fırın", category: "firin", subcategory: "premium", priceTier: "premium", tsfPrice: 29999, dealerCost: 19799, marginPercent: 34, energyClass: "A+", features: ["Ankastre","Buhar + Mikrodalgalı","Pyrolytic","HomeWhiz","TFT dokunmatik"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-11", modelCode: "BIM 15300 X", name: "Beko BIM 15300 X Ekonomik Fırın", category: "firin", subcategory: "ankastre", priceTier: "entry", tsfPrice: 9499, dealerCost: 6939, marginPercent: 27, energyClass: "A", features: ["Ankastre","5 fonksiyon","60 L","Ekonomik"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-12", modelCode: "AO 9900 I", name: "Arçelik AO 9900 I İndüksiyon Premium", category: "firin", subcategory: "induksiyonlu", priceTier: "premium", tsfPrice: 22999, dealerCost: 15639, marginPercent: 32, energyClass: "-", features: ["İndüksiyon","5 bölge","FlexZone Pro","Timer","Boost"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-13", modelCode: "ASM 4450", name: "Arçelik ASM 4450 Ekonomik Set Üstü", category: "firin", subcategory: "set-ustu", priceTier: "entry", tsfPrice: 7499, dealerCost: 5399, marginPercent: 28, energyClass: "-", features: ["Set üstü","4 gözlü","Kompakt","Otomatik ateşleme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-14", modelCode: "GEMM 44000 X", name: "Grundig GEMM 44000 X Mikrodalga Fırın", category: "firin", subcategory: "mikrodalga", priceTier: "mid", tsfPrice: 12999, dealerCost: 9099, marginPercent: 30, energyClass: "-", features: ["Ankastre mikrodalga","25 L","Grill","10 program"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "fir-15", modelCode: "AMD 5120", name: "Arçelik AMD 5120 Ankastre Mikrodalga", category: "firin", subcategory: "mikrodalga", priceTier: "entry", tsfPrice: 8499, dealerCost: 6119, marginPercent: 28, energyClass: "-", features: ["Ankastre mikrodalga","20 L","5 güç seviyesi","Çözme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-01", modelCode: "09410", name: "Arçelik 09410 İnverter Klima 9000 BTU", category: "klima", subcategory: "9000-btu", priceTier: "entry", tsfPrice: 17999, dealerCost: 12599, marginPercent: 30, energyClass: "A++", features: ["9000 BTU","İnverter","R32 gaz","Wi-Fi kontrol"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-02", modelCode: "12420", name: "Arçelik 12420 İnverter Klima 12000 BTU", category: "klima", subcategory: "12000-btu", priceTier: "mid", tsfPrice: 23499, dealerCost: 16449, marginPercent: 30, energyClass: "A++", features: ["12000 BTU","İnverter","Plazma filtre","Sessiz mod"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-03", modelCode: "18430", name: "Arçelik 18430 İnverter Klima 18000 BTU", category: "klima", subcategory: "18000-btu", priceTier: "mid", tsfPrice: 31499, dealerCost: 22364, marginPercent: 29, energyClass: "A+", features: ["18000 BTU","İnverter","Geniş alan","3D hava akışı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-04", modelCode: "24440", name: "Arçelik 24440 İnverter Klima 24000 BTU", category: "klima", subcategory: "24000-btu", priceTier: "premium", tsfPrice: 38999, dealerCost: 27689, marginPercent: 29, energyClass: "A+", features: ["24000 BTU","İnverter","Büyük alan","Otomatik yön"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-05", modelCode: "BXEU 090", name: "Beko BXEU 090 Klima 9000 BTU", category: "klima", subcategory: "9000-btu", priceTier: "entry", tsfPrice: 16999, dealerCost: 12069, marginPercent: 29, energyClass: "A++", features: ["9000 BTU","İnverter","R32 gaz"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-06", modelCode: "BXEU 120", name: "Beko BXEU 120 Klima 12000 BTU", category: "klima", subcategory: "12000-btu", priceTier: "mid", tsfPrice: 21999, dealerCost: 15619, marginPercent: 29, energyClass: "A+", features: ["12000 BTU","İnverter","Uyku modu"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-07", modelCode: "G 12420", name: "Grundig G 12420 Premium Klima", category: "klima", subcategory: "12000-btu", priceTier: "premium", tsfPrice: 27499, dealerCost: 18974, marginPercent: 31, energyClass: "A+++", features: ["12000 BTU","İnverter","UV-C filtre","Premium tasarım"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-08", modelCode: "09310", name: "Arçelik 09310 Ekonomik Klima 9000 BTU", category: "klima", subcategory: "9000-btu", priceTier: "entry", tsfPrice: 14999, dealerCost: 10799, marginPercent: 28, energyClass: "A+", features: ["9000 BTU","İnverter","R32 gaz","Temel model"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-09", modelCode: "12520", name: "Arçelik 12520 Premium Klima 12000 BTU", category: "klima", subcategory: "12000-btu", priceTier: "premium", tsfPrice: 29999, dealerCost: 20699, marginPercent: 31, energyClass: "A+++", features: ["12000 BTU","İnverter","Wi-Fi","Plazma filtre","3D hava akışı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-10", modelCode: "BXEU 180", name: "Beko BXEU 180 Klima 18000 BTU", category: "klima", subcategory: "18000-btu", priceTier: "mid", tsfPrice: 28999, dealerCost: 20589, marginPercent: 29, energyClass: "A+", features: ["18000 BTU","İnverter","R32 gaz","Uyku modu"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-11", modelCode: "BXEU 240", name: "Beko BXEU 240 Klima 24000 BTU", category: "klima", subcategory: "24000-btu", priceTier: "mid", tsfPrice: 34999, dealerCost: 24849, marginPercent: 29, energyClass: "A+", features: ["24000 BTU","İnverter","R32 gaz","Geniş alan"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-12", modelCode: "G 09310", name: "Grundig G 09310 Klima 9000 BTU", category: "klima", subcategory: "9000-btu", priceTier: "mid", tsfPrice: 19999, dealerCost: 13999, marginPercent: 30, energyClass: "A++", features: ["9000 BTU","İnverter","UV-C filtre","Sessiz mod"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-13", modelCode: "24540", name: "Arçelik 24540 Premium Klima 24000 BTU", category: "klima", subcategory: "24000-btu", priceTier: "premium", tsfPrice: 44999, dealerCost: 30599, marginPercent: 32, energyClass: "A++", features: ["24000 BTU","İnverter","Wi-Fi","3D hava akışı","Plazma ion"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kli-14", modelCode: "G 18430", name: "Grundig G 18430 Premium Klima 18000 BTU", category: "klima", subcategory: "18000-btu", priceTier: "premium", tsfPrice: 36999, dealerCost: 25529, marginPercent: 31, energyClass: "A++", features: ["18000 BTU","İnverter","UV-C filtre","Premium tasarım","Wi-Fi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-01", modelCode: "K 3300", name: "Arçelik K 3300 Çay Makinesi", category: "kucuk-ev", subcategory: "cay-makinesi", priceTier: "entry", tsfPrice: 3699, dealerCost: 2293, marginPercent: 38, energyClass: "-", features: ["Çelik demlik","Otomatik kapanma","Su göstergesi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-02", modelCode: "K 8115", name: "Arçelik K 8115 Espresso Makinesi", category: "kucuk-ev", subcategory: "espresso", priceTier: "mid", tsfPrice: 9499, dealerCost: 5699, marginPercent: 40, energyClass: "-", features: ["15 bar basınç","Süt köpürtme","Çift çıkış"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-03", modelCode: "S 6540", name: "Arçelik S 6540 Dikey Süpürge", category: "kucuk-ev", subcategory: "supurge", priceTier: "entry", tsfPrice: 5799, dealerCost: 3595, marginPercent: 38, energyClass: "A", features: ["750W","HEPA filtre","Kablosuz değil"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-04", modelCode: "BKK 2210", name: "Beko BKK 2210 Türk Kahvesi Makinesi", category: "kucuk-ev", subcategory: "turk-kahvesi", priceTier: "entry", tsfPrice: 2699, dealerCost: 1673, marginPercent: 38, energyClass: "-", features: ["Tek pişirme","Otomatik pişirme","Anti-taşma"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-05", modelCode: "T 8800", name: "Arçelik T 8800 Buharlı Ütü", category: "kucuk-ev", subcategory: "utu", priceTier: "entry", tsfPrice: 3199, dealerCost: 1983, marginPercent: 38, energyClass: "-", features: ["2800W","Seramik taban","Sürekli buhar"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-06", modelCode: "K 2360", name: "Arçelik K 2360 Filtre Kahve Makinesi", category: "kucuk-ev", subcategory: "filtre-kahve", priceTier: "entry", tsfPrice: 4299, dealerCost: 2665, marginPercent: 38, energyClass: "-", features: ["1.5L karaf","Aroma ayarı","Timer"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-07", modelCode: "BKK 2520", name: "Beko BKK 2520 Robot Süpürge", category: "kucuk-ev", subcategory: "robot-supurge", priceTier: "premium", tsfPrice: 10999, dealerCost: 6599, marginPercent: 40, energyClass: "-", features: ["Lazer navigasyon","Mop özelliği","Wi-Fi","120 dk pil"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-08", modelCode: "K 3195", name: "Arçelik K 3195 Çiftli Türk Kahvesi Makinesi", category: "kucuk-ev", subcategory: "turk-kahvesi", priceTier: "entry", tsfPrice: 3999, dealerCost: 2479, marginPercent: 38, energyClass: "-", features: ["Çift fincan","Otomatik pişirme","Sesli uyarı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-09", modelCode: "K 8515", name: "Arçelik K 8515 Otomatik Espresso", category: "kucuk-ev", subcategory: "espresso", priceTier: "premium", tsfPrice: 18999, dealerCost: 11399, marginPercent: 40, energyClass: "-", features: ["15 bar","Otomatik süt köpürtme","Dokunmatik ekran","Çelik kasa"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-10", modelCode: "S 8560", name: "Arçelik S 8560 Kablosuz Süpürge", category: "kucuk-ev", subcategory: "kablosuz-supurge", priceTier: "mid", tsfPrice: 8999, dealerCost: 5579, marginPercent: 38, energyClass: "-", features: ["Kablosuz","60 dk pil","HEPA filtre","Dönüştürülebilir"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-11", modelCode: "BKK 3010", name: "Beko BKK 3010 Premium Robot Süpürge", category: "kucuk-ev", subcategory: "robot-supurge", priceTier: "premium", tsfPrice: 14999, dealerCost: 8999, marginPercent: 40, energyClass: "-", features: ["LiDAR navigasyon","Mop+süpürme","Wi-Fi","Otomatik boşaltma"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-12", modelCode: "K 3400", name: "Arçelik K 3400 Premium Çay Makinesi", category: "kucuk-ev", subcategory: "cay-makinesi", priceTier: "mid", tsfPrice: 5499, dealerCost: 3409, marginPercent: 38, energyClass: "-", features: ["Çelik demlik","Keep warm","LED gösterge","Otomatik kapanma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-13", modelCode: "BLN 6900", name: "Beko BLN 6900 Blender Set", category: "kucuk-ev", subcategory: "blender", priceTier: "entry", tsfPrice: 3499, dealerCost: 2169, marginPercent: 38, energyClass: "-", features: ["1200W","Çoklu bıçak","3 hız"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-14", modelCode: "BLN 8900", name: "Beko BLN 8900 Premium Blender", category: "kucuk-ev", subcategory: "blender", priceTier: "mid", tsfPrice: 6499, dealerCost: 4029, marginPercent: 38, energyClass: "-", features: ["1600W","Isıtmalı","Çorba programı","Cam hazne"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-15", modelCode: "S 9580", name: "Arçelik S 9580 Premium Kablosuz Süpürge", category: "kucuk-ev", subcategory: "kablosuz-supurge", priceTier: "premium", tsfPrice: 12999, dealerCost: 7799, marginPercent: 40, energyClass: "-", features: ["Kablosuz","90 dk pil","Dijital motor","HEPA 13","LED far"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "kev-16", modelCode: "TM 8500", name: "Arçelik TM 8500 Tost Makinesi", category: "kucuk-ev", subcategory: "tost-makinesi", priceTier: "entry", tsfPrice: 1999, dealerCost: 1239, marginPercent: 38, energyClass: "-", features: ["Granitli plaka","Geniş alan","Kilitli kapak"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-01", modelCode: "A43 L 8840 5S", name: "Arçelik A43 L 8840 5S 4K TV 43\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "entry", tsfPrice: 16499, dealerCost: 12869, marginPercent: 22, energyClass: "G", features: ["43 inç","4K Ultra HD","Smart TV","HDR10"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-02", modelCode: "A50 L 8850 5S", name: "Arçelik A50 L 8850 5S 4K TV 50\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 24499, dealerCost: 18859, marginPercent: 23, energyClass: "F", features: ["50 inç","4K Ultra HD","Smart TV","Dolby Vision","HDMI 2.1"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-03", modelCode: "A55 OLED 9895 5S", name: "Arçelik A55 OLED 9895 5S OLED TV 55\"", category: "tv-elektronik", subcategory: "oled-tv", priceTier: "premium", tsfPrice: 42999, dealerCost: 32249, marginPercent: 25, energyClass: "G", features: ["55 inç","OLED","4K","Dolby Vision IQ","120Hz","HDMI 2.1"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-04", modelCode: "B43 L 8620", name: "Beko B43 L 8620 LED TV 43\"", category: "tv-elektronik", subcategory: "led-tv", priceTier: "entry", tsfPrice: 11999, dealerCost: 9599, marginPercent: 20, energyClass: "G", features: ["43 inç","Full HD","Smart TV","2 HDMI"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-05", modelCode: "55 GHQ 9500", name: "Grundig 55 GHQ 9500 QLED TV 55\"", category: "tv-elektronik", subcategory: "qled-tv", priceTier: "premium", tsfPrice: 48999, dealerCost: 36749, marginPercent: 25, energyClass: "F", features: ["55 inç","QLED","4K","Google TV","120Hz","Dolby Atmos"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-06", modelCode: "A65 L 8870 5S", name: "Arçelik A65 L 8870 5S 4K TV 65\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 32499, dealerCost: 25349, marginPercent: 22, energyClass: "G", features: ["65 inç","4K Ultra HD","Smart TV","Dolby Atmos","Google TV"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-07", modelCode: "B55 L 8820 5S", name: "Beko B55 L 8820 5S 4K TV 55\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 22999, dealerCost: 17939, marginPercent: 22, energyClass: "F", features: ["55 inç","4K Ultra HD","Smart TV","HDR10+"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-08", modelCode: "50 GHU 7000", name: "Grundig 50 GHU 7000 Android TV 50\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 19999, dealerCost: 15599, marginPercent: 22, energyClass: "F", features: ["50 inç","4K","Android TV","Google Assistant"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-09", modelCode: "B32 L 8510", name: "Beko B32 L 8510 HD TV 32\"", category: "tv-elektronik", subcategory: "led-tv", priceTier: "entry", tsfPrice: 7999, dealerCost: 6399, marginPercent: 20, energyClass: "G", features: ["32 inç","HD Ready","2 HDMI","USB media"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-10", modelCode: "A55 L 8840 5S", name: "Arçelik A55 L 8840 5S 4K TV 55\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 27999, dealerCost: 21839, marginPercent: 22, energyClass: "F", features: ["55 inç","4K Ultra HD","Smart TV","HDR10","Dolby Atmos"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-11", modelCode: "B32 L 8620", name: "Beko B32 L 8620 LED TV 32\"", category: "tv-elektronik", subcategory: "led-tv", priceTier: "entry", tsfPrice: 9499, dealerCost: 7599, marginPercent: 20, energyClass: "G", features: ["32 inç","HD Ready","Smart TV"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-12", modelCode: "65 GHQ 9600", name: "Grundig 65 GHQ 9600 QLED TV 65\"", category: "tv-elektronik", subcategory: "qled-tv", priceTier: "premium", tsfPrice: 62999, dealerCost: 47879, marginPercent: 24, energyClass: "F", features: ["65 inç","QLED","4K","Google TV","120Hz","Dolby Vision"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-13", modelCode: "A75 L 8860 5S", name: "Arçelik A75 L 8860 5S 4K TV 75\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "premium", tsfPrice: 49999, dealerCost: 38999, marginPercent: 22, energyClass: "G", features: ["75 inç","4K Ultra HD","Smart TV","Dolby Atmos","120Hz"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-14", modelCode: "B50 L 8830 5S", name: "Beko B50 L 8830 5S 4K TV 50\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 20999, dealerCost: 16799, marginPercent: 20, energyClass: "F", features: ["50 inç","4K Ultra HD","Smart TV","HDR10"], sourceId: "src-beko-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "tv-15", modelCode: "A65 L 9895 5S", name: "Arçelik A65 L 9895 5S OLED TV 65\"", category: "tv-elektronik", subcategory: "oled-tv", priceTier: "premium", tsfPrice: 64999, dealerCost: 49399, marginPercent: 24, energyClass: "G", features: ["65 inç","OLED","4K","Dolby Vision IQ","120Hz","HDMI 2.1"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
];

const FALLBACK_COMPETITOR_PRICES = [
  { id: "cp-v-01", brand: "Vestel", competitorModel: "NF600 EX A++", category: "buzdolabi", competitorPrice: 22999, arcelikEquivalentId: "buz-04", priceDeltaPercent: 24, positioning: "value", note: "Fiyat odaklı segment lideri", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-02", brand: "Vestel", competitorModel: "NF520 A++", category: "buzdolabi", competitorPrice: 18499, arcelikEquivalentId: "buz-03", priceDeltaPercent: -14, positioning: "value", note: "Agresif fiyatlandırma", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-03", brand: "Vestel", competitorModel: "CM 9812 İnverter", category: "camasir", competitorPrice: 16999, arcelikEquivalentId: "cam-01", priceDeltaPercent: -15, positioning: "value", note: "Fiyat avantajı ile pazar payı hedefi", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-04", brand: "Vestel", competitorModel: "BM 7101 A++", category: "bulasik", competitorPrice: 13999, arcelikEquivalentId: "bul-02", priceDeltaPercent: -10, positioning: "value", note: "Uygun fiyat segmenti", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-05", brand: "Vestel", competitorModel: "AO 6004 Ankastre Fırın", category: "firin", competitorPrice: 11499, arcelikEquivalentId: "fir-01", priceDeltaPercent: -18, positioning: "value", note: "Bütçe dostu ankastre", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-06", brand: "Vestel", competitorModel: "INV 09 Klima 9000 BTU", category: "klima", competitorPrice: 14999, arcelikEquivalentId: "kli-01", priceDeltaPercent: -17, positioning: "value", note: "En düşük fiyatlı inverter", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-07", brand: "Vestel", competitorModel: "50UA9630 4K TV", category: "tv-elektronik", competitorPrice: 19999, arcelikEquivalentId: "tv-02", priceDeltaPercent: -18, positioning: "value", note: "Agresif TV fiyatlandırması", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-08", brand: "Vestel", competitorModel: "CM 7810 Ekonomik", category: "camasir", competitorPrice: 12499, arcelikEquivalentId: "cam-06", priceDeltaPercent: -14, positioning: "value", note: "Giriş seviye rekabet", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-09", brand: "Vestel", competitorModel: "NF480 Kombi", category: "buzdolabi", competitorPrice: 26999, arcelikEquivalentId: "buz-05", priceDeltaPercent: -16, positioning: "value", note: "Kombi segmentinde fiyat avantajı", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-10", brand: "Vestel", competitorModel: "BM 9401 İnverter", category: "bulasik", competitorPrice: 17499, arcelikEquivalentId: "bul-05", priceDeltaPercent: -15, positioning: "value", note: "İnverter segmentinde alt fiyat", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-01", brand: "Regal", competitorModel: "NF 5200 A+", category: "buzdolabi", competitorPrice: 15499, arcelikEquivalentId: "buz-04", priceDeltaPercent: -16, positioning: "value", note: "En düşük fiyatlı no-frost", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-02", brand: "Regal", competitorModel: "CM 7100", category: "camasir", competitorPrice: 11499, arcelikEquivalentId: "cam-06", priceDeltaPercent: -21, positioning: "value", note: "Bütçe segmenti lideri", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-03", brand: "Regal", competitorModel: "BM 4010", category: "bulasik", competitorPrice: 10499, arcelikEquivalentId: "bul-06", priceDeltaPercent: -16, positioning: "value", note: "En ucuz bulaşık makinesi", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-04", brand: "Regal", competitorModel: "AFN 5001 Fırın", category: "firin", competitorPrice: 9499, arcelikEquivalentId: "fir-01", priceDeltaPercent: -32, positioning: "value", note: "Bütçe ankastre", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-05", brand: "Regal", competitorModel: "43R654FA TV", category: "tv-elektronik", competitorPrice: 12499, arcelikEquivalentId: "tv-01", priceDeltaPercent: -24, positioning: "value", note: "Giriş seviye TV", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-06", brand: "Regal", competitorModel: "INV 09R Klima", category: "klima", competitorPrice: 13499, arcelikEquivalentId: "kli-01", priceDeltaPercent: -25, positioning: "value", note: "En ucuz inverter klima", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-01", brand: "Bosch", competitorModel: "KGN56VIF0N No-Frost", category: "buzdolabi", competitorPrice: 34999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 27, positioning: "premium", note: "VitaFresh teknolojisi, premium segment", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-02", brand: "Bosch", competitorModel: "KAN92VI35O Side-by-Side", category: "buzdolabi", competitorPrice: 59999, arcelikEquivalentId: "buz-07", priceDeltaPercent: 28, positioning: "premium", note: "Premium side-by-side", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-03", brand: "Bosch", competitorModel: "WAX32M40TR İnverter", category: "camasir", competitorPrice: 29999, arcelikEquivalentId: "cam-03", priceDeltaPercent: 11, positioning: "premium", note: "i-DOS otomatik dozajlama", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-04", brand: "Bosch", competitorModel: "SMS6ZCI42E Bulaşık", category: "bulasik", competitorPrice: 28999, arcelikEquivalentId: "bul-04", priceDeltaPercent: 21, positioning: "premium", note: "PerfectDry Zeolith", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-05", brand: "Bosch", competitorModel: "HBG675BS1 Ankastre Fırın", category: "firin", competitorPrice: 27999, arcelikEquivalentId: "fir-04", priceDeltaPercent: 33, positioning: "premium", note: "Serie 8 premium fırın", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-06", brand: "Bosch", competitorModel: "CLL 9000W Klima 9000", category: "klima", competitorPrice: 26999, arcelikEquivalentId: "kli-01", priceDeltaPercent: 50, positioning: "premium", note: "Climate 9000i premium", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-07", brand: "Bosch", competitorModel: "WAV28L40TR Premium", category: "camasir", competitorPrice: 35999, arcelikEquivalentId: "cam-03", priceDeltaPercent: 33, positioning: "premium", note: "Serie 8 ActiveOxygen", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-08", brand: "Bosch", competitorModel: "KGN39VWEQ Ekonomik", category: "buzdolabi", competitorPrice: 26999, arcelikEquivalentId: "buz-02", priceDeltaPercent: 13, positioning: "premium", note: "Orta segment Bosch", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-s-01", brand: "Siemens", competitorModel: "KG56NVI30N iQ300", category: "buzdolabi", competitorPrice: 31999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 16, positioning: "premium", note: "hyperFresh teknolojisi", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-s-02", brand: "Siemens", competitorModel: "WM14N2X0TR iQ500", category: "camasir", competitorPrice: 27999, arcelikEquivalentId: "cam-03", priceDeltaPercent: 4, positioning: "premium", note: "speedPack, iQdrive", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-s-03", brand: "Siemens", competitorModel: "SN65ZX00AT iQ500", category: "bulasik", competitorPrice: 26999, arcelikEquivalentId: "bul-04", priceDeltaPercent: 13, positioning: "premium", note: "Zeolith, glassZone", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-s-04", brand: "Siemens", competitorModel: "HB676GBS1 iQ700 Fırın", category: "firin", competitorPrice: 30999, arcelikEquivalentId: "fir-04", priceDeltaPercent: 48, positioning: "premium", note: "cookControl Plus", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-s-05", brand: "Siemens", competitorModel: "KA93GAIEP SbS", category: "buzdolabi", competitorPrice: 64999, arcelikEquivalentId: "buz-07", priceDeltaPercent: 38, positioning: "premium", note: "iQ500 Side-by-Side", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-01", brand: "Profilo", competitorModel: "BD3056LFVN No-Frost", category: "buzdolabi", competitorPrice: 21999, arcelikEquivalentId: "buz-02", priceDeltaPercent: -8, positioning: "mid", note: "Orta segment, Türk tüketicisine tanıdık", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-02", brand: "Profilo", competitorModel: "BD3076LFVN A++", category: "buzdolabi", competitorPrice: 25499, arcelikEquivalentId: "buz-01", priceDeltaPercent: -7, positioning: "mid", note: "Bosch kalitesi uygun fiyat", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-03", brand: "Profilo", competitorModel: "CMK1010ETR Çamaşır", category: "camasir", competitorPrice: 17999, arcelikEquivalentId: "cam-01", priceDeltaPercent: -10, positioning: "mid", note: "Orta segment yıkama", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-04", brand: "Profilo", competitorModel: "BM6280 Bulaşık", category: "bulasik", competitorPrice: 15999, arcelikEquivalentId: "bul-01", priceDeltaPercent: -11, positioning: "mid", note: "Uygun fiyatlı Alman teknolojisi", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-05", brand: "Profilo", competitorModel: "ANKF 6001 Fırın", category: "firin", competitorPrice: 12499, arcelikEquivalentId: "fir-01", priceDeltaPercent: -11, positioning: "mid", note: "Alman ankastre uygun fiyat", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-06", brand: "Profilo", competitorModel: "INV 09P Klima", category: "klima", competitorPrice: 19499, arcelikEquivalentId: "kli-01", priceDeltaPercent: 8, positioning: "mid", note: "Bosch teknolojisi orta fiyat", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-07", brand: "Profilo", competitorModel: "CMK8100 Kurutmalı", category: "camasir", competitorPrice: 28999, arcelikEquivalentId: "cam-07", priceDeltaPercent: -12, positioning: "mid", note: "Kurutmalı segmentte rekabet", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-08", brand: "Profilo", competitorModel: "BD3044LFVN Ekonomik", category: "buzdolabi", competitorPrice: 17999, arcelikEquivalentId: "buz-04", priceDeltaPercent: -3, positioning: "mid", note: "Ekonomik buzdolabı", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-09", brand: "Profilo", competitorModel: "BM4280 Ekonomik Bulaşık", category: "bulasik", competitorPrice: 11999, arcelikEquivalentId: "bul-06", priceDeltaPercent: -4, positioning: "mid", note: "Uygun fiyat ekonomik", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-10", brand: "Profilo", competitorModel: "CMK7100 Slim", category: "camasir", competitorPrice: 14499, arcelikEquivalentId: "cam-08", priceDeltaPercent: -9, positioning: "mid", note: "Dar gövde orta segment", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-01", brand: "Samsung", competitorModel: "RT53K6240S8 No-Frost", category: "buzdolabi", competitorPrice: 30999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 13, positioning: "premium", note: "Twin Cooling Plus", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-02", brand: "Samsung", competitorModel: "RS68A8842SL SbS", category: "buzdolabi", competitorPrice: 54999, arcelikEquivalentId: "buz-07", priceDeltaPercent: 17, positioning: "premium", note: "SpaceMax, Family Hub", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-03", brand: "Samsung", competitorModel: "WW90T534DAE Ecobubble", category: "camasir", competitorPrice: 23499, arcelikEquivalentId: "cam-01", priceDeltaPercent: 18, positioning: "premium", note: "Ecobubble, AI Kontrol", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-04", brand: "Samsung", competitorModel: "WD90T534DBE Kurutmalı", category: "camasir", competitorPrice: 35999, arcelikEquivalentId: "cam-07", priceDeltaPercent: 9, positioning: "premium", note: "AddWash, AI Kurutma", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-05", brand: "Samsung", competitorModel: "DW60M5070FW Bulaşık", category: "bulasik", competitorPrice: 19499, arcelikEquivalentId: "bul-01", priceDeltaPercent: 8, positioning: "premium", note: "WaterWall teknolojisi", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-06", brand: "Samsung", competitorModel: "NV75N5573RS Fırın", category: "firin", competitorPrice: 21999, arcelikEquivalentId: "fir-04", priceDeltaPercent: 5, positioning: "premium", note: "Dual Cook Flex", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-07", brand: "Samsung", competitorModel: "AR12TXHQASINEU Klima", category: "klima", competitorPrice: 24999, arcelikEquivalentId: "kli-02", priceDeltaPercent: 6, positioning: "premium", note: "Wind-Free teknolojisi", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-08", brand: "Samsung", competitorModel: "UE50AU7100 4K TV", category: "tv-elektronik", competitorPrice: 26999, arcelikEquivalentId: "tv-02", priceDeltaPercent: 10, positioning: "premium", note: "Crystal UHD, Tizen", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-09", brand: "Samsung", competitorModel: "QE55Q60B QLED TV", category: "tv-elektronik", competitorPrice: 46999, arcelikEquivalentId: "tv-05", priceDeltaPercent: -4, positioning: "premium", note: "QLED, Quantum HDR", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-10", brand: "Samsung", competitorModel: "UE65AU7100 4K TV 65\"", category: "tv-elektronik", competitorPrice: 35999, arcelikEquivalentId: "tv-06", priceDeltaPercent: 11, positioning: "premium", note: "Crystal 4K, büyük ekran", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-01", brand: "LG", competitorModel: "GN-C422SLCL No-Frost", category: "buzdolabi", competitorPrice: 29999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 9, positioning: "premium", note: "Linear Cooling, DoorCooling+", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-02", brand: "LG", competitorModel: "GC-X257CSHS SbS", category: "buzdolabi", competitorPrice: 57999, arcelikEquivalentId: "buz-07", priceDeltaPercent: 23, positioning: "premium", note: "InstaView, Craft Ice", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-03", brand: "LG", competitorModel: "F4V5RYP0W İnverter", category: "camasir", competitorPrice: 22499, arcelikEquivalentId: "cam-01", priceDeltaPercent: 13, positioning: "premium", note: "AI DD, TurboWash 360", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-04", brand: "LG", competitorModel: "F4V5RGP0W Kurutmalı", category: "camasir", competitorPrice: 34999, arcelikEquivalentId: "cam-07", priceDeltaPercent: 6, positioning: "premium", note: "AI DD Kurutmalı", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-05", brand: "LG", competitorModel: "DF455HMS Bulaşık", category: "bulasik", competitorPrice: 20499, arcelikEquivalentId: "bul-01", priceDeltaPercent: 14, positioning: "premium", note: "QuadWash, TrueSteam", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-06", brand: "LG", competitorModel: "50UP75006LF 4K TV", category: "tv-elektronik", competitorPrice: 23499, arcelikEquivalentId: "tv-02", priceDeltaPercent: -4, positioning: "premium", note: "WebOS, Active HDR", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-07", brand: "LG", competitorModel: "OLED55C1 OLED TV", category: "tv-elektronik", competitorPrice: 47999, arcelikEquivalentId: "tv-03", priceDeltaPercent: 12, positioning: "premium", note: "OLED evo, α9 işlemci", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-08", brand: "LG", competitorModel: "65UP75006 4K TV 65\"", category: "tv-elektronik", competitorPrice: 30999, arcelikEquivalentId: "tv-06", priceDeltaPercent: -5, positioning: "premium", note: "4K IPS, WebOS", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-e-01", brand: "Electrolux/AEG", competitorModel: "LRS3DE39U No-Frost", category: "buzdolabi", competitorPrice: 28999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 5, positioning: "premium", note: "TwinTech No-Frost", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-e-02", brand: "Electrolux/AEG", competitorModel: "EW6F4R28B İnverter", category: "camasir", competitorPrice: 21499, arcelikEquivalentId: "cam-01", priceDeltaPercent: 8, positioning: "premium", note: "SensiCare, ProSteam", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-e-03", brand: "Electrolux/AEG", competitorModel: "ESF9500LOX Bulaşık", category: "bulasik", competitorPrice: 18999, arcelikEquivalentId: "bul-01", priceDeltaPercent: 6, positioning: "premium", note: "AirDry, FlexiSpray", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-e-04", brand: "Electrolux/AEG", competitorModel: "EOF5C50BX Ankastre Fırın", category: "firin", competitorPrice: 18499, arcelikEquivalentId: "fir-04", priceDeltaPercent: -12, positioning: "premium", note: "SurroundCook", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-e-05", brand: "Electrolux/AEG", competitorModel: "EW7F3R48S Premium Çamaşır", category: "camasir", competitorPrice: 26999, arcelikEquivalentId: "cam-03", priceDeltaPercent: 0, positioning: "premium", note: "SoftPlus, UniversalDose", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-e-06", brand: "Electrolux/AEG", competitorModel: "LRS4DE39S Kombi No-Frost", category: "buzdolabi", competitorPrice: 33499, arcelikEquivalentId: "buz-05", priceDeltaPercent: 5, positioning: "premium", note: "CustomFlex, TwinTech", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-11", brand: "Vestel", competitorModel: "BM 7501 A+++ Bulaşık", category: "bulasik", competitorPrice: 19999, arcelikEquivalentId: "bul-04", priceDeltaPercent: -17, positioning: "value", note: "Premium segmentte fiyat kırıcı", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-v-12", brand: "Vestel", competitorModel: "KLM 12001 İnverter Klima 12K", category: "klima", competitorPrice: 19999, arcelikEquivalentId: "kli-02", priceDeltaPercent: -15, positioning: "value", note: "12000 BTU segmentinde agresif fiyat", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-07", brand: "Regal", competitorModel: "CM 6100 Ekonomik Çamaşır", category: "camasir", competitorPrice: 9999, arcelikEquivalentId: "cam-06", priceDeltaPercent: -31, positioning: "value", note: "En düşük fiyatlı çamaşır makinesi", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-08", brand: "Regal", competitorModel: "NF 4800 Mini", category: "buzdolabi", competitorPrice: 11999, arcelikEquivalentId: "buz-08", priceDeltaPercent: -20, positioning: "value", note: "Mini buzdolabı giriş seviye", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-r-09", brand: "Regal", competitorModel: "BM 5001 Standart Bulaşık", category: "bulasik", competitorPrice: 11999, arcelikEquivalentId: "bul-02", priceDeltaPercent: -23, positioning: "value", note: "Standart segment en düşük fiyat", sourceId: "src-vestel-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-09", brand: "Bosch", competitorModel: "SMS46GI55E Serie 4 Bulaşık", category: "bulasik", competitorPrice: 23499, arcelikEquivalentId: "bul-01", priceDeltaPercent: 31, positioning: "premium", note: "Serie 4 orta-premium bulaşık", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-b-10", brand: "Bosch", competitorModel: "CLL 2000W Klima 12K", category: "klima", competitorPrice: 30999, arcelikEquivalentId: "kli-02", priceDeltaPercent: 32, positioning: "premium", note: "Climate 2000i 12000 BTU", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-s-06", brand: "Siemens", competitorModel: "WG54B2030TR iQ700 Çamaşır", category: "camasir", competitorPrice: 32499, arcelikEquivalentId: "cam-03", priceDeltaPercent: 20, positioning: "premium", note: "iSensoric, antiStain", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-s-07", brand: "Siemens", competitorModel: "SN65EX56CE iQ500 Bulaşık", category: "bulasik", competitorPrice: 29999, arcelikEquivalentId: "bul-04", priceDeltaPercent: 25, positioning: "premium", note: "emotionLight, Zeolith kurutma", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-s-08", brand: "Siemens", competitorModel: "KD56NXIF0N iQ300 No-Frost", category: "buzdolabi", competitorPrice: 29999, arcelikEquivalentId: "buz-02", priceDeltaPercent: 25, positioning: "premium", note: "noFrost, superFreezing", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-11", brand: "Samsung", competitorModel: "WW80T3040BW Ekonomik Çamaşır", category: "camasir", competitorPrice: 16999, arcelikEquivalentId: "cam-02", priceDeltaPercent: -3, positioning: "premium", note: "Digital Inverter, Hygiene Steam", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-12", brand: "Samsung", competitorModel: "DW60M6050FW Bulaşık Premium", category: "bulasik", competitorPrice: 24999, arcelikEquivalentId: "bul-04", priceDeltaPercent: 4, positioning: "premium", note: "WaterWall, Zone Booster", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-09", brand: "LG", competitorModel: "GN-B422SQCL Ekonomik No-Frost", category: "buzdolabi", competitorPrice: 24499, arcelikEquivalentId: "buz-02", priceDeltaPercent: 2, positioning: "premium", note: "Smart Inverter, Multi Air Flow", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-10", brand: "LG", competitorModel: "F2V5HS0W Slim Çamaşır", category: "camasir", competitorPrice: 17999, arcelikEquivalentId: "cam-08", priceDeltaPercent: 13, positioning: "premium", note: "Slim body, AI DD, Steam", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-e-07", brand: "Electrolux/AEG", competitorModel: "ESF5545LOX Premium Bulaşık", category: "bulasik", competitorPrice: 23499, arcelikEquivalentId: "bul-04", priceDeltaPercent: -2, positioning: "premium", note: "RealLife, SatelliteClean", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-e-08", brand: "Electrolux/AEG", competitorModel: "EW8F2966MA Kurutmalı Çamaşır", category: "camasir", competitorPrice: 30999, arcelikEquivalentId: "cam-07", priceDeltaPercent: -6, positioning: "premium", note: "DualCare, UltraWash", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-p-11", brand: "Profilo", competitorModel: "BD4056LFVN Premium No-Frost", category: "buzdolabi", competitorPrice: 29999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 9, positioning: "mid", note: "VitaFresh, NoFrost", sourceId: "src-bosch-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-sa-13", brand: "Samsung", competitorModel: "AR18TXHQASINEU Klima 18K", category: "klima", competitorPrice: 37999, arcelikEquivalentId: "kli-03", priceDeltaPercent: 21, positioning: "premium", note: "Wind-Free 18000 BTU", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
  { id: "cp-lg-11", brand: "LG", competitorModel: "S3WQ12JA0A Klima 12K", category: "klima", competitorPrice: 25999, arcelikEquivalentId: "kli-02", priceDeltaPercent: 11, positioning: "premium", note: "Dual Inverter, ThinQ", sourceId: "src-samsung-prices", priceDate: "2026-05-01", dataProvenance: "manual-verified" as const },
];

const CITIES = [
  { id: "istanbul", name: "İstanbul", populationTier: "tier-1", marketSharePercent: 42.3, avgPriceIndex: 1.06, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Bosch", strength: 8 }, { brand: "Profilo", strength: 7 }, { brand: "Samsung", strength: 7 }], seasonalPattern: "Yıl boyunca yüksek talep, düğün sezonu Haz–Eyl pik", dealerCount: 340 },
  { id: "ankara", name: "Ankara", populationTier: "tier-1", marketSharePercent: 46.1, avgPriceIndex: 0.99, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Bosch", strength: 7 }, { brand: "Profilo", strength: 8 }, { brand: "Samsung", strength: 5 }], seasonalPattern: "Kamu sektörü alımları Q1/Q3, kış klima düşük", dealerCount: 195 },
  { id: "izmir", name: "İzmir", populationTier: "tier-1", marketSharePercent: 39.4, avgPriceIndex: 1.03, competitorStrength: [{ brand: "Vestel", strength: 8 }, { brand: "Bosch", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 6 }], seasonalPattern: "Yaz turizm etkisi, klima Mayıs–Eylül pik", dealerCount: 170 },
  { id: "bursa", name: "Bursa", populationTier: "tier-1", marketSharePercent: 47.8, avgPriceIndex: 0.98, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Profilo", strength: 7 }, { brand: "Samsung", strength: 4 }, { brand: "LG", strength: 3 }], seasonalPattern: "Sanayi kenti, düğün sezonu güçlü", dealerCount: 115 },
  { id: "antalya", name: "Antalya", populationTier: "tier-1", marketSharePercent: 37.6, avgPriceIndex: 1.09, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Samsung", strength: 7 }, { brand: "Bosch", strength: 6 }, { brand: "LG", strength: 5 }], seasonalPattern: "Turizm sezonu klima pik, otel yenileme Q1", dealerCount: 98 },
  { id: "adana", name: "Adana", populationTier: "tier-2", marketSharePercent: 44.2, avgPriceIndex: 0.94, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Regal", strength: 5 }, { brand: "Samsung", strength: 3 }], seasonalPattern: "Klima yıl boyunca güçlü, bayram kampanyaları etkili", dealerCount: 78 },
  { id: "konya", name: "Konya", populationTier: "tier-2", marketSharePercent: 50.2, avgPriceIndex: 0.91, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 6 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Tarım sezonu sonrası alım, Ramazan güçlü", dealerCount: 88 },
  { id: "gaziantep", name: "Gaziantep", populationTier: "tier-2", marketSharePercent: 43.1, avgPriceIndex: 0.95, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 5 }, { brand: "Samsung", strength: 3 }], seasonalPattern: "Düğün sezonu çok güçlü, Ramazan pik", dealerCount: 72 },
  { id: "mersin", name: "Mersin", populationTier: "tier-2", marketSharePercent: 40.5, avgPriceIndex: 0.96, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 5 }, { brand: "LG", strength: 4 }], seasonalPattern: "Liman şehri, klima Mayıs–Ekim güçlü", dealerCount: 56 },
  { id: "kayseri", name: "Kayseri", populationTier: "tier-2", marketSharePercent: 48.5, avgPriceIndex: 0.90, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 3 }], seasonalPattern: "Ticaret şehri, yıl boyunca stabil talep", dealerCount: 62 },
  { id: "diyarbakir", name: "Diyarbakır", populationTier: "tier-2", marketSharePercent: 45.8, avgPriceIndex: 0.87, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Regal", strength: 7 }, { brand: "Profilo", strength: 4 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Düğün sezonu çok güçlü Haz–Eyl, kış ısıtma talebi", dealerCount: 52 },
  { id: "samsun", name: "Samsun", populationTier: "tier-2", marketSharePercent: 44.6, avgPriceIndex: 0.93, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 3 }], seasonalPattern: "Fındık hasadı sonrası alım Eyl–Kas", dealerCount: 46 },
  { id: "trabzon", name: "Trabzon", populationTier: "tier-3", marketSharePercent: 46.3, avgPriceIndex: 0.89, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 4 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Çay hasadı sonrası alım, bayram pik", dealerCount: 36 },
  { id: "eskisehir", name: "Eskişehir", populationTier: "tier-3", marketSharePercent: 43.2, avgPriceIndex: 0.97, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Bosch", strength: 6 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 4 }], seasonalPattern: "Üniversite kenti, eylül yeni dönem talebi", dealerCount: 42 },
  { id: "denizli", name: "Denizli", populationTier: "tier-3", marketSharePercent: 47.2, avgPriceIndex: 0.94, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 3 }], seasonalPattern: "Tekstil şehri, yıl boyunca stabil", dealerCount: 39 },
  { id: "malatya", name: "Malatya", populationTier: "tier-3", marketSharePercent: 49.5, avgPriceIndex: 0.86, competitorStrength: [{ brand: "Vestel", strength: 4 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 3 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Kayısı hasadı sonrası Ağu–Eki alım artışı", dealerCount: 31 },
  { id: "erzurum", name: "Erzurum", populationTier: "tier-3", marketSharePercent: 48.7, avgPriceIndex: 0.84, competitorStrength: [{ brand: "Vestel", strength: 4 }, { brand: "Regal", strength: 7 }, { brand: "Profilo", strength: 3 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Kış uzun, klima talebi düşük, beyaz eşya bayram pik", dealerCount: 26 },
  { id: "van", name: "Van", populationTier: "tier-3", marketSharePercent: 47.4, avgPriceIndex: 0.82, competitorStrength: [{ brand: "Vestel", strength: 4 }, { brand: "Regal", strength: 8 }, { brand: "Profilo", strength: 3 }, { brand: "Samsung", strength: 1 }], seasonalPattern: "Düğün sezonu Haz–Eyl güçlü, fiyat hassasiyeti yüksek", dealerCount: 23 },
  { id: "manisa", name: "Manisa", populationTier: "tier-3", marketSharePercent: 28.4, avgPriceIndex: 0.95, competitorStrength: [{ brand: "Vestel", strength: 9 }, { brand: "Profilo", strength: 4 }, { brand: "Regal", strength: 4 }, { brand: "Bosch", strength: 3 }], seasonalPattern: "Vestel fabrikası şehri — Vestel burada çok güçlü", dealerCount: 34 },
  { id: "tekirdag", name: "Tekirdağ", populationTier: "tier-3", marketSharePercent: 43.8, avgPriceIndex: 0.97, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Bosch", strength: 5 }, { brand: "Samsung", strength: 4 }], seasonalPattern: "Sanayi bölgesi, yıl boyunca stabil talep", dealerCount: 29 },
];

const DEALERS = [
  { id: "d-01", storeName: "Yılmaz Elektronik", city: "istanbul", district: "Kadıköy", tier: "gold", complianceScore: 92, monthlySalesTarget: 85, currentProgress: 68, earnedCommission: 24500, productMix: { buzdolabi: 25, camasir: 22, bulasik: 18, firin: 12, klima: 8, "kucuk-ev": 10, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 24, camasir: 18, bulasik: 15, firin: 12, klima: 8, "kucuk-ev": 45, "tv-elektronik": 10 }, pendingOrders: 3, lastOrderDate: "2026-04-28" },
  { id: "d-02", storeName: "Anadolu Beyaz Eşya", city: "ankara", district: "Çankaya", tier: "gold", complianceScore: 95, monthlySalesTarget: 70, currentProgress: 62, earnedCommission: 21800, productMix: { buzdolabi: 28, camasir: 24, bulasik: 20, firin: 10, klima: 5, "kucuk-ev": 8, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 20, camasir: 16, bulasik: 14, firin: 10, klima: 5, "kucuk-ev": 38, "tv-elektronik": 8 }, pendingOrders: 2, lastOrderDate: "2026-04-30" },
  { id: "d-03", storeName: "Ege Teknik", city: "izmir", district: "Bornova", tier: "gold", complianceScore: 88, monthlySalesTarget: 65, currentProgress: 51, earnedCommission: 18200, productMix: { buzdolabi: 22, camasir: 20, bulasik: 18, firin: 14, klima: 12, "kucuk-ev": 9, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 18, camasir: 15, bulasik: 12, firin: 10, klima: 14, "kucuk-ev": 35, "tv-elektronik": 7 }, pendingOrders: 4, lastOrderDate: "2026-04-25" },
  { id: "d-04", storeName: "Güney Elektronik", city: "adana", district: "Seyhan", tier: "silver", complianceScore: 78, monthlySalesTarget: 50, currentProgress: 38, earnedCommission: 12400, productMix: { buzdolabi: 26, camasir: 22, bulasik: 16, firin: 12, klima: 14, "kucuk-ev": 7, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 12, camasir: 10, bulasik: 8, firin: 6, klima: 15, "kucuk-ev": 28, "tv-elektronik": 5 }, pendingOrders: 5, lastOrderDate: "2026-04-22" },
  { id: "d-05", storeName: "Merkez Beyaz Eşya", city: "konya", district: "Selçuklu", tier: "silver", complianceScore: 82, monthlySalesTarget: 55, currentProgress: 42, earnedCommission: 14800, productMix: { buzdolabi: 30, camasir: 25, bulasik: 18, firin: 10, klima: 5, "kucuk-ev": 8, "tv-elektronik": 4 }, stockLevels: { buzdolabi: 16, camasir: 12, bulasik: 10, firin: 8, klima: 4, "kucuk-ev": 30, "tv-elektronik": 6 }, pendingOrders: 3, lastOrderDate: "2026-04-27" },
  { id: "d-06", storeName: "Doğu Teknik Ticaret", city: "gaziantep", district: "Şahinbey", tier: "silver", complianceScore: 75, monthlySalesTarget: 45, currentProgress: 31, earnedCommission: 10200, productMix: { buzdolabi: 28, camasir: 23, bulasik: 17, firin: 12, klima: 10, "kucuk-ev": 7, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 10, camasir: 8, bulasik: 7, firin: 5, klima: 8, "kucuk-ev": 22, "tv-elektronik": 4 }, pendingOrders: 6, lastOrderDate: "2026-04-20" },
  { id: "d-07", storeName: "Akdeniz Ev Aletleri", city: "antalya", district: "Muratpaşa", tier: "gold", complianceScore: 90, monthlySalesTarget: 60, currentProgress: 52, earnedCommission: 19600, productMix: { buzdolabi: 20, camasir: 18, bulasik: 15, firin: 10, klima: 22, "kucuk-ev": 10, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 20, "kucuk-ev": 32, "tv-elektronik": 6 }, pendingOrders: 2, lastOrderDate: "2026-04-29" },
  { id: "d-08", storeName: "Bursa Beyaz Eşya Merkezi", city: "bursa", district: "Nilüfer", tier: "silver", complianceScore: 80, monthlySalesTarget: 55, currentProgress: 40, earnedCommission: 13800, productMix: { buzdolabi: 27, camasir: 24, bulasik: 19, firin: 11, klima: 7, "kucuk-ev": 8, "tv-elektronik": 4 }, stockLevels: { buzdolabi: 14, camasir: 11, bulasik: 9, firin: 7, klima: 6, "kucuk-ev": 26, "tv-elektronik": 5 }, pendingOrders: 4, lastOrderDate: "2026-04-24" },
  { id: "d-09", storeName: "İstanbul Avrupa Elektronik", city: "istanbul", district: "Bağcılar", tier: "silver", complianceScore: 76, monthlySalesTarget: 75, currentProgress: 48, earnedCommission: 15600, productMix: { buzdolabi: 24, camasir: 21, bulasik: 17, firin: 13, klima: 9, "kucuk-ev": 11, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 18, camasir: 14, bulasik: 12, firin: 9, klima: 7, "kucuk-ev": 40, "tv-elektronik": 8 }, pendingOrders: 5, lastOrderDate: "2026-04-26" },
  { id: "d-10", storeName: "Karadeniz Beyaz Eşya", city: "samsun", district: "Atakum", tier: "bronze", complianceScore: 68, monthlySalesTarget: 35, currentProgress: 22, earnedCommission: 6800, productMix: { buzdolabi: 30, camasir: 25, bulasik: 18, firin: 12, klima: 4, "kucuk-ev": 8, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 8, camasir: 6, bulasik: 5, firin: 4, klima: 2, "kucuk-ev": 18, "tv-elektronik": 3 }, pendingOrders: 2, lastOrderDate: "2026-04-18" },
  { id: "d-11", storeName: "Diyarbakır Ev Aletleri", city: "diyarbakir", district: "Kayapınar", tier: "bronze", complianceScore: 65, monthlySalesTarget: 40, currentProgress: 24, earnedCommission: 7200, productMix: { buzdolabi: 32, camasir: 26, bulasik: 16, firin: 10, klima: 8, "kucuk-ev": 5, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 7, camasir: 5, bulasik: 4, firin: 3, klima: 5, "kucuk-ev": 15, "tv-elektronik": 2 }, pendingOrders: 7, lastOrderDate: "2026-04-15" },
  { id: "d-12", storeName: "Kayseri Teknik", city: "kayseri", district: "Melikgazi", tier: "silver", complianceScore: 83, monthlySalesTarget: 45, currentProgress: 37, earnedCommission: 12800, productMix: { buzdolabi: 28, camasir: 24, bulasik: 19, firin: 11, klima: 6, "kucuk-ev": 8, "tv-elektronik": 4 }, stockLevels: { buzdolabi: 12, camasir: 10, bulasik: 8, firin: 6, klima: 4, "kucuk-ev": 25, "tv-elektronik": 4 }, pendingOrders: 3, lastOrderDate: "2026-04-27" },
  { id: "d-13", storeName: "Van Elektronik Pazarı", city: "van", district: "İpekyolu", tier: "bronze", complianceScore: 62, monthlySalesTarget: 30, currentProgress: 18, earnedCommission: 5400, productMix: { buzdolabi: 35, camasir: 28, bulasik: 15, firin: 10, klima: 3, "kucuk-ev": 6, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 5, camasir: 4, bulasik: 3, firin: 2, klima: 1, "kucuk-ev": 12, "tv-elektronik": 2 }, pendingOrders: 8, lastOrderDate: "2026-04-12" },
  { id: "d-14", storeName: "Eskişehir Arçelik Mağazası", city: "eskisehir", district: "Odunpazarı", tier: "silver", complianceScore: 85, monthlySalesTarget: 40, currentProgress: 33, earnedCommission: 11200, productMix: { buzdolabi: 22, camasir: 20, bulasik: 17, firin: 12, klima: 10, "kucuk-ev": 14, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 10, camasir: 8, bulasik: 7, firin: 5, klima: 6, "kucuk-ev": 30, "tv-elektronik": 5 }, pendingOrders: 2, lastOrderDate: "2026-04-29" },
  { id: "d-15", storeName: "Trabzon Beyaz Eşya", city: "trabzon", district: "Ortahisar", tier: "bronze", complianceScore: 70, monthlySalesTarget: 30, currentProgress: 20, earnedCommission: 6200, productMix: { buzdolabi: 30, camasir: 25, bulasik: 18, firin: 12, klima: 3, "kucuk-ev": 8, "tv-elektronik": 4 }, stockLevels: { buzdolabi: 6, camasir: 5, bulasik: 4, firin: 3, klima: 1, "kucuk-ev": 16, "tv-elektronik": 3 }, pendingOrders: 4, lastOrderDate: "2026-04-19" },
];

const CAMPAIGNS = [
  { id: "ramazan", name: "Ramazan Bayramı Kampanyası", targetSegment: "Bayram öncesi ev yenileyen aileler", eligibleCategories: ["buzdolabi", "camasir", "bulasik"], promotionType: "indirim + taksit", discountDetail: "%20 indirim + 12 ay taksit", headline: "Bayramda Evini Yenile, Arçelik İle Güle Güle Kullan", bodyCopy: "Bu Ramazan Bayramı'nda evinizi yenileyin. Arçelik'in seçili beyaz eşyalarında %20'ye varan indirim ve 12 aya kadar taksit fırsatı sizi bekliyor.", messagingTone: "Sıcak, aile odaklı, bayram kutlama havası", targetCities: ["istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "gaziantep", "adana"], durationPattern: "Bayram öncesi 3 hafta", projectedImpact: { marketShareLift: "+1.2%", revenueDelta: "+₺45M", marginEffect: "-0.8%" }, bannerDescription: "Beyaz arka planda Arçelik buzdolabı ve çamaşır makinesi, bayram teması, %20 indirim rozeti", dealerPosMessaging: "Bayram Kampanyası — Seçili beyaz eşyalarda %20 indirim + 12 ay taksit.", dealerSmsNotification: "Sayın Bayimiz, Ramazan Bayramı kampanyamız başladı. %20 indirim + 12 ay taksit." },
  { id: "dugun-sezonu", name: "Yaz Düğün Sezonu — Çeyiz Paketi", targetSegment: "Evlenmek üzere olan çiftler ve aileleri", eligibleCategories: ["buzdolabi", "camasir", "bulasik", "firin", "kucuk-ev"], promotionType: "paket indirim", discountDetail: "5 parça çeyiz paketi %25 indirim + 18 ay taksit", headline: "Yeni Yuvanıza Arçelik İle Başlayın — Çeyiz Paketi Kampanyası", bodyCopy: "Hayatınızın en önemli adımında yanınızdayız. Buzdolabı, çamaşır makinesi, bulaşık makinesi, fırın ve küçük ev aletlerinden oluşan çeyiz paketlerimizde %25'e varan indirim.", messagingTone: "Romantik, umut dolu, yeni başlangıç", targetCities: ["istanbul", "ankara", "izmir", "gaziantep", "diyarbakir", "konya", "bursa", "adana"], durationPattern: "Haziran–Eylül (4 ay)", projectedImpact: { marketShareLift: "+1.8%", revenueDelta: "+₺78M", marginEffect: "-1.2%" }, bannerDescription: "Genç çift mutfakta, Arçelik beyaz eşya paketi, kalp ikonu, %25 rozet", dealerPosMessaging: "Çeyiz Paketi Kampanyası — 5 ürün al %25 indirim.", dealerSmsNotification: "Yaz düğün sezonu kampanyası başladı! Çeyiz paketlerinde %25 indirim + 18 ay taksit." },
  { id: "okula-donus", name: "Okula Dönüş Kampanyası", targetSegment: "Üniversiteye başlayan öğrenciler ve aileleri", eligibleCategories: ["kucuk-ev", "klima", "tv-elektronik"], promotionType: "indirim", discountDetail: "%15 indirim + hediye ütü", headline: "Okula Dönüşte Arçelik Yanınızda — Öğrenci Paketi", bodyCopy: "Yeni eğitim dönemi için evinizi hazırlayın. Küçük ev aletleri, klima ve TV'lerde %15'e varan indirim.", messagingTone: "Enerjik, genç, pratik", targetCities: ["istanbul", "ankara", "izmir", "eskisehir", "antalya", "bursa"], durationPattern: "Ağustos sonları – Eylül ortası (3 hafta)", projectedImpact: { marketShareLift: "+0.6%", revenueDelta: "+₺18M", marginEffect: "-0.5%" }, bannerDescription: "Öğrenci evi, mini buzdolabı ve çay makinesi, kitaplar, %15 rozet", dealerPosMessaging: "Okula Dönüş — Küçük ev aletleri ve klimada %15 indirim.", dealerSmsNotification: "Okula dönüş kampanyası başladı. Küçük ev aletlerinde %15 indirim + hediye ütü." },
  { id: "yilbasi", name: "Yılbaşı İndirimi", targetSegment: "Premium segment tüketiciler, hediye alışverişi", eligibleCategories: ["tv-elektronik", "kucuk-ev", "buzdolabi"], promotionType: "indirim + hediye", discountDetail: "%10 indirim + ücretsiz kurulum + hediye paketleme", headline: "Yeni Yıla Yeni Teknoloji İle Girin — Arçelik Yılbaşı Fırsatları", bodyCopy: "Sevdiklerinize en güzel hediyeyi verin. Premium TV'ler, espresso makineleri ve seçili beyaz eşyalarda %10 indirim.", messagingTone: "Şık, premium, hediye odaklı", targetCities: ["istanbul", "ankara", "izmir", "antalya", "bursa"], durationPattern: "Aralık 15 – Ocak 5 (3 hafta)", projectedImpact: { marketShareLift: "+0.4%", revenueDelta: "+₺22M", marginEffect: "-0.3%" }, bannerDescription: "Yılbaşı ağacı, premium TV ve espresso makinesi, hediye paketi, %10 rozet", dealerPosMessaging: "Yılbaşı Kampanyası — Premium ürünlerde %10 indirim + ücretsiz kurulum.", dealerSmsNotification: "Yılbaşı kampanyası aktif! TV ve küçük ev aletlerinde %10 indirim + ücretsiz kurulum." },
  { id: "eski-yeni", name: "Eski-Yeni Değişim Kampanyası", targetSegment: "Eski cihazını yenilemek isteyen ev sahipleri", eligibleCategories: ["buzdolabi", "camasir", "bulasik", "firin", "klima"], promotionType: "trade-in", discountDetail: "Eski cihazınızı getirin, yeni ürünlerde ₺2.000–₺5.000 indirim", headline: "Eskiyi Getir, Yeniyi Götür — Arçelik Değişim Programı", bodyCopy: "Eski beyaz eşyanızın markası ve durumu fark etmez. Arçelik bayinize getirin, yeni Arçelik ürünlerinde ₺2.000 ile ₺5.000 arasında ek indirim kazanın.", messagingTone: "Pratik, güvenilir, çevreci", targetCities: ["istanbul", "ankara", "izmir", "bursa", "adana", "konya", "gaziantep", "kayseri", "antalya", "mersin"], durationPattern: "Yıl boyunca devam eden kampanya", projectedImpact: { marketShareLift: "+0.8%", revenueDelta: "+₺35M", marginEffect: "+0.2%" }, bannerDescription: "Eski buzdolabı → yeni Arçelik buzdolabı geçişi, geri dönüşüm ikonu, ₺5.000'e kadar rozet", dealerPosMessaging: "Değişim Programı — Eski cihaz getiren müşteriye ₺2K–₺5K ek indirim.", dealerSmsNotification: "Eski-yeni değişim kampanyası sürekli aktif. Eski cihaz getiren her müşteriye ₺2K–₺5K ek indirim sunabilirsiniz." },
  { id: "taksit", name: "Taksit Kampanyası — Banka İş Birliği", targetSegment: "Taksit arayan orta gelir grubu", eligibleCategories: ["buzdolabi", "camasir", "bulasik", "firin", "klima", "tv-elektronik"], promotionType: "taksit", discountDetail: "Tüm ürünlerde 24 aya kadar faizsiz taksit (Ziraat, Halkbank, Vakıfbank)", headline: "Arçelik'te 24 Aya Kadar Faizsiz Taksit — Devlet Bankaları İle", bodyCopy: "Ziraat Bankası, Halkbank ve Vakıfbank kredi kartlarınıza 24 aya kadar faizsiz taksit fırsatı.", messagingTone: "Güvenilir, devlet güvencesi, ekonomik", targetCities: ["istanbul", "ankara", "izmir", "bursa", "adana", "konya", "kayseri", "samsun", "trabzon", "erzurum", "van", "diyarbakir", "gaziantep", "malatya", "denizli"], durationPattern: "Banka anlaşma dönemi (genellikle Q2–Q3)", projectedImpact: { marketShareLift: "+1.5%", revenueDelta: "+₺62M", marginEffect: "-0.4%" }, bannerDescription: "Arçelik ürünleri, banka logoları, 24 ay taksit rozeti, güven ikonu", dealerPosMessaging: "24 Ay Faizsiz Taksit — Ziraat, Halkbank, Vakıfbank. Tüm ürünlerde geçerli.", dealerSmsNotification: "Banka taksit kampanyası başladı! 24 aya kadar faizsiz taksit." },
  { id: "enerji-verimlilik", name: "Enerji Verimliliği Kampanyası", targetSegment: "Enerji tasarrufu odaklı bilinçli tüketiciler", eligibleCategories: ["buzdolabi", "camasir", "bulasik", "klima"], promotionType: "indirim + ÖTV", discountDetail: "A+++ ürünlerde %12 ek indirim + ÖTV avantajı", headline: "Enerji Tasarrufu İle Hem Cebiniz Hem Dünya Kazansın", bodyCopy: "A+++ enerji sınıfı Arçelik ürünlerinde %12 ek indirim. Üstelik ÖTV avantajından da yararlanın.", messagingTone: "Bilinçli, modern, çevreci", targetCities: ["istanbul", "ankara", "izmir", "bursa", "antalya", "eskisehir"], durationPattern: "Enerji verimliliği haftası + devam (4 hafta)", projectedImpact: { marketShareLift: "+0.5%", revenueDelta: "+₺15M", marginEffect: "+0.3%" }, bannerDescription: "Yeşil yaprak, A+++ etiketi, Arçelik buzdolabı, enerji tasarruf ikonu, %12 rozet", dealerPosMessaging: "A+++ Ürünlerde %12 Ek İndirim — ÖTV avantajıyla birleştiğinde müşteriye büyük fırsat.", dealerSmsNotification: "Enerji verimliliği kampanyası! A+++ ürünlerde %12 ek indirim + ÖTV avantajı." },
  { id: "bayi-ozel", name: "Bayi Özel Bölgesel Kampanya", targetSegment: "Bölgesel rekabet yoğun şehirlerdeki müşteriler", eligibleCategories: ["buzdolabi", "camasir", "bulasik"], promotionType: "bölgesel indirim + hediye", discountDetail: "%18 bölgesel indirim + hediye set üstü ocak", headline: "Bölgenize Özel Arçelik Fırsatı — Sadece Seçili Bayilerde", bodyCopy: "Vestel'in güçlü olduğu şehirlerde özel Arçelik fırsatları. Seçili beyaz eşyalarda %18 bölgesel indirim.", messagingTone: "Acil, fırsat, yerel", targetCities: ["manisa", "samsun", "trabzon", "diyarbakir", "van", "erzurum", "malatya"], durationPattern: "2 hafta (rakip kampanya tepkisi)", projectedImpact: { marketShareLift: "+2.1%", revenueDelta: "+₺12M", marginEffect: "-1.5%" }, bannerDescription: "Bölgesel harita vurgusu, Arçelik beyaz eşya, %18 rozet", dealerPosMessaging: "Bölgesel Özel Kampanya — %18 indirim + hediye ocak.", dealerSmsNotification: "ACİL: Bölgesel kampanya başladı! %18 indirim + hediye ocak. 2 hafta sürecek." },
];

const CALENDAR = [
  { id: "arc-ramazan", brand: "Arçelik", campaignName: "Ramazan Bayramı Kampanyası", startMonth: 3, endMonth: 4, categories: ["buzdolabi", "camasir", "bulasik"], type: "confirmed" },
  { id: "arc-dugun", brand: "Arçelik", campaignName: "Çeyiz Paketi Kampanyası", startMonth: 6, endMonth: 9, categories: ["buzdolabi", "camasir", "bulasik", "firin"], type: "confirmed" },
  { id: "arc-okul", brand: "Arçelik", campaignName: "Okula Dönüş", startMonth: 8, endMonth: 9, categories: ["kucuk-ev", "klima", "tv-elektronik"], type: "confirmed" },
  { id: "arc-yilbasi", brand: "Arçelik", campaignName: "Yılbaşı İndirimi", startMonth: 12, endMonth: 1, categories: ["tv-elektronik", "kucuk-ev"], type: "confirmed" },
  { id: "arc-taksit", brand: "Arçelik", campaignName: "Banka Taksit Kampanyası", startMonth: 4, endMonth: 7, categories: ["buzdolabi", "camasir", "bulasik", "firin", "klima", "tv-elektronik"], type: "confirmed" },
  { id: "ves-bahar", brand: "Vestel", campaignName: "Bahar Kampanyası (Tahmini)", startMonth: 3, endMonth: 5, categories: ["buzdolabi", "camasir"], type: "predicted" },
  { id: "ves-yaz", brand: "Vestel", campaignName: "Yaz Fırsat Günleri (Tahmini)", startMonth: 6, endMonth: 7, categories: ["klima", "buzdolabi"], type: "predicted" },
  { id: "ves-kasim", brand: "Vestel", campaignName: "Kasım İndirimleri (Tahmini)", startMonth: 11, endMonth: 11, categories: ["tv-elektronik", "kucuk-ev", "buzdolabi"], type: "predicted" },
  { id: "bsh-bahar", brand: "Bosch/Profilo", campaignName: "İlkbahar Yenileme (Tahmini)", startMonth: 4, endMonth: 5, categories: ["buzdolabi", "bulasik", "firin"], type: "predicted" },
  { id: "bsh-sonbahar", brand: "Bosch/Profilo", campaignName: "Sonbahar Premium (Tahmini)", startMonth: 9, endMonth: 10, categories: ["buzdolabi", "camasir", "bulasik"], type: "predicted" },
  { id: "sam-tech", brand: "Samsung", campaignName: "Galaxy + Ev Aletleri (Tahmini)", startMonth: 2, endMonth: 3, categories: ["tv-elektronik", "buzdolabi", "camasir"], type: "predicted" },
  { id: "sam-bf", brand: "Samsung", campaignName: "Black Friday (Tahmini)", startMonth: 11, endMonth: 11, categories: ["tv-elektronik", "buzdolabi"], type: "predicted" },
  { id: "lg-yaz", brand: "LG", campaignName: "LG Yaz Kampanyası (Tahmini)", startMonth: 5, endMonth: 7, categories: ["klima", "tv-elektronik", "buzdolabi"], type: "predicted" },
  { id: "lg-bf", brand: "LG", campaignName: "LG Black Friday (Tahmini)", startMonth: 11, endMonth: 11, categories: ["tv-elektronik", "camasir"], type: "predicted" },
  { id: "gap-1", brand: "GAP", campaignName: "Fırsat Penceresi: Ocak sonu", startMonth: 1, endMonth: 2, categories: ["buzdolabi", "camasir", "bulasik"], type: "predicted" },
  { id: "gap-2", brand: "GAP", campaignName: "Fırsat Penceresi: Temmuz ortası", startMonth: 7, endMonth: 8, categories: ["klima", "buzdolabi"], type: "predicted" },
];

const KPI_BENCHMARKS = [
  { id: "national-market-share", label: "Ulusal Pazar Payı (Toplam)", value: "%45.2", target: "%48.0" },
  { id: "buzdolabi-share", label: "Buzdolabı Pazar Payı", value: "%47.8", target: "%50.0" },
  { id: "camasir-share", label: "Çamaşır Makinesi Pazar Payı", value: "%44.1", target: "%47.0" },
  { id: "avg-margin", label: "Ortalama Brüt Marj", value: "%30.2", target: "%31.0" },
  { id: "dealer-compliance", label: "Bayi Uyum Oranı", value: "%79.4", target: "%85.0" },
  { id: "campaign-roi", label: "Kampanya ROI (Ortalama)", value: "3.2x", target: "4.0x" },
  { id: "competitor-price-index", label: "Rakip Fiyat Endeksi", value: "1.00", target: "0.95–1.05" },
  { id: "dealer-satisfaction", label: "Bayi Memnuniyet Skoru", value: "7.4/10", target: "8.0/10" },
];

function recomputeDeltas(
  competitors: typeof FALLBACK_COMPETITOR_PRICES,
  products: typeof FALLBACK_PRODUCTS,
) {
  const productPriceMap = new Map(products.map((p) => [p.id, p.tsfPrice]));
  let recomputed = 0;
  for (const cp of competitors) {
    const arcelikPrice = productPriceMap.get(cp.arcelikEquivalentId);
    if (arcelikPrice && arcelikPrice > 0) {
      cp.priceDeltaPercent = Math.round(((cp.competitorPrice - arcelikPrice) / arcelikPrice) * 100);
      recomputed++;
    }
  }
  console.log(`\n📐 Recomputed priceDeltaPercent for ${recomputed}/${competitors.length} competitor entries`);
}

function printCoverageReport(
  products: Record<string, unknown>[],
  competitors: Record<string, unknown>[],
) {
  const categories = new Set(products.map((p) => p.category as string));
  const brands = new Set(competitors.map((c) => c.brand as string));
  const scrapedProducts = products.filter((p) => p.dataProvenance === "auto-scraped").length;
  const scrapedCompetitors = competitors.filter((c) => c.dataProvenance === "auto-scraped").length;
  const manualProducts = products.filter((p) => p.dataProvenance === "manual-verified").length;
  const manualCompetitors = competitors.filter((c) => c.dataProvenance === "manual-verified").length;

  console.log("\n📋 Data Coverage Report:");
  console.log(`  Products: ${products.length} across ${categories.size} categories`);
  console.log(`  Competitor prices: ${competitors.length} across ${brands.size} brands`);
  console.log(`  Provenance breakdown:`);
  console.log(`    Products — auto-scraped: ${scrapedProducts}, manual-verified: ${manualProducts}`);
  console.log(`    Competitors — auto-scraped: ${scrapedCompetitors}, manual-verified: ${manualCompetitors}`);
  console.log(`  Scrape coverage: products ${Math.round((scrapedProducts / products.length) * 100)}%, competitors ${Math.round((scrapedCompetitors / competitors.length) * 100)}%`);
  if (scrapedProducts === 0 && scrapedCompetitors === 0) {
    console.log("  ⚠️  No auto-scraped prices. All data from manual-verified baselines.");
    console.log("     Run with default (no --no-scrape) to attempt live scraping.");
  }
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== Seeding Arçelik data ===");

  let products = [...FALLBACK_PRODUCTS];
  let competitorPrices = [...FALLBACK_COMPETITOR_PRICES];

  if (NO_SCRAPE) {
    console.log("Skipping live scrape (--no-scrape flag set)");
    console.log("Using verified baseline data sourced from arcelik.com.tr, beko.com.tr, vestel.com.tr, bosch-home.com.tr, samsung.com/tr");
  } else {
    console.log("\n🔍 Scraping live prices from websites (default behavior, pass --no-scrape to skip)...");
    const scraped = await runScrapers();
    const totalScraped = Object.values(scraped).reduce((s, arr) => s + arr.length, 0);
    if (totalScraped > 0) {
      console.log(`\n📊 Scraped ${totalScraped} total prices from live sites, merging with dataset...`);
      products = applyScrapedPrices(products, scraped);
      competitorPrices = applyScrapedCompetitorPrices(competitorPrices, scraped, products);
    } else {
      console.log("\n⚠️  No prices scraped (sites may be blocking requests). Using verified baseline data.");
    }
  }

  recomputeDeltas(competitorPrices, products);
  printCoverageReport(products, competitorPrices);

  await upsertAll(arcelikDataSourcesTable, DATA_SOURCES, "data sources");
  await upsertAll(arcelikProductsTable, products, "products");
  await upsertAll(arcelikCompetitorPricesTable, competitorPrices, "competitor prices");
  await upsertAll(arcelikCitiesTable, CITIES, "cities");
  await upsertAll(arcelikDealersTable, DEALERS, "dealers");
  await upsertAll(arcelikCampaignsTable, CAMPAIGNS, "campaigns");
  await upsertAll(arcelikCalendarTable, CALENDAR, "calendar entries");
  await upsertAll(arcelikKpiBenchmarksTable, KPI_BENCHMARKS, "KPI benchmarks");

  console.log("Done!");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
