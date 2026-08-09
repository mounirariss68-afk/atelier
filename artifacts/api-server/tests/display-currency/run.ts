/**
 * Task #827 — display-currency preference + converted expense display probe.
 *
 * Covers: GET/PATCH /me/preferences (validation, persistence, audit),
 * and GET /me/expenses `display` conversion into the chosen currency
 * (same-currency rows unconverted, cross-currency via USD FX).
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/display-currency/run.ts
 */
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

const STAMP = Date.now();
const UID = `p_test_dispcur_${STAMP}`;
const EMAIL = `test.dispcur.${STAMP}@cognirise.ai`;
const PW = `Disp-Pw-${STAMP}-1`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

async function main() {
  const {
    db, pool, atelierUsers, atelierAuthCredentials, atelierAuthSessions,
    atelierExpenses, atelierAuditEvents,
  } = await import("@workspace/db");
  const { hashPassword } = await import("../../src/lib/auth/passwords.js");
  const { seedFxRates } = await import("../../src/lib/atelier-fx.js");
  const app = (await import("../../src/app.js")).default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
  };

  try {
    await seedFxRates(5);
    const [anyOrg] = await db.select({ orgId: atelierUsers.orgId }).from(atelierUsers).limit(1);
    const orgId = anyOrg?.orgId ?? "aico";
    await db.insert(atelierUsers).values({
      id: UID, orgId, email: EMAIL, name: "Disp Cur", initials: "DC",
      role: "employee", roleLabel: "Employee", title: "Probe",
    });
    await db.insert(atelierAuthCredentials).values({
      email: EMAIL, userId: UID, passwordHash: hashPassword(PW), userManaged: true,
    });
    const login = await call("POST", "/auth/login", { email: EMAIL, password: PW });
    const m = /atelier_auth_session=([^;]+)/.exec(login.res.headers.get("set-cookie") ?? "");
    cookie = m ? `atelier_auth_session=${m[1]}` : "";
    check("login ok", login.status === 200 && cookie !== "");

    // Seed one USD and one AED claim this month.
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(atelierExpenses).values([
      { id: `exp_dc_usd_${STAMP}`, orgId, personId: UID, expenseDate: today, captureSource: "manual", amount: 100, currency: "USD", usdAmount: 100, category: "meals", status: "draft", policyStatus: "green", contextType: "internal", internalProjectLabel: "probe" },
      { id: `exp_dc_aed_${STAMP}`, orgId, personId: UID, expenseDate: today, captureSource: "manual", amount: 367.25, currency: "AED", usdAmount: 100, fxRate: 3.6725, fxRateDate: today, category: "travel", status: "draft", policyStatus: "green", contextType: "internal", internalProjectLabel: "probe" },
    ]);

    // ---- preferences ----
    const prefs = await call("GET", "/atelier/me/preferences");
    check("default preference is USD + supported list", prefs.status === 200 && prefs.body?.displayCurrency === "USD" && Array.isArray(prefs.body?.supportedCurrencies) && prefs.body.supportedCurrencies.includes("AED"));
    const bad = await call("PATCH", "/atelier/me/preferences", { displayCurrency: "XXX" });
    check("unsupported currency \u2192 400", bad.status === 400);
    const set = await call("PATCH", "/atelier/me/preferences", { displayCurrency: "aed" });
    check("set AED (case-insensitive) \u2192 200", set.status === 200 && set.body?.displayCurrency === "AED");
    const audit = await db.select().from(atelierAuditEvents).where(eq(atelierAuditEvents.actorId, UID));
    check("preference change audited", audit.some((a) => a.action === "me.preferences.updated"));

    // ---- expenses display conversion ----
    const list = await call("GET", "/atelier/me/expenses");
    check("list carries displayCurrency=AED", list.status === 200 && list.body?.displayCurrency === "AED");
    const rows: any[] = list.body?.expenses ?? [];
    const usd = rows.find((e) => e.id === `exp_dc_usd_${STAMP}`);
    const aed = rows.find((e) => e.id === `exp_dc_aed_${STAMP}`);
    check("AED row unconverted", !!aed && aed.display?.currency === "AED" && aed.display.converted === false && Math.abs(aed.display.amount - 367.25) < 0.01);
    check("USD row converted \u2248 367 AED", !!usd && usd.display?.currency === "AED" && usd.display.converted === true && usd.display.amount > 330 && usd.display.amount < 410, `got=${usd?.display?.amount}`);

    const back = await call("PATCH", "/atelier/me/preferences", { displayCurrency: "USD" });
    const list2 = await call("GET", "/atelier/me/expenses");
    const aed2 = (list2.body?.expenses ?? []).find((e: any) => e.id === `exp_dc_aed_${STAMP}`);
    check("switch back to USD converts AED row \u2248 100", back.status === 200 && aed2?.display?.currency === "USD" && aed2.display.converted === true && Math.abs(aed2.display.amount - 100) < 8, `got=${aed2?.display?.amount}`);
  } finally {
    try {
      await db.delete(atelierExpenses).where(eq(atelierExpenses.personId, UID));
      await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, UID));
      await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, EMAIL));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, UID));
    } catch (err) {
      console.error("cleanup failed", err);
    }
    server.close();
    await pool.end();
  }
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILURE(S): ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
