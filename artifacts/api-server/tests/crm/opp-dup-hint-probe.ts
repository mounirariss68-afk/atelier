/**
 * Task #37 — standalone probe for the live duplicate-opportunity hint
 * endpoint. Boots the app in-process (app.listen(0)), inserts a temp account
 * + opportunities, and asserts:
 *   1. GET /opportunities/check-duplicates returns a fuzzy match for a
 *      near-identical name and flags an exact normalized match.
 *   2. Archived (soft-deleted) opportunities are excluded.
 *   3. Missing params → 400; unknown account → 404; unauthenticated → 401.
 * Cleans up all fixtures in finally.
 */

process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

const FP = "p_mounir_ariss";

async function main() {
  const { default: app } = await import("../../src/app.ts");
  const { db, atelierAccounts, atelierOpportunities } = await import("@workspace/db");

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  async function get(path: string, persona?: string) {
    const res = await fetch(`${BASE}${path}`, {
      headers: persona ? { cookie: `atelier_persona=${persona}` } : {},
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, json };
  }

  const STAMP = Date.now();
  const acctId = `__probe37_acct_${STAMP}`;
  const oppOpen = `__probe37_opp1_${STAMP}`;
  const oppArchived = `__probe37_opp2_${STAMP}`;

  try {
    await db.insert(atelierAccounts).values({
      id: acctId,
      name: `Probe37 Holdings ${STAMP}`,
      country: "Türkiye",
      sector: "Probe",
      createdByUserId: FP,
    } as any);
    await db.insert(atelierOpportunities).values([
      {
        id: oppOpen,
        slug: `probe37-open-${STAMP}`,
        name: "Tasama AI Pricing Diagnostic",
        accountId: acctId,
        salesStage: "identify",
        partnerOwnerId: FP,
        engagementLeadId: FP,
        dealSizeHypothesis: 100000,
        probabilityPct: 25,
        nextMilestone: "probe",
        sourceLead: "manual",
        createdByUserId: FP,
      },
      {
        id: oppArchived,
        slug: `probe37-arch-${STAMP}`,
        name: "Tasama AI Pricing Diagnostic v2",
        accountId: acctId,
        salesStage: "identify",
        partnerOwnerId: FP,
        engagementLeadId: FP,
        dealSizeHypothesis: 100000,
        probabilityPct: 25,
        nextMilestone: "probe",
        sourceLead: "manual",
        createdByUserId: FP,
        deletedAt: new Date(),
      },
    ] as any);

    // 1. fuzzy near-match
    let r = await get(
      `/opportunities/check-duplicates?accountId=${acctId}&name=${encodeURIComponent("Tasama AI pricing diagnostics")}`,
      FP,
    );
    check("fuzzy match 200", r.status === 200, r);
    check(
      "fuzzy match returns open opp",
      r.json?.candidates?.some((c: any) => c.id === oppOpen && !c.exact),
      r.json,
    );
    check(
      "archived opp excluded",
      !r.json?.candidates?.some((c: any) => c.id === oppArchived),
      r.json,
    );

    // exact normalized match flagged
    r = await get(
      `/opportunities/check-duplicates?accountId=${acctId}&name=${encodeURIComponent("tasama ai PRICING diagnostic!")}`,
      FP,
    );
    check(
      "exact normalized match flagged",
      r.json?.candidates?.some((c: any) => c.id === oppOpen && c.exact === true),
      r.json,
    );

    // unrelated name → empty
    r = await get(
      `/opportunities/check-duplicates?accountId=${acctId}&name=${encodeURIComponent("Zebra quantum logistics")}`,
      FP,
    );
    check("unrelated name → empty list", r.status === 200 && r.json?.candidates?.length === 0, r.json);

    // 3. error paths
    r = await get(`/opportunities/check-duplicates?accountId=${acctId}`, FP);
    check("missing name → 400", r.status === 400, r);
    r = await get(`/opportunities/check-duplicates?accountId=__nope__&name=abc`, FP);
    check("unknown account → 404", r.status === 404, r);
    r = await get(`/opportunities/check-duplicates?accountId=${acctId}&name=abc`);
    check("unauthenticated → 401", r.status === 401, r);
  } finally {
    await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, oppOpen));
    await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, oppArchived));
    await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
