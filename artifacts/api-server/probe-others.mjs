import { chromium } from "playwright-core";
const EXEC = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

const probes = [
  { domain: "vestel.com.tr", url: "https://www.vestel.com.tr", linkRegex: /\/(buzdolabi|camasir|bulasik|firin|televizyon|elektronik|kucuk-ev|ankastre|kurutma|set-ustu|mikrodalga|tv|klima|surahi)/i, sample: "https://www.vestel.com.tr/buzdolabi" },
  { domain: "bosch-home.com.tr", url: "https://www.bosch-home.com.tr/tr/", linkRegex: /\/tr\/category\//, sample: "https://www.bosch-home.com.tr/tr/category/buzdolaplari-derin-dondurucular" },
  { domain: "samsung.com/tr", url: "https://www.samsung.com/tr/", linkRegex: /\/tr\/(refrigerators|washers|dishwashers|tvs|monitors|cooking|home-appliances|microwave|vacuum|mobile)/i, sample: "https://www.samsung.com/tr/refrigerators/all-refrigerators/" },
];

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  locale: "tr-TR",
  extraHTTPHeaders: { "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8" },
});

for (const p of probes) {
  const page = await ctx.newPage();
  console.log(`\n=== ${p.domain} ===`);
  try {
    await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const links = await page.evaluate((rxStr) => {
      const rx = new RegExp(rxStr.slice(1, rxStr.lastIndexOf("/")), "i");
      const out = new Set();
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href") || "";
        const text = (a.textContent || "").trim().slice(0, 50);
        if (rx.test(href) && text.length > 0 && text.length < 60) {
          out.add(JSON.stringify({ href, text }));
        }
      }
      return Array.from(out).map((s) => JSON.parse(s));
    }, p.linkRegex.toString());
    console.log(`Found ${links.length} category-looking links`);
    const seen = new Set();
    for (const l of links.slice(0, 50)) {
      if (seen.has(l.href)) continue;
      seen.add(l.href);
      console.log(`  ${l.text.padEnd(40)} → ${l.href}`);
    }

    // Sample
    await page.goto(p.sample, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => {
      const counts = {
        productListItem: document.querySelectorAll(".product-list-item-wrap").length,
        productItem: document.querySelectorAll("article.prd.product-item").length,
        dataTestId: document.querySelectorAll('[data-testid^="product-teaser-container"]').length,
        jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).length,
        productCode: document.querySelectorAll("[data-product-code]").length,
      };
      const totalText = (document.body.innerText.match(/(\d+)\s*(ürün|product|sonuç|item)/i) || [])[0] || null;
      const pagination = Array.from(document.querySelectorAll('a[href*="page="], a[href*="?p="], [class*="pagination"] a')).slice(0, 6).map(a => ({ text: a.textContent.trim().slice(0, 20), href: a.getAttribute("href") }));
      return { counts, totalText, pagination };
    });
    console.log(`SAMPLE ${p.sample}:`);
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
  await page.close();
}
await browser.close();
