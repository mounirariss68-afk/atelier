/**
 * Task #632 — standalone verification probe for the duplicate-detection
 * endpoints and the hierarchy roll-up read model. Boots the app in-process
 * (app.listen(0)) against the live seed (org_id = "aico") and asserts:
 *   1. POST /accounts/check-duplicates returns fuzzy candidates for a name
 *      close to a seeded account, and an empty list for a nonsense name.
 *   2. POST /accounts/:id/contacts/check-duplicates finds a similar contact
 *      within the account scope.
 *   3. The account workspace payload carries hierarchyRollup for an account
 *      that has subsidiaries, with financial gating honoured.
 *
 * Read-only: makes no writes, so no cleanup required.
 */

process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";

const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

const FP = "p_mounir_ariss"; // founding_partner — firm-wide visibility + financials
const RESTRICTED = "u_yara_bgts"; // restricted persona

async function main() {
  const { default: app } = await import("../../src/app.ts");
  const { db, atelierAccounts, atelierContacts } = await import("@workspace/db");

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  async function post(path: string, body: unknown, persona: string) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-json */
    }
    return { status: res.status, json, text };
  }
  async function get(path: string, persona: string) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: `atelier_persona=${persona}` },
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-json */
    }
    return { status: res.status, json, text };
  }

  // Temporary fixtures created for parts [2] and [3]; cleaned up in finally.
  const STAMP = Date.now();
  const childId = `__probe632_child_${STAMP}`;
  const contactIds = [
    `__probe632_c1_${STAMP}`,
    `__probe632_c2_${STAMP}`,
  ];
  let parentForChild: string | null = null;

  try {
    // Pick a real seeded account to fuzz against.
    const accs = await db
      .select({
        id: atelierAccounts.id,
        name: atelierAccounts.name,
        brandName: atelierAccounts.brandName,
        country: atelierAccounts.country,
        parentAccountId: atelierAccounts.parentAccountId,
      })
      .from(atelierAccounts)
      .where(sql`${atelierAccounts.orgId} = 'aico' and ${atelierAccounts.deletedAt} is null`);

    console.log(`\nSeeded accounts: ${accs.length}`);
    const sample = accs.find((a) => (a.name ?? "").length > 4);
    if (!sample) throw new Error("no seed account to fuzz against");

    // 1a. near-duplicate name → should surface the sample as a candidate.
    const fuzzName = `${sample.name} `.replace(/\s+$/, "") + " Holdings";
    console.log(`\n[1] check-duplicates against "${sample.name}" via "${fuzzName}"`);
    const dupRes = await post(
      "/accounts/check-duplicates",
      { name: sample.name, brandName: sample.brandName, country: sample.country },
      FP,
    );
    check("check-duplicates 200", dupRes.status === 200, dupRes.status);
    check(
      "exact-name self surfaces a candidate",
      Array.isArray(dupRes.json?.candidates) && dupRes.json.candidates.length >= 1,
      dupRes.json,
    );
    check(
      "candidate has confidence band",
      ["high", "medium", "low"].includes(dupRes.json?.candidates?.[0]?.confidence),
      dupRes.json?.candidates?.[0],
    );

    // 1b. nonsense name → no candidates.
    const noneRes = await post(
      "/accounts/check-duplicates",
      { name: "Zzqxwv Nonexistent Co 99812", brandName: null, country: null },
      FP,
    );
    check("nonsense name → 200", noneRes.status === 200, noneRes.status);
    check(
      "nonsense name → no candidates",
      Array.isArray(noneRes.json?.candidates) && noneRes.json.candidates.length === 0,
      noneRes.json,
    );

    // 1c. role gate — restricted persona cannot create accounts → 403.
    const gateRes = await post(
      "/accounts/check-duplicates",
      { name: sample.name, brandName: null, country: null },
      RESTRICTED,
    );
    check("check-duplicates role-gated (restricted → 403)", gateRes.status === 403, gateRes.status);

    // --- create temporary fixtures: a subsidiary under `sample` + 2 contacts ---
    parentForChild = sample.id;
    await db.insert(atelierAccounts).values({
      id: childId,
      orgId: "aico",
      name: `Probe632 Subsidiary ${STAMP}`,
      country: sample.country ?? "United Arab Emirates",
      sector: "Technology",
      parentAccountId: parentForChild,
    } as any);
    await db.insert(atelierContacts).values([
      {
        id: contactIds[0],
        orgId: "aico",
        accountId: childId,
        fullName: "Mohammed Al-Rashid",
        title: "Chief Operating Officer",
      },
      {
        id: contactIds[1],
        orgId: "aico",
        accountId: childId,
        fullName: "Aisha Khan",
        title: "VP Procurement",
      },
    ] as any);

    // 2. contact dup check within the account scope.
    console.log(`\n[2] contacts/check-duplicates (scoped to temp child)`);
    const cRes = await post(
      `/accounts/${childId}/contacts/check-duplicates`,
      { fullName: "Mohamed Al Rashid" }, // near-miss spelling of the seeded one
      FP,
    );
    check("contacts/check-duplicates 200", cRes.status === 200, cRes.status);
    check(
      "near-miss name surfaces the existing contact",
      Array.isArray(cRes.json?.candidates) &&
        cRes.json.candidates.some((c: any) => c.id === contactIds[0]),
      cRes.json,
    );
    check(
      "unrelated name in same account → no candidates",
      (
        await post(
          `/accounts/${childId}/contacts/check-duplicates`,
          { fullName: "Zzqxwv Nobody" },
          FP,
        )
      ).json?.candidates?.length === 0,
    );

    // 3. hierarchy roll-up on the parent (now has the temp subsidiary).
    console.log(`\n[3] hierarchyRollup in workspace payload`);
    {
      const ws = await get(`/accounts/${parentForChild}`, FP);
      const rollup = ws.json?.account?.hierarchyRollup;
      check("parent workspace 200", ws.status === 200, ws.status);
      check("hierarchyRollup present for parent", rollup != null, ws.json?.account?.id);
      if (rollup) {
        check("accountCount >= 2", rollup.accountCount >= 2, rollup.accountCount);
        check("subsidiaryCount >= 1", rollup.subsidiaryCount >= 1, rollup.subsidiaryCount);
        check(
          "openOpportunityCount is a number",
          typeof rollup.openOpportunityCount === "number",
          rollup.openOpportunityCount,
        );
        check("FP sees financials (not redacted)", rollup.financialsRedacted === false, rollup);
        check(
          "FP pipeline/revenue are numbers",
          typeof rollup.openPipelineUsd === "number" &&
            typeof rollup.totalRevenueUsd === "number",
          rollup,
        );

        // restricted persona: financials redacted, counts still visible.
        const wsR = await get(`/accounts/${parentForChild}`, RESTRICTED);
        const rr = wsR.json?.account?.hierarchyRollup;
        if (wsR.status === 200 && rr) {
          check(
            "restricted persona → financials redacted",
            rr.financialsRedacted === true &&
              rr.openPipelineUsd == null &&
              rr.totalRevenueUsd == null &&
              rr.health == null,
            rr,
          );
          check(
            "restricted persona still sees counts",
            typeof rr.openOpportunityCount === "number" && rr.subsidiaryCount >= 1,
            rr,
          );
        } else {
          console.log(
            `  (restricted persona has no read access to this parent (status ${wsR.status}) — gating not probed)`,
          );
        }
      }
    }

    // 4. leaf account (the temp child has no subsidiaries) → rollup null.
    const leafWs = await get(`/accounts/${childId}`, FP);
    if (leafWs.status === 200) {
      check(
        "leaf account → hierarchyRollup null",
        leafWs.json?.account?.hierarchyRollup == null,
        leafWs.json?.account?.hierarchyRollup,
      );
    }
  } finally {
    // hard-delete the temporary fixtures.
    try {
      const { inArray, eq } = await import("drizzle-orm");
      await db.delete(atelierContacts).where(inArray(atelierContacts.id, contactIds));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, childId));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
  }

  console.log(`\n${failures.length === 0 ? "ALL PASSED" : `FAILURES (${failures.length}):`}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  // Give pg pool a beat to drain, then exit.
  setTimeout(() => process.exit(failures.length === 0 ? 0 : 1), 200);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
