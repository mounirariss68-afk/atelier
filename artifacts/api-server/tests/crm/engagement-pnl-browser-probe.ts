/**
 * Authenticated browser contract for Finance → Engagement P&L.
 *
 * Runs the real Atelier React page in Chromium and supplies the same JSON
 * contract returned by GET /finance/engagement-pnl/:engagementId. The
 * calculation/database behavior is covered by realization-rebaseline-probe;
 * this probe closes the browser wiring gap.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";

const PORT = 51372;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PATH = "/finance/plan/engagement-pnl/eng_browser_realization";

function chromiumExecutable(): string {
  const installs = readdirSync("/nix/store")
    .filter((name) => /^.+-chromium-[\d.]+$/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  assert.ok(installs.length > 0, "Chromium is required for the browser probe");
  return `/nix/store/${installs[0]}/bin/chromium`;
}

const pnl = {
  engagementId: "eng_browser_realization",
  engagementName: "Browser Realization Probe",
  budget: {
    contractValueUsd: 120000,
    budgetLabourHours: 1100,
    budgetLabourCostUsd: 56000,
    budgetExpensesUsd: 6000,
    budgetSubsUsd: 7000,
    budgetAtCompletionUsd: 69000,
    baselinedAt: "2026-09-20T00:00:00.000Z",
    sector: "Test",
  },
  cost: {
    asOf: "2026-09-20",
    labourHoursToDate: 60,
    labourCostToDateUsd: 25000,
    expensesToDateUsd: 5000,
    subsToDateUsd: 3000,
    costToDateUsd: 33000,
    revenueRecognisedToDateUsd: 60000,
    invoicedToDateUsd: 45000,
    cashCollectedToDateUsd: 30000,
    pctComplete: 0.5,
  },
  etc: {
    method: "manual",
    manualEtcUsd: 40000,
    rationale: "Probe",
    updatedAt: "2026-09-20T00:00:00.000Z",
    updatedByUserId: "p_finance_probe",
  },
  eac: {
    contractValueUsd: 120000,
    bacUsd: 69000,
    ctdUsd: 33000,
    etcUsd: 40000,
    etcMethod: "manual",
    eacUsd: 73000,
    vacUsd: -4000,
    vacPctOfBac: -4000 / 69000,
    forecastFinalMarginPct: 47000 / 120000,
    plannedMarginPct: 51000 / 120000,
    marginSlippagePct: -4000 / 120000,
    pctComplete: 0.5,
    pctBilled: 45000 / 120000,
    ragStatus: "amber",
  },
  derived: {
    grossMarginToDatePct: 0.45,
    wipUsd: 15000,
    arUsd: 15000,
    lockupUsd: 30000,
  },
  people: {
    partnerOwnerId: "p_partner",
    partnerOwnerName: "Probe Partner",
    engagementLeadId: "p_lead",
    engagementLeadName: "Probe Lead",
  },
  changeOrders: [],
  audit: [],
  realization: {
    // Immutable original signed position.
    sold: { priceUsd: 100000, hours: 80, effectiveRateUsd: 1250, marginPct: 0.45 },
    // Delivered and current baseline reflect the posted $20k change.
    delivered: {
      revenueRecognised: 60000,
      hoursBillable: 60,
      effectiveRateUsd: 1000,
      directCost: 33000,
      grossMarginPct: 0.45,
    },
    realizationRate: 0.6,
    leakage: {
      totalUsd: 17700,
      rateVarianceUsd: 15000,
      hoursOverrunUsd: 0,
      scopeWriteOffsUsd: 2000,
      expenseNonRecoveryUsd: 700,
    },
    currentBaseline: {
      contractValueUsd: 120000,
      budgetAtCompletionUsd: 69000,
      baselinedAt: "2026-09-20T00:00:00.000Z",
      postedChangeOrderCount: 1,
      postedChangeOrderValueUsd: 20000,
    },
  },
};

async function waitForServer(child: ChildProcess): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode != null) throw new Error(`Vite exited early (${child.exitCode})`);
    try {
      const response = await fetch(ORIGIN);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for Atelier Vite server");
}

async function stubAuthenticatedPage(page: Page, allowed: boolean): Promise<void> {
  await page.context().addCookies([
    { name: "atelier_persona", value: allowed ? "p_finance_probe" : "p_recruiter_probe", url: ORIGIN },
  ]);
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: allowed ? "p_finance_probe" : "p_recruiter_probe",
          email: allowed ? "finance-probe@example.test" : "recruiter-probe@example.test",
          name: allowed ? "Finance Probe" : "Recruiter Probe",
          role: allowed ? "finance" : "recruiter",
        },
        mustChangePassword: false,
      }),
    });
  });
  await page.route("**/api/atelier/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/atelier/me/background-jobs") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobs: [] }) });
      return;
    }
    if (url.pathname === "/api/atelier/me/notifications") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (url.pathname === "/api/atelier/activity") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    if (url.pathname === "/api/atelier/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: allowed ? "p_finance_probe" : "p_recruiter_probe",
          name: allowed ? "Finance Probe" : "Recruiter Probe",
          role: allowed ? "finance" : "recruiter",
          orgId: "aico",
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/audit")) {
      await route.fulfill({ status: allowed ? 200 : 403, contentType: "application/json", body: allowed ? JSON.stringify({ engagementId: pnl.engagementId, items: [] }) : JSON.stringify({ error: "recruiter-scope" }) });
      return;
    }
    if (url.pathname === `/api/atelier/finance/engagement-pnl/${pnl.engagementId}`) {
      await route.fulfill({
        status: allowed ? 200 : 403,
        contentType: "application/json",
        body: allowed ? JSON.stringify(pnl) : JSON.stringify({ error: "recruiter-scope" }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function text(page: Page, testId: string): Promise<string> {
  return (await page.getByTestId(testId).innerText()).replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  const vite = spawn(
    "pnpm",
    ["--filter", "@workspace/atelier", "exec", "vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    {
      cwd: new URL("../../../..", import.meta.url),
      env: { ...process.env, PORT: String(PORT), BASE_PATH: "/", NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let browser: Browser | undefined;
  try {
    await waitForServer(vite);
    browser = await chromium.launch({
      executablePath: chromiumExecutable(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const finance = await browser.newPage();
    finance.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
    finance.on("pageerror", (error) => console.error("[browser:pageerror]", error));
    await stubAuthenticatedPage(finance, true);
    await finance.goto(`${ORIGIN}${PATH}`, { waitUntil: "domcontentloaded" });
    try {
      await finance.getByTestId("engagement-realization-card").waitFor({ timeout: 15_000 });
    } catch (error) {
      console.error("browser URL", finance.url());
      console.error("browser body", (await finance.locator("body").innerText()).slice(0, 2000));
      throw error;
    }

    const card = (await finance.getByTestId("engagement-realization-card").innerText()).replace(/\s+/g, " ");
    const normalizedCard = card.toLocaleLowerCase();
    for (const expected of [
      "Original sold $100,000",
      "80h · $1,250/h",
      "Current baseline $120,000",
      "1 posted changes · $20,000",
      "Realization 60.0%",
      "$60,000 recognized",
      "Total leakage $17,700",
      "Rate variance $15,000",
      "Hours overrun $0",
      "Scope write-offs $2,000",
      "Expense non-recovery $700",
    ]) assert.ok(normalizedCard.includes(expected.toLocaleLowerCase()), `missing browser value: ${expected}\n${card}`);

    assert.match(await text(finance, "tile-rev-rec"), /Revenue recognised \$60,000 invoiced \$45,000 · cash \$30,000/i);
    assert.match(await text(finance, "tile-wip"), /WIP \$15,000/i);
    assert.match(await text(finance, "tile-lockup"), /Lockup \$30,000 WIP \$15,000 \+ AR \$15,000/i);
    assert.ok((await finance.getByText("EAC", { exact: true }).locator("..").innerText()).includes("$73,000"));
    assert.ok((await finance.getByText("Forecast margin", { exact: true }).locator("..").innerText()).includes("39.2%"));
    console.log("  ✓ finance browser renders sold, baseline, revenue, cash, WIP, AR, lockup, EAC, margin and leakage from the API contract");

    const denied = await browser.newPage();
    await stubAuthenticatedPage(denied, false);
    await denied.goto(`${ORIGIN}${PATH}`, { waitUntil: "domcontentloaded" });
    await denied.getByText("Failed to load engagement P&L.").waitFor();
    const deniedBody = await denied.locator("body").innerText();
    assert.ok(!deniedBody.includes("$100,000") && !deniedBody.includes("$120,000") && !deniedBody.includes("$17,700"));
    console.log("  ✓ unauthorized browser receives denial with no sold/delivered data leakage");
  } finally {
    await browser?.close();
    vite.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("FAIL engagement P&L browser probe", error);
  process.exitCode = 1;
});