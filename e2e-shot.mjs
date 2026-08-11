import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";
import crypto from "node:crypto";

const theme = process.argv[2] || "dark";
const token = crypto.randomBytes(24).toString("hex");
const hash = crypto.createHash("sha256").update(token).digest("hex");
const psql = (q) => execSync(`psql "$DATABASE_URL" -tAc "${q}"`).toString().trim();
psql(`INSERT INTO atelier_auth_sessions (token_hash, user_id, email, expires_at) SELECT '${hash}', id, email, now() + interval '1 hour' FROM atelier_users WHERE id='p_mounir_ariss'`);
const browser = await puppeteer.launch({
  executablePath: "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: "atelier_auth_session", value: token, domain: "localhost", path: "/" });
  await page.evaluateOnNewDocument((t) => localStorage.setItem("atelier-theme", t), theme);
  await page.goto("http://localhost:80/", { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `/tmp/shots/rail-${theme}.png` });
} finally {
  await browser.close();
  psql(`DELETE FROM atelier_auth_sessions WHERE token_hash='${hash}'`);
}
