import { chromium } from "playwright-core";

const EXEC = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

async function probe(domain, hostUrl) {
  const browser = await chromium.launch({
    executablePath: EXEC,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    locale: "tr-TR",
    extraHTTPHeaders: { "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8" },
  });
  const page = await ctx.newPage();
  console.log(`\n=== ${domain} ===`);
  try {
    await page.goto(hostUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    // Extract all category-looking links from nav/menus
    const links = await page.evaluate(() => {
      const results = new Set();
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        const text = (a.textContent || "").trim().slice(0, 60);
        // Look for category-pattern URLs
        if (href.match(/\/[a-z-]+-c-\d+|\/c-\d+/) || href.match(/\/(buzdolabi|camasir|bulasik|firin|mikrodalga|televizyon|elektronik|kucuk-ev|ankastre|kurutma|set-ustu)/i)) {
          results.add(JSON.stringify({ href, text }));
        }
      }
      return Array.from(results).map((s) => JSON.parse(s));
    });
    console.log(`Found ${links.length} category-looking links`);
    for (const l of links.slice(0, 60)) console.log(`  ${l.text.padEnd(40)} → ${l.href}`);

    // Now check a sample category page to understand pagination
    const sample = links.find((l) => l.href.includes("buzdolabi") || l.href.includes("c-")) || links[0];
    if (sample) {
      const url = sample.href.startsWith("http") ? sample.href : hostUrl + sample.href;
      console.log(`\n--- Sampling ${url} ---`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      const info = await page.evaluate(() => {
        const itemCount = document.querySelectorAll("article.prd.product-item, [data-product-code], .product-item").length;
        const totalText = document.body.innerText.match(/(\d+)\s*(ürün|product|sonuç)/i);
        const pagination = Array.from(document.querySelectorAll('a[href*="page="], a[href*="/p/"], .pagination a, [class*="pagination"] a')).slice(0, 6).map(a => ({ text: a.textContent.trim().slice(0, 20), href: a.getAttribute("href") }));
        return { itemCount, totalText: totalText ? totalText[0] : null, pagination };
      });
      console.log(JSON.stringify(info, null, 2));
    }
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
  await browser.close();
}

await probe("arcelik.com.tr", "https://www.arcelik.com.tr");
await probe("beko.com.tr", "https://www.beko.com.tr");
