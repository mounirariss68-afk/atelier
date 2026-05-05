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
import {
  evaluateScrapeRunHealth,
  formatHealthSummary,
  logHealthEvaluation,
} from "./scrape-health";
import { sendEmail } from "./email";

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

// LG TV cards glue a discount badge with current+original prices into a
// single .cell-price string like "%14.29149.999,00 TL174.999,00 TL"; passing
// that to parseTurkishPrice returns ~46M. Extract every "X.XXX,XX TL" match
// and return the minimum — the sale/current price is always the lower of the
// two. Falls back to parseTurkishPrice for clean (single-price) cards.
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

// ---------------------------------------------------------------------------
// Shared brand-site category lists. Mirrored exactly in scripts/src/seed-arcelik.ts
// so seed-time and runtime scrapes walk the same catalogs. Categories that 404
// for a given brand are skipped silently by the per-page try/catch — keeping
// candidate lists generous is intentional so adding categories does not require
// risk-free verification of every slug on every site.
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

// Beko shares the Hybris taxonomy with Arçelik, with a couple of slug
// variations. We list its own array so divergence is explicit rather than
// implied by a `.slice()` from Arçelik's list.
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
// (May 2026).
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

// LG TR catalog. URLs follow /tr/{topcategory}/{subcategory}/. Cards render as
// li.c-product-list__item with .c-product-item__sku and .cell-price (the
// clean current/sale price). Note: the parent .neo-price--price wraps a
// badge + current + strikethrough into one concatenated text node, so we MUST
// query .cell-price specifically — never .cell-price OR .neo-price--price,
// since DOM order would return the dirty parent instead. Discovered via
// Playwright probe (May 2026).
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

// Profilo (BSH brand) — listings under profilo.com/tr/tr/category/{tree} use
// the same product-teaser markup as Bosch (data-testid^="product-teaser-
// container-for-"). profilo.com.tr returns invalid SSL certs; profilo.com is
// canonical. Discovered via Playwright probe (May 2026).
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

// Siemens TR (siemens-home.bsh-group.com) — same BSH React-rendered
// product-teaser markup as Bosch and Profilo, routed under /tr/tr/category/.
// Real catalog confirmed via Playwright probe (May 2026 re-probe): the
// /urunler/* path is marketing-only, but /tr/tr/category/* renders 12+
// product-teaser cards with full SKUs and prices, identical to Bosch.
const SIEMENS_CATEGORIES = [
  "buzdolaplari-ve-derin-dondurucular",
  "buzdolaplari-ve-derin-dondurucular/ankastre-buzdolaplari-ve-derin-dondurucular",
  "buzdolaplari-ve-derin-dondurucular/solo-buzdolaplari-ve-derin-dondurucular",
  "yikama-ve-utuleme-grubu/camasir-makineleri",
  "yikama-ve-utuleme-grubu/kurutma-makineleri",
  "yikama-ve-utuleme-grubu/kurutmali-camasir-makineleri",
  "bulasik-makineleri",
  "bulasik-makineleri/ankastre-bulasik-makineleri",
  "bulasik-makineleri/solo-bulasik-makineleri",
  "pisirme-grubu",
] as const;

// Grundig (Arçelik-owned) — Hybris article.prd.product-item cards under
// root-level /{slug} URLs. Same paginator/markup as Arçelik & Beko.
// Discovered via Playwright probe (May 2026).
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

/**
 * Dedupe scraped prices within a brand by normalized model code. The same
 * SKU can appear in multiple categories (e.g. a no-frost fridge is in both
 * `/buzdolabi` and `/no-frost-buzdolabi`); we keep the first occurrence so
 * downstream matching does not double-count the brand's catalog size.
 */
function dedupeByModel(items: ScrapedPrice[]): ScrapedPrice[] {
  const seen = new Map<string, ScrapedPrice>();
  for (const item of items) {
    const key = normalizeModelKey(item.modelCode);
    if (key && !seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
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

// ---------------------------------------------------------------------------
// Türkiye storefront hints
//
// Trendyol broke when our Replit egress (GB IP) was geo-detected and bounced
// to /en/select-country. Other Turkish marketplaces and brand sites can adopt
// the same behaviour at any time. These two helpers give every scraper a
// uniform opt-in defence and a uniform diagnostic when the defence fails.
//
// `newTurkiyeContext`: creates a BrowserContext pre-loaded with TR locale,
// Europe/Istanbul timezone, Turkish Accept-Language, and (for any opt-in
// domain) a generous union of country/locale cookies that cover the names
// observed in the wild on Turkish marketplaces and brand sites. Sites that
// don't recognise a particular cookie name silently ignore it.
//
// `warnIfNonTurkiyeUrl`: inspects `page.url()` after navigation and emits a
// structured warning when the final URL is on a country-picker page, has a
// non-TR locale path prefix, or has been redirected off the expected host.
// This makes geo-routing regressions diagnosable from logs alone — no need
// to reproduce the GB-egress condition manually.
// ---------------------------------------------------------------------------

async function newTurkiyeContext(
  browser: Browser,
  opts: {
    cookieDomains?: string[];
    userAgent?: string;
    viewport?: { width: number; height: number };
  } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent:
      opts.userAgent ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    viewport: opts.viewport ?? { width: 1366, height: 900 },
    extraHTTPHeaders: {
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    },
  });

  const domains = opts.cookieDomains ?? [];
  if (domains.length > 0) {
    const cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
    }> = [];
    for (const bare of domains) {
      const dot = bare.startsWith(".") ? bare : `.${bare}`;
      // Generic country/locale cookies covering the cookie-name variants we
      // have observed across Turkish marketplaces and brand sites (Trendyol,
      // N11, Samsung, etc). Setting a small union is intentional — sites
      // that don't recognise a given name simply ignore it, and the helper
      // stays useful for new domains without additional code changes.
      const generic: Array<{ name: string; value: string }> = [
        { name: "countryCode", value: "TR" },
        { name: "country_code", value: "TR" },
        { name: "country_codes", value: "tr" },
        { name: "country_region", value: "TR" },
        { name: "language", value: "tr" },
        { name: "locale", value: "tr-TR" },
      ];
      for (const c of generic) {
        cookies.push({ ...c, domain: dot, path: "/" });
      }
      // Trendyol-specific: storefrontId is the actual lever that bypasses
      // the /en/select-country redirect — countryCode alone is not enough.
      if (bare.endsWith("trendyol.com")) {
        cookies.push({
          name: "storefrontId",
          value: "1",
          domain: dot,
          path: "/",
        });
      }
    }
    await context.addCookies(cookies);
  }
  return context;
}

const TURKIYE_GEO_PICKER_RE = /select[-_]country|country[-_]selector|country-picker/i;
const TURKIYE_NON_TR_LOCALE_PREFIX_RE =
  /^\/(en|ar|de|fr|es|it|ru|zh|ja|ko|pt|nl|pl|cs|sv|fi|da|no|el|hu|ro|bg|uk|he|fa)(\/|$)/i;

function warnIfNonTurkiyeUrl(
  page: Page,
  ctx: { brand: string; expectedHost: string; requestedUrl: string },
): boolean {
  const finalUrl = page.url();
  let host = "";
  let pathname = "";
  try {
    const u = new URL(finalUrl);
    host = u.host;
    pathname = u.pathname;
  } catch {
    // Unparseable URL — leave host/pathname empty and fall through. The
    // mismatch checks below are no-ops on empty strings, so we only warn
    // when we actually have evidence of a geo-redirect.
  }

  const hasGeoPicker = TURKIYE_GEO_PICKER_RE.test(pathname);
  const hasNonTrLocale = TURKIYE_NON_TR_LOCALE_PREFIX_RE.test(pathname);
  const hostMismatch = host !== "" && !host.includes(ctx.expectedHost);

  if (hasGeoPicker || hasNonTrLocale || hostMismatch) {
    const reason = hasGeoPicker
      ? "geo-picker-redirect"
      : hasNonTrLocale
        ? "non-tr-locale-prefix"
        : "host-mismatch";
    logger.warn(
      {
        brand: ctx.brand,
        requestedUrl: ctx.requestedUrl,
        finalUrl,
        expectedHost: ctx.expectedHost,
        reason,
      },
      `${ctx.brand} scrape landed on a non-Türkiye URL — site may have added geo-routing; check storefront hints in newTurkiyeContext()`,
    );
    return true;
  }
  return false;
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
  // Derive the cookie domain from the baseUrl so any opt-in brand site
  // (arcelik.com.tr, beko.com.tr, etc.) gets the Türkiye storefront cookies
  // automatically. Strip the leading "www." so cookies attach to the eTLD+1.
  const baseHost = (() => {
    try {
      return new URL(baseUrl).host.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: baseHost ? [baseHost] : [],
  });

  try {
    for (const cat of categories) {
      const url = `${baseUrl}/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        if (baseHost) {
          warnIfNonTurkiyeUrl(page, {
            brand: brandLabel,
            expectedHost: baseHost,
            requestedUrl: url,
          });
        }
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

/**
 * Vestel category pages render a small initial set and stream more via
 * scroll-triggered AJAX. We use Playwright to scroll the page in a bounded
 * loop until the product count stabilises (no new items after a scroll), then
 * read the full DOM. Cap iterations at 25 so a runaway category cannot stall
 * the daily scrape.
 */
async function scrapeVestel(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping Vestel scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["vestel.com.tr"],
  });

  try {
    for (const cat of VESTEL_CATEGORIES) {
      const url = `https://www.vestel.com.tr/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        warnIfNonTurkiyeUrl(page, {
          brand: "Vestel",
          expectedHost: "vestel.com.tr",
          requestedUrl: url,
        });
        await page
          .waitForSelector(".product-list-item-wrap", { timeout: 10000 })
          .catch(() => {});

        // Scroll-loop: stop once two consecutive scrolls add nothing.
        let prevCount = 0;
        let stableScrolls = 0;
        for (let i = 0; i < 25; i++) {
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
          await page.waitForTimeout(800);
          const count = await page
            .locator(".product-list-item-wrap")
            .count();
          if (count === prevCount) {
            stableScrolls++;
            if (stableScrolls >= 2) break;
          } else {
            stableScrolls = 0;
            prevCount = count;
          }
        }

        const items = await page.evaluate(() => {
          const out: { name: string; priceText: string; modelCode: string }[] =
            [];
          document
            .querySelectorAll(".product-list-item-wrap")
            .forEach((el) => {
              const name =
                el
                  .querySelector(".product-title, .product-name, h3")
                  ?.textContent?.trim() || "";
              const priceText =
                el
                  .querySelector(
                    ".product-price-helper, .product-price, .price",
                  )
                  ?.textContent?.trim() || "";
              const modelCode =
                el.getAttribute("data-product-id") ||
                el
                  .querySelector("[data-product-id]")
                  ?.getAttribute("data-product-id") ||
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
              (modelMatch
                ? modelMatch[1].trim().toUpperCase()
                : item.name.slice(0, 30)),
            name: item.name,
            price,
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          });
          pageAdded++;
        }
        logger.info(
          { url, domCount: prevCount, accepted: pageAdded },
          "Vestel category scraped",
        );
      } catch (err) {
        logger.warn({ url, err }, "Vestel page scrape failed");
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

/**
 * Bosch category pages render an initial 12 products and reveal more via a
 * "Daha fazla görüntüle" button. We click the button in a bounded loop until
 * it disappears or two consecutive clicks add no new products. Cap at 30
 * clicks so a malfunctioning button cannot stall the cycle.
 */
async function scrapeBosch(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping Bosch scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["bosch-home.com.tr"],
  });

  try {
    for (const cat of BOSCH_CATEGORIES) {
      const url = `https://www.bosch-home.com.tr/tr/category/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        warnIfNonTurkiyeUrl(page, {
          brand: "Bosch",
          expectedHost: "bosch-home.com.tr",
          requestedUrl: url,
        });
        await page
          .waitForSelector(
            '[data-testid^="product-teaser-container-for-"]',
            { timeout: 10000 },
          )
          .catch(() => {});

        // Click-more loop. Bosch labels the load-more affordance "Daha fazla
        // görüntüle" but defensively we also match plain "Daha fazla" and any
        // [data-testid*="show-more"] button in case the locale string drifts.
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
          const out: { name: string; modelCode: string; priceText: string }[] =
            [];
          document
            .querySelectorAll(
              '[data-testid^="product-teaser-container-for-"]',
            )
            .forEach((el) => {
              const rawName =
                el
                  .querySelector(
                    '[data-testid="product-teaser-header-headline"]',
                  )
                  ?.textContent?.trim() || "";
              const name =
                rawName.includes("{") || rawName.includes("@media")
                  ? ""
                  : rawName;
              const modelCode =
                el
                  .querySelector('[data-testid="product-code"]')
                  ?.textContent?.trim() || "";
              const priceText =
                el
                  .querySelector('[data-testid="price-main-price"]')
                  ?.textContent?.trim() || "";
              if (modelCode && priceText)
                out.push({ name, modelCode, priceText });
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
        logger.info(
          { url, domCount: prevCount, accepted: pageAdded },
          "Bosch category scraped",
        );
      } catch (err) {
        logger.warn({ url, err }, "Bosch page scrape failed");
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

/**
 * Samsung TR category pages embed product data in JSON-LD ItemList blocks
 * (capped at ~18 per page) AND render the full catalog as React-driven DOM
 * cards. We use Playwright to read both: scroll to trigger lazy-loading,
 * collect from JSON-LD first (richest data: SKU + price), then walk DOM
 * cards to capture anything beyond the JSON-LD truncation.
 */
async function scrapeSamsung(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping Samsung scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["samsung.com"],
  });

  try {
    for (const cat of SAMSUNG_CATEGORIES) {
      const url = `https://www.samsung.com/tr/${cat}/`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        warnIfNonTurkiyeUrl(page, {
          brand: "Samsung",
          expectedHost: "samsung.com",
          requestedUrl: url,
        });

        // Scroll to trigger lazy-loaded product cards
        for (let i = 0; i < 12; i++) {
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
          await page.waitForTimeout(500);
        }

        // Click any "Daha fazla" / "Show more" affordance if present
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
          const out: {
            name: string;
            modelCode: string;
            priceText: string;
          }[] = [];
          const seenSku = new Set<string>();

          // Pass 1: JSON-LD ItemList (richest source: canonical SKU + price)
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
                  let modelCode = String(
                    item.sku || item.productID || item.model || "",
                  );
                  if (!modelCode && item.url) {
                    const slug =
                      String(item.url).split("/").filter(Boolean).pop() || "";
                    const codeMatch = slug.match(
                      /[-]([a-z]{2}\d{2,}[a-z0-9]*)\/?$/i,
                    );
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

          // Pass 2: DOM product cards. Samsung has shipped multiple card
          // markup variants over the years; query a generous union and rely
          // on dedupeKey to avoid duplicates.
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
          // JSON-LD prices arrive as plain numeric strings; parseFloat handles
          // them. Fallback to Turkish-localised parsing for DOM-card text.
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
        logger.info(
          { url, accepted: pageAdded },
          "Samsung category scraped",
        );
      } catch (err) {
        logger.warn({ url, err }, "Samsung page scrape failed");
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
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

  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["n11.com"],
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
          warnIfNonTurkiyeUrl(page, {
            brand: "N11",
            expectedHost: "n11.com",
            requestedUrl: url,
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

  // Trendyol geo-detects non-TR IPs (Replit egress is GB) and redirects /sr
  // requests to /en/select-country, which renders zero product cards. The
  // shared `newTurkiyeContext` helper pre-seeds storefrontId / countryCode /
  // language cookies on .trendyol.com so the request lands on the Türkiye
  // storefront directly. Without these cookies the scrape returns 0 products
  // even though the underlying selectors (a.product-card[id]) are unchanged.
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["trendyol.com"],
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
          warnIfNonTurkiyeUrl(page, {
            brand: "Trendyol",
            expectedHost: "trendyol.com",
            requestedUrl: url,
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

  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["n11.com"],
  });

  try {
    for (const target of targets) {
      const page: Page = await context.newPage();
      try {
        await page.goto(target.productUrl, {
          waitUntil: "domcontentloaded",
          timeout: 25000,
        });
        warnIfNonTurkiyeUrl(page, {
          brand: "N11 PDP",
          expectedHost: "n11.com",
          requestedUrl: target.productUrl,
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

// LG TR scraper. Cards lazy-load on scroll; no explicit "show more"
// affordance was observed during probing. Bounded scroll loop until the
// product count stabilises.
async function scrapeLG(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping LG scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["lg.com"],
  });

  try {
    for (const cat of LG_CATEGORIES) {
      const url = `https://www.lg.com/tr/${cat}/`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        warnIfNonTurkiyeUrl(page, {
          brand: "LG",
          expectedHost: "lg.com",
          requestedUrl: url,
        });
        await page
          .waitForSelector("li.c-product-list__item", { timeout: 10000 })
          .catch(() => {});

        const productLocator = page.locator("li.c-product-list__item");
        let prevCount = 0;
        let stableScrolls = 0;
        for (let i = 0; i < 20; i++) {
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
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
          const out: { name: string; modelCode: string; priceText: string }[] =
            [];
          document.querySelectorAll("li.c-product-list__item").forEach((el) => {
            const sku =
              el.querySelector(".c-product-item__sku")?.textContent?.trim() ||
              "";
            // Heading text contains the SKU + UI sentinel "Copy model name"
            // tokens; strip both to get a usable display name.
            const topText =
              el
                .querySelector(".neo-card--top, .neo-card--default")
                ?.textContent?.trim() || "";
            const name = topText
              .replace(sku, "")
              .replace(/Copy model name.*$/, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200);
            // .cell-price contains ONLY the clean current price. The
            // parent .neo-price--price concatenates the discount badge,
            // current price, and strikethrough original price into a single
            // text node ("%14.29149.999,00 TL174.999,00 TL") which corrupts
            // parsing — never use it as a fallback.
            const priceText =
              el.querySelector(".cell-price")?.textContent?.trim() || "";
            if (sku && priceText)
              out.push({ name: name || sku, modelCode: sku, priceText });
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
        logger.info(
          { url, domCount: prevCount, accepted: pageAdded },
          "LG category scraped",
        );
      } catch (err) {
        logger.warn({ url, err }, "LG page scrape failed");
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// Profilo (BSH brand) — same product-teaser markup as Bosch, routed under
// /tr/tr/category/. Click-more loop mirrors scrapeBosch since the BSH
// paginator is identical across brand sites.
async function scrapeProfilo(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping Profilo scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["profilo.com"],
  });

  try {
    for (const cat of PROFILO_CATEGORIES) {
      const url = `https://www.profilo.com/tr/tr/category/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        warnIfNonTurkiyeUrl(page, {
          brand: "Profilo",
          expectedHost: "profilo.com",
          requestedUrl: url,
        });
        await page
          .waitForSelector(
            '[data-testid^="product-teaser-container-for-"]',
            { timeout: 10000 },
          )
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
          const out: { name: string; modelCode: string; priceText: string }[] =
            [];
          document
            .querySelectorAll(
              '[data-testid^="product-teaser-container-for-"]',
            )
            .forEach((el) => {
              const rawName =
                el
                  .querySelector(
                    '[data-testid="product-teaser-header-headline"]',
                  )
                  ?.textContent?.trim() || "";
              const name =
                rawName.includes("{") || rawName.includes("@media")
                  ? ""
                  : rawName;
              const modelCode =
                el
                  .querySelector('[data-testid="product-code"]')
                  ?.textContent?.trim() || "";
              const priceText =
                el
                  .querySelector('[data-testid="price-main-price"]')
                  ?.textContent?.trim() || "";
              if (modelCode && priceText)
                out.push({ name, modelCode, priceText });
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
        logger.info(
          { url, domCount: prevCount, accepted: pageAdded },
          "Profilo category scraped",
        );
      } catch (err) {
        logger.warn({ url, err }, "Profilo page scrape failed");
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// Grundig (Arçelik-owned) — Hybris article.prd.product-item cards under
// root-level /{slug}. Uses the same data-gtm-impression payload as Arçelik
// & Beko which carries name/id/price as canonical JSON. Bounded scroll
// loop covers any lazy pagination.
async function scrapeGrundig(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping Grundig scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["grundig.com.tr"],
  });

  try {
    for (const cat of GRUNDIG_CATEGORIES) {
      const url = `https://www.grundig.com.tr/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        warnIfNonTurkiyeUrl(page, {
          brand: "Grundig",
          expectedHost: "grundig.com.tr",
          requestedUrl: url,
        });
        await page
          .waitForSelector("article.prd.product-item", { timeout: 10000 })
          .catch(() => {});

        const productLocator = page.locator("article.prd.product-item");
        let prevCount = 0;
        let stableScrolls = 0;
        for (let i = 0; i < 20; i++) {
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
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
          const out: {
            name: string;
            modelCode: string;
            priceText: string;
            gtmPrice: string;
          }[] = [];
          document
            .querySelectorAll("article.prd.product-item")
            .forEach((el) => {
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
                el
                  .querySelector("[data-product-code]")
                  ?.getAttribute("data-product-code") ||
                el.getAttribute("data-product-code") ||
                "";
              const nameAttr =
                el
                  .querySelector("[data-product-name]")
                  ?.getAttribute("data-product-name") || "";
              const priceText =
                el
                  .querySelector("span.prc.prc-last")
                  ?.textContent?.trim() ||
                el
                  .querySelector(".prd-price, .prd-footer")
                  ?.textContent?.trim() ||
                "";
              const name = gtmName || nameAttr;
              const modelCode = gtmId || codeAttr;
              if (name && (priceText || gtmPrice))
                out.push({ name, modelCode, priceText, gtmPrice });
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
        logger.info(
          { url, domCount: prevCount, accepted: pageAdded },
          "Grundig category scraped",
        );
      } catch (err) {
        logger.warn({ url, err }, "Grundig page scrape failed");
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// Siemens TR (siemens-home.bsh-group.com) — BSH React product-teaser
// markup, identical to Bosch and Profilo. The /urunler/* path is
// marketing-only, but /tr/tr/category/* is the real catalog (confirmed
// May 2026 re-probe: 12 product-teasers per page on /buzdolaplari-ve-derin-
// dondurucular). Mirrors scrapeBosch click-more behavior.
async function scrapeSiemens(): Promise<ScrapedPrice[]> {
  const browser = await getPlaywrightBrowser();
  if (!browser) {
    logger.info("Skipping Siemens scrape (Playwright not available)");
    return [];
  }

  const results: ScrapedPrice[] = [];
  const context: BrowserContext = await newTurkiyeContext(browser, {
    cookieDomains: ["siemens-home.bsh-group.com"],
  });

  try {
    for (const cat of SIEMENS_CATEGORIES) {
      const url = `https://www.siemens-home.bsh-group.com/tr/tr/category/${cat}`;
      const page: Page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        warnIfNonTurkiyeUrl(page, {
          brand: "Siemens",
          expectedHost: "siemens-home.bsh-group.com",
          requestedUrl: url,
        });
        await page
          .waitForSelector(
            '[data-testid^="product-teaser-container-for-"]',
            { timeout: 10000 },
          )
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
          const out: { name: string; modelCode: string; priceText: string }[] =
            [];
          document
            .querySelectorAll(
              '[data-testid^="product-teaser-container-for-"]',
            )
            .forEach((el) => {
              const rawName =
                el
                  .querySelector(
                    '[data-testid="product-teaser-header-headline"]',
                  )
                  ?.textContent?.trim() || "";
              const name =
                rawName.includes("{") || rawName.includes("@media")
                  ? ""
                  : rawName;
              const modelCode =
                el
                  .querySelector('[data-testid="product-code"]')
                  ?.textContent?.trim() || "";
              const priceText =
                el
                  .querySelector('[data-testid="price-main-price"]')
                  ?.textContent?.trim() || "";
              if (modelCode && priceText)
                out.push({ name, modelCode, priceText });
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
        logger.info(
          { url, domCount: prevCount, accepted: pageAdded },
          "Siemens category scraped",
        );
      } catch (err) {
        logger.warn({ url, err }, "Siemens page scrape failed");
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  return dedupeByModel(results);
}

// Electrolux/AEG TR (electrolux.com.tr, aeg.com.tr) — both Electrolux Group
// brand sites are marketing-only in TR: /buzdolabi/, /bulasik-makineleri/,
// /camasir-makineleri/ paths return 404 or render only inspiration content
// for built-in (ankastre) appliances under /kitchen/*/, with no product
// cards or prices. Confirmed via Playwright probe May 2026. Stubs return [];
// competitor entries for these brands remain unmatched until a marketplace
// scraping service (with paid stealth) is added.
async function scrapeElectrolux(): Promise<ScrapedPrice[]> {
  logger.info(
    "Electrolux TR has no online catalog (marketing-only site) — returning []",
  );
  return [];
}

async function scrapeAEG(): Promise<ScrapedPrice[]> {
  logger.info(
    "AEG TR has no online catalog (marketing-only site) — returning []",
  );
  return [];
}

// Regal TR (regal.com.tr) — site is permanently slow/blocked from this
// environment: page.goto times out at 25s+ on every attempt (May 2026
// probe). Vestel-Regal share parent company (Vestel Beyaz Eşya), so Regal
// competitor entries continue to fall through to the vestelMap in
// runPriceScrape — same as before. Stub returns []; direct Regal scraping
// is blocked.
async function scrapeRegal(): Promise<ScrapedPrice[]> {
  logger.info(
    "Regal TR scraping blocked (site times out from this env) — returning []",
  );
  return [];
}

// Teknosa marketplace (teknosa.com) — Akamai/anti-bot returns HTTP 403 on
// every Playwright request from this environment, even with cookie warmup
// and realistic Sec-Ch-Ua headers (May 2026 probe: 4/4 URLs returned 403).
// Marketplace coverage continues via n11.com and trendyol.com, which work.
// Stub returns []; Teknosa would require a paid stealth scraping service.
async function scrapeTeknosa(): Promise<ScrapedMarketplaceProduct[]> {
  logger.info(
    "Teknosa scraping blocked (Akamai 403 from this env) — returning []",
  );
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
  aeg: ScrapedPrice[];
  regal: ScrapedPrice[];
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
    { name: "aeg.com.tr", fn: scrapeAEG },
    { name: "regal.com.tr", fn: scrapeRegal },
    { name: "grundig.com.tr", fn: scrapeGrundig },
  ] as const;

  const results: ScraperResults = {
    arcelik: [],
    beko: [],
    vestel: [],
    bosch: [],
    samsung: [],
    lg: [],
    siemens: [],
    profilo: [],
    electrolux: [],
    aeg: [],
    regal: [],
    grundig: [],
  };
  const keys = [
    "arcelik",
    "beko",
    "vestel",
    "bosch",
    "samsung",
    "lg",
    "siemens",
    "profilo",
    "electrolux",
    "aeg",
    "regal",
    "grundig",
  ] as const;

  // Brand scrapers each open their own Playwright BrowserContext. We batch
  // pairs (concurrency=2) to keep memory bounded under the 10-minute cron
  // budget while still cutting wall time roughly in half versus serial.
  const CONCURRENCY = 2;
  for (let i = 0; i < scrapers.length; i += CONCURRENCY) {
    const batch = scrapers.slice(i, i + CONCURRENCY);
    for (const s of batch) logger.info(`Scraping ${s.name}...`);
    const settled = await Promise.allSettled(batch.map((s) => s.fn()));
    for (let j = 0; j < batch.length; j++) {
      const idx = i + j;
      const s = batch[j];
      const outcome = settled[j];
      if (outcome.status === "fulfilled") {
        results[keys[idx]] = outcome.value;
        logger.info(`${s.name}: ${outcome.value.length} products found`);
      } else {
        logger.error({ err: outcome.reason }, `${s.name}: scrape failed`);
      }
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
    const grundigMap = new Map(
      scraped.grundig.map((s) => [normalizeModelKey(s.modelCode), s]),
    );

    for (const p of existingProducts) {
      const match =
        fuzzyMatchScraped(p.modelCode, arcelikMap) ??
        fuzzyMatchScraped(p.modelCode, bekoMap) ??
        fuzzyMatchScraped(p.modelCode, grundigMap);
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
    const lgMap = buildEnhancedMap(scraped.lg);
    const profiloMap = buildEnhancedMap(scraped.profilo);
    const siemensMap = buildEnhancedMap(scraped.siemens);
    const electroluxMap = buildEnhancedMap(scraped.electrolux);
    const aegMap = buildEnhancedMap(scraped.aeg);
    const regalMap = buildEnhancedMap(scraped.regal);

    const productPriceMap = new Map(
      existingProducts.map((p) => [p.id, p.tsfPrice]),
    );

    let unmatchedCompetitors = 0;
    for (const cp of existingCompetitors) {
      let match: ScrapedPrice | undefined;
      if (cp.brand === "Vestel")
        match = fuzzyMatchScraped(cp.competitorModel, vestelMap);
      else if (cp.brand === "Regal")
        // Regal scraper is blocked; Regal shares parent (Vestel Beyaz Eşya)
        // with Vestel, so fall back to the Vestel catalog.
        match =
          fuzzyMatchScraped(cp.competitorModel, regalMap) ??
          fuzzyMatchScraped(cp.competitorModel, vestelMap);
      else if (cp.brand === "Bosch")
        match = fuzzyMatchScraped(cp.competitorModel, boschMap);
      else if (cp.brand === "Profilo")
        // Prefer the real Profilo catalog; fall back to Bosch (BSH-shared).
        match =
          fuzzyMatchScraped(cp.competitorModel, profiloMap) ??
          fuzzyMatchScraped(cp.competitorModel, boschMap);
      else if (cp.brand === "Siemens")
        // Prefer the real Siemens catalog; fall back to Bosch (BSH-shared)
        // and Profilo as last-resort BSH fallback.
        match =
          fuzzyMatchScraped(cp.competitorModel, siemensMap) ??
          fuzzyMatchScraped(cp.competitorModel, boschMap) ??
          fuzzyMatchScraped(cp.competitorModel, profiloMap);
      else if (cp.brand === "Samsung")
        match = fuzzyMatchScraped(cp.competitorModel, samsungMap);
      else if (cp.brand === "LG")
        match = fuzzyMatchScraped(cp.competitorModel, lgMap);
      else if (cp.brand === "Electrolux/AEG" || cp.brand === "Electrolux" || cp.brand === "AEG")
        // Electrolux/AEG scrapers are stubs (sites are marketing-only);
        // these maps stay empty until the marketplace pipeline supplies
        // prices. Try AEG-specific first, then Electrolux as a Group fallback.
        match =
          fuzzyMatchScraped(cp.competitorModel, aegMap) ??
          fuzzyMatchScraped(cp.competitorModel, electroluxMap);

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

    // Evaluate marketplace scraper health against the rolling baseline of
    // prior runs. excludeRunId ensures the in-progress run (already inserted
    // as 'running') is not part of its own baseline.
    const health = await evaluateScrapeRunHealth(scrapedCounts, {
      excludeRunId: runId,
    });
    logHealthEvaluation(runId, health);

    if (health.status === "unhealthy") {
      // Best-effort email; sendEmail no-ops when RESEND_API_KEY is unset and
      // logs the regression there too. We do NOT throw on email failure —
      // the run itself completed successfully, the alert is a side channel.
      const summary = formatHealthSummary(health);
      const alertEmail =
        process.env["SCRAPE_ALERT_EMAIL"] ?? process.env["ADMIN_EMAIL"];
      if (alertEmail) {
        const html = `
          <p><strong>${summary}</strong></p>
          <p>Run: ${runId}</p>
          <p>Threshold: ${Math.round(health.thresholdFraction * 100)}% of last ${health.baselineWindowDays}d average.</p>
          <ul>
            ${health.alerts
              .map(
                (a) =>
                  `<li><strong>${a.marketplace}</strong>: this run produced ${a.currentCount}, baseline avg ${a.baselineAvg} (${a.baselineSamples} prior samples), drop ${a.dropPercent}% — reason: ${a.reason}</li>`,
              )
              .join("")}
          </ul>
          <p>Investigate selectors / category drift in <code>artifacts/api-server/src/lib/scraper.ts</code>.</p>
        `;
        sendEmail({
          to: alertEmail,
          subject: `[Maven AI] ${summary}`,
          html,
        }).catch((err) => {
          logger.warn({ err, runId }, "Failed to send scrape health alert email");
        });
      }
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
        healthStatus: health.status,
        healthAlerts: health.alerts,
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
