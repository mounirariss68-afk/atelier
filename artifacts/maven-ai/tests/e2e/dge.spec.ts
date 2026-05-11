import { test, expect, type Page } from "@playwright/test";

/**
 * DGE Effortless 2.0 — covers the marketplace landing, About, Method,
 * the six demo routes (shared shell, HAPA chips, watermark, AR toggle,
 * AUTHORIZE → blocked-outcome flow), and the Stack panel.
 */

const DEMO_SLUGS = [
  "dge-catalogue-channel",
  "dge-complaint-recovery",
  "dge-effortless-qr",
  "dge-red-team",
  "dge-service-redesign",
  "dge-spokes-review",
];

async function gotoEN(page: Page, path: string) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("maven-ai-lang", "en"); } catch {}
  });
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

test.describe("DGE Effortless 2.0", () => {
  test("marketplace hub lists all six demos with launch links", async ({ page }) => {
    await gotoEN(page, "/marketplace/dge-effortless");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/DGE Effortless 2\.0/i);
    for (const slug of DEMO_SLUGS) {
      await expect(page.getByTestId(`dge-demo-card-${slug}`)).toBeVisible();
      await expect(page.getByTestId(`dge-launch-${slug}`)).toBeVisible();
    }
  });

  test("about + method pages render", async ({ page }) => {
    await gotoEN(page, "/dge/about");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Eight Agentic Factories/i);
    await expect(page.getByTestId("factory-catalogue-channel")).toBeVisible();

    await gotoEN(page, "/dge/method");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/HAPA \+ UX Authority/i);
    for (const id of ["H1", "H2", "H3", "H4", "H5", "H6"]) {
      await expect(page.getByTestId(`hapa-${id}`)).toBeVisible();
    }
  });

  for (const slug of DEMO_SLUGS) {
    test.describe(`demo: ${slug}`, () => {
      test("shared shell, HAPA chips, watermark, surface tabs, RTL flip", async ({ page }) => {
        await gotoEN(page, `/demo/${slug}`);
        const shell = page.getByTestId("dge-shell");
        await expect(shell).toBeVisible();
        for (const id of ["H1", "H2", "H3", "H4", "H5", "H6"]) {
          await expect(page.getByTestId(`hapa-${id}`)).toBeVisible();
        }
        await expect(page.getByTestId("tab-citizen")).toBeVisible();
        await expect(page.getByTestId("tab-operator")).toBeVisible();
        await expect(page.getByTestId("tab-governance")).toBeVisible();
        await expect(page.getByText(/Demonstration · Synthetic Data/i)).toBeVisible();
        await expect(shell).toHaveAttribute("dir", "ltr");
        await page.getByTestId("button-lang").click();
        await expect(shell).toHaveAttribute("dir", "rtl");
      });

      test("play → AUTHORIZE card → blocked-outcome audit entry; Stack panel visible on operator", async ({ page }) => {
        test.setTimeout(120_000);
        await gotoEN(page, `/demo/${slug}`);
        await page.getByTestId("speed-4x").click();
        await page.getByTestId("button-play").click();

        await expect(page.getByTestId("authorise-card")).toBeVisible({ timeout: 45_000 });
        await page.getByTestId("button-authorise").click();
        await expect(page.getByTestId("authorise-card")).toBeHidden();

        await page.getByTestId("tab-operator").click();
        await expect(page.getByTestId("stack-panel")).toBeVisible();

        await page.getByTestId("tab-governance").click();
        await expect(page.getByTestId("audit-timeline")).toBeVisible();
        await expect(page.getByTestId("audit-outcome-blocked").first()).toBeVisible({ timeout: 45_000 });
        await expect(page.getByTestId("audit-outcome-authorised").first()).toBeVisible();
      });
    });
  }
});
