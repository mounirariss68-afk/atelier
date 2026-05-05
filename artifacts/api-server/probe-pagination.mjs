import { chromium } from "playwright-core";
const EXEC = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

const tests = [
  { url: "https://www.vestel.com.tr/buzdolabi?p=2" },
  { url: "https://www.vestel.com.tr/buzdolabi-c-13" },
  { url: "https://www.vestel.com.tr/buzdolabi-c-13?page=2" },
  { url: "https://www.bosch-home.com.tr/tr/category/buzdolaplari-derin-dondurucular?p=2" },
  { url: "https://www.bosch-home.com.tr/tr/category/buzdolaplari-derin-dondurucular?Page=2" },
  { url: "https://www.samsung.com/tr/refrigerators/all-refrigerators/?type=00000000&offset=18" },
];
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  locale: "tr-TR",
});
for (const t of tests) {
  const page = await ctx.newPage();
  try {
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => ({
      productListItem: document.querySelectorAll(".product-list-item-wrap").length,
      teaser: document.querySelectorAll('[data-testid^="product-teaser-container"]').length,
      jsonLd: document.querySelectorAll('script[type="application/ld+json"]').length,
      total: (document.body.innerText.match(/(\d+)\s*(Ürün|Sonuç|Result)/i) || [])[0] || null,
      title: document.title.slice(0, 80),
    }));
    console.log(t.url);
    console.log("  ", JSON.stringify(info));
  } catch (e) {
    console.log(t.url, "ERROR:", e.message);
  }
  await page.close();
}

// Vestel: try scrolling to trigger lazy load
const page = await ctx.newPage();
await page.goto("https://www.vestel.com.tr/buzdolabi", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2000);
const before = await page.evaluate(() => document.querySelectorAll(".product-list-item-wrap").length);
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
}
const after = await page.evaluate(() => document.querySelectorAll(".product-list-item-wrap").length);
console.log("\nVestel /buzdolabi scroll test: before=", before, " after=", after);

// Bosch: check for "Show more" button or scroll lazy load
const bp = await ctx.newPage();
await bp.goto("https://www.bosch-home.com.tr/tr/category/buzdolaplari-derin-dondurucular", { waitUntil: "domcontentloaded", timeout: 30000 });
await bp.waitForTimeout(3000);
const bBefore = await bp.evaluate(() => document.querySelectorAll('[data-testid^="product-teaser-container"]').length);
for (let i = 0; i < 10; i++) {
  await bp.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await bp.waitForTimeout(1500);
}
const bAfter = await bp.evaluate(() => document.querySelectorAll('[data-testid^="product-teaser-container"]').length);
const showMoreBtn = await bp.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button, a')).filter(b => /more|daha|göster/i.test(b.textContent || ""));
  return btns.slice(0, 3).map(b => ({ text: (b.textContent||"").trim().slice(0,40), tag: b.tagName }));
});
console.log("Bosch /buzdolaplari scroll test: before=", bBefore, " after=", bAfter, "more buttons:", showMoreBtn);

await browser.close();
