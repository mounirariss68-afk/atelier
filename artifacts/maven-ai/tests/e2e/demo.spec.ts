import { test, expect, type Page } from "@playwright/test";

const SLUG = "value-realization";
const DEMO_PATH = `/demo/${SLUG}`;

async function gotoDemoEN(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cognirise-lang", "en");
    } catch {
      /* noop */
    }
  });
  await page.goto(DEMO_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Interactive demo", { exact: true })).toBeVisible();
}

function statusBadge(page: Page) {
  return page.locator("header span", { hasText: /Idle|Running|Paused|Awaiting human|Complete|خامل|يعمل|متوقف|بانتظار الإنسان|اكتمل/ }).first();
}

function stepCounter(page: Page) {
  // "Step 0 / 21" (en) or "خطوة 0 / 21" (ar)
  return page.locator("footer p").filter({ hasText: /\d+\s*\/\s*\d+/ }).first();
}

function playButton(page: Page) {
  return page.getByRole("button", { name: /^(Play|تشغيل)$/ });
}
function pauseButton(page: Page) {
  return page.getByRole("button", { name: /^(Pause|إيقاف)$/ });
}
function stepButton(page: Page) {
  return page.getByRole("button", { name: /^(Step|خطوة)$/ });
}
function rewindButton(page: Page) {
  return page.getByRole("button", { name: /^(Rewind|تراجع)$/ });
}

test.describe("Demo experience: /demo/value-realization", () => {
  test("renders chrome-free shell with demo controls", async ({ page }) => {
    await gotoDemoEN(page);

    // No marketing chrome — the marketing Navbar exposes the "Marketplace"
    // top-level link; assert it is NOT present on the demo route.
    await expect(page.locator("nav").getByRole("link", { name: "Marketplace", exact: true })).toHaveCount(0);
    // No site footer, no chat widget.
    await expect(page.locator("footer").getByText(/Cognirise Consulting|©/)).toHaveCount(0);

    // Header chrome present
    await expect(page.getByText("Interactive demo", { exact: true })).toBeVisible();
    await expect(statusBadge(page)).toHaveText(/Idle/);

    // Left rail tabs (English)
    for (const label of ["Overview", "Live inbox", "Workflows", "Workspace", "KPIs", "Audit log"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    // Footer tick controls
    await expect(playButton(page)).toBeVisible();
    await expect(pauseButton(page)).toBeVisible();
    await expect(stepButton(page)).toBeVisible();
    await expect(rewindButton(page)).toBeVisible();

    // Step counter starts at 0
    await expect(stepCounter(page)).toHaveText(/^Step\s+0\s*\/\s*\d+/);
  });

  test("step / play / rewind drive the tick engine and audit log", async ({ page }) => {
    await gotoDemoEN(page);
    await page.getByRole("button", { name: "Audit log", exact: true }).click();

    // Empty audit log + disabled download
    await expect(page.getByText(/Audit log is empty/)).toBeVisible();
    const download = page.getByRole("button", { name: /Download audit trail/ });
    await expect(download).toBeDisabled();

    // Step once — engine.step from "idle" leaves status idle but advances cursor.
    await stepButton(page).click();
    await expect(stepCounter(page)).toHaveText(/^Step\s+1\s*\/\s*\d+/);
    await expect(page.getByText("#1")).toBeVisible();

    // Step from "playing" pauses; verify after Play+Pause+Step path.
    await playButton(page).click();
    await expect(statusBadge(page)).toHaveText(/Running/);
    await pauseButton(page).click();
    await expect(statusBadge(page)).toHaveText(/Paused/);

    // Rewind decrements cursor and forces "Paused".
    await rewindButton(page).click();
    await expect(statusBadge(page)).toHaveText(/Paused/);
  });

  test("checkpoint modal pauses the run and writes a decision audit entry", async ({ page }) => {
    await gotoDemoEN(page);

    await playButton(page).click();
    await expect(statusBadge(page)).toHaveText(/Running/);

    // Wait for the human checkpoint modal — engine emits it at event v18.
    // At default 1400ms/tick that's ~25s; allow plenty of headroom.
    const modal = page.getByText("Human checkpoint", { exact: true });
    await expect(modal).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText("Approve the board one-pager and ship it to the Monday pack?")).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve and publish/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Soften procurement callout/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send back to narrator/ })).toBeVisible();
    await expect(page.getByText("Recommended", { exact: true })).toBeVisible();

    await expect(statusBadge(page)).toHaveText(/Awaiting human/);
    await expect(playButton(page)).toBeDisabled();

    // Resolve with the recommended option.
    await page.getByRole("button", { name: /Approve and publish/ }).click();

    // Modal closes, status returns to Paused.
    await expect(modal).toBeHidden();
    await expect(statusBadge(page)).toHaveText(/Paused/);

    // Audit log records the human decision.
    await page.getByRole("button", { name: "Audit log", exact: true }).click();
    const decision = page.getByText(/Human resolved.*Approve and publish/);
    await expect(decision).toBeVisible();
  });

  test("full play-through reaches Complete after resolving the checkpoint", async ({ page }) => {
    test.setTimeout(180_000);
    await gotoDemoEN(page);

    // Speed the engine up so the full run finishes in well under the
    // test timeout. The slider lives in the left rail (min 300, max 3000).
    const slider = page.locator('input[type="range"]');
    await slider.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(el, "300");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Drive the engine to the checkpoint.
    await playButton(page).click();
    await expect(page.getByText("Human checkpoint", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: /Approve and publish/ }).click();
    await expect(page.getByText("Human checkpoint", { exact: true })).toBeHidden();

    // Resume to completion.
    await playButton(page).click();
    await expect(statusBadge(page)).toHaveText(/Complete/, { timeout: 60_000 });

    // Terminal invariants:
    //  - cursor reached the total number of events (21 in value-realization),
    //  - Play button is disabled at completion,
    //  - the final scripted "complete" trace entry is present in the audit log.
    await expect(stepCounter(page)).toHaveText(/Step\s+\d+\s*\/\s*21/);
    await expect(playButton(page)).toBeDisabled();

    await page.getByRole("button", { name: "Audit log", exact: true }).click();
    // Both the cockpit and the audit log render the terminal "Run complete"
    // label — scope to the audit log card explicitly.
    const auditLog = page.locator("div.divide-y.divide-gray-100");
    await expect(
      auditLog.getByText(/Run complete\. Board pack ready, audit log closed\./),
    ).toBeVisible();
    await expect(
      auditLog.getByText(/Human resolved.*Approve and publish/),
    ).toBeVisible();

    // Audit JSON download is now enabled (trace is non-empty).
    await expect(
      page.getByRole("button", { name: /Download audit trail/ }),
    ).toBeEnabled();
  });

  test("Exit link returns to the marketplace detail page with marketing chrome", async ({ page }) => {
    await gotoDemoEN(page);
    await page.getByRole("link", { name: /^(Exit|خروج)$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/marketplace/${SLUG}$`));
    // Marketing Navbar restored — top-level "Marketplace" link is back.
    await expect(page.locator("nav").getByRole("link", { name: "Marketplace", exact: true }).first()).toBeVisible();
  });

  test("Arabic toggle flips RTL and translates the demo chrome", async ({ page }) => {
    await gotoDemoEN(page);

    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(html).toHaveAttribute("lang", "en");

    // Toggle to Arabic — button currently shows "AR" while in English.
    await page.getByRole("button", { name: /^AR$/ }).click();

    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");

    // Header tag + tabs + footer controls translate.
    await expect(page.getByText("عرض تفاعلي", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "نظرة عامة", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "سجل التدقيق", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "تشغيل", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "إيقاف", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "خطوة", exact: true })).toBeVisible();
    await expect(statusBadge(page)).toHaveText(/خامل/);

    // Toggle button now offers EN.
    await expect(page.getByRole("button", { name: /^EN$/ })).toBeVisible();

    // Toggle back to English.
    await page.getByRole("button", { name: /^EN$/ }).click();
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(page.getByText("Interactive demo", { exact: true })).toBeVisible();
  });
});
