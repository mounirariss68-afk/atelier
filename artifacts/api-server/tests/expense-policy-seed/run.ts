/**
 * Expense-policy first-read auto-seed regression probe (scratch DB).
 *
 * Covers:
 *   - First GET /wallet/policy on an org with zero rules auto-seeds the
 *     lean defaults with exactly one system audit entry (+ principles).
 *   - Repeat reads: no duplicates, no extra audits.
 *   - Retired rules are never re-added (auto-seed nor explicit restore).
 *   - Edited rules are never overwritten.
 *   - A second org seeds its own independent rule set (per-org ids).
 *   - Concurrent first evaluations produce exactly one audit entry.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/expense-policy-seed/run.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierExpensePolicies, atelierAuditEvents } = D;
  const { and, eq } = await import("drizzle-orm");
  const P = await import("../../src/lib/atelier-expense-policy.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe1101_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const betaOrg = `org_${runTag}_beta`;
  const betaFpId = `u_${runTag}_beta_fp`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (persona: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };

  const autoSeedAudits = async () =>
    db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityType, "wallet_policy"),
      eq(atelierAuditEvents.action, "wallet.policy.auto_seed"),
    ));
  const orgRules = async (orgId: string) =>
    db.select().from(atelierExpensePolicies).where(eq(atelierExpensePolicies.orgId, orgId));

  try {
    // The scratch DB is reused across harness runs — reset the tables this
    // probe asserts absolute counts on (scratch only; never the live DB).
    await db.delete(atelierExpensePolicies);
    await db.delete(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityType, "wallet_policy"),
      eq(atelierAuditEvents.action, "wallet.policy.auto_seed"),
    ));

    await db.insert(atelierUsers).values([
      {
        id: fpId, orgId: "aico", name: "Probe1101 Partner", initials: "PP",
        email: `${runTag}_fp@example.test`, role: "founding_partner",
        roleLabel: "Founding Partner", title: "Founding Partner",
      },
      {
        id: betaFpId, orgId: betaOrg, name: "Probe1101 Beta Partner", initials: "BP",
        email: `${runTag}_beta_fp@example.test`, role: "founding_partner",
        roleLabel: "Founding Partner", title: "Founding Partner",
      },
    ] as any);

    // Scratch DB starts with zero policy rows.
    check("scratch starts empty", (await db.select().from(atelierExpensePolicies)).length === 0);

    // 1. First read auto-seeds.
    const first = await api(fpId, "GET", "/wallet/policy");
    check("first read 200", first.status === 200, first);
    check("first read seeded 8 rules", first.body?.rules?.length === 8, first.body?.rules?.length);
    check("principles present", typeof first.body?.principles === "string" && first.body.principles.length > 50);
    check("every rule has rationale", (first.body?.rules ?? []).every((r: any) => r.rationale));
    let audits = await autoSeedAudits();
    check("exactly one auto-seed audit", audits.length === 1, audits.length);
    check("audit is system-attributed", audits[0]?.actorType === "system");

    // 2. Repeat read: idempotent.
    const second = await api(fpId, "GET", "/wallet/policy");
    check("second read still 8", second.body?.rules?.length === 8);
    check("still one audit", (await autoSeedAudits()).length === 1);

    // 3. Edited rule preserved.
    await api(fpId, "PATCH", "/wallet/policy/pol_meal_default", {
      capAmountUsd: 99, capUnit: "per_day", hardBlockAmountUsd: 400,
      approvalThresholdUsd: 150, rationale: "edited", active: true,
    });
    // 4. Retired rule never re-added — by auto-seed nor explicit restore.
    await api(fpId, "DELETE", "/wallet/policy/pol_taxi_default");
    const restore = await api(fpId, "POST", "/wallet/policy/seed-defaults");
    check("restore re-adds nothing (all ids exist)", restore.body?.count === 0, restore.body);
    const after = await api(fpId, "GET", "/wallet/policy");
    const meal = after.body?.rules?.find((r: any) => r.id === "pol_meal_default");
    check("edited cap preserved", meal?.capAmountUsd === 99, meal);
    check("retired rule stays gone", !after.body?.rules?.some((r: any) => r.id === "pol_taxi_default"));
    check("still one auto-seed audit after edits", (await autoSeedAudits()).length === 1);

    // 5. Second org seeds independently with per-org ids.
    const beta = await api(betaFpId, "GET", "/wallet/policy");
    check("beta org seeded 8 rules", beta.body?.rules?.length === 8, beta.body?.rules?.length);
    check("beta ids are org-suffixed", (beta.body?.rules ?? []).every((r: any) => r.id.endsWith(`__${betaOrg}`)));
    check("beta rules org-stamped", (await orgRules(betaOrg)).every((r) => r.orgId === betaOrg));
    check("aico unaffected by beta seed", (await orgRules("aico")).length === 8);
    const auditsAfterBeta = await autoSeedAudits();
    check("two auto-seed audits total", auditsAfterBeta.length === 2);
    check("aico audit org-scoped", auditsAfterBeta.some((a) => a.orgId === "aico"));
    check("beta audit scoped to beta org", auditsAfterBeta.some((a) => a.orgId === betaOrg), auditsAfterBeta.map((a) => a.orgId));
    check("beta cannot see aico rules", !(beta.body?.rules ?? []).some((r: any) => r.id === "pol_meal_default"));

    // 6. Concurrent first evaluations on a fresh org: one audit, no dupes.
    const gammaOrg = `org_${runTag}_gamma`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        P.evaluateExpense({ orgId: gammaOrg, category: "hotel", usdAmount: 300, amount: 300, currency: "USD" }),
      ),
    );
    check("concurrent evals all amber (rules applied)", results.every((r) => r.status === "amber"), results.map((r) => r.status));
    check("gamma seeded exactly 8 rows", (await orgRules(gammaOrg)).length === 8);
    const auditsAfterGamma = await autoSeedAudits();
    check("exactly three auto-seed audits total", auditsAfterGamma.length === 3, auditsAfterGamma.length);
    check("gamma concurrent audit scoped to gamma org", auditsAfterGamma.filter((a) => a.orgId === gammaOrg).length === 1, auditsAfterGamma.map((a) => a.orgId));

    // 7. Policy semantics spot checks (aico, post-edit).
    const gift = await P.evaluateExpense({ orgId: "aico", category: "gift", usdAmount: 400, amount: 400, currency: "USD" });
    check("gift $400 hard-blocked (red)", gift.status === "red", gift);
    const meal40 = await P.evaluateExpense({ orgId: "aico", category: "meal", usdAmount: 40, amount: 40, currency: "USD" });
    check("meal $40 green", meal40.status === "green", meal40);
  } finally {
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
