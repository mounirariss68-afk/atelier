/**
 * UAT gap probe — L2 bug confirmation (chat CRM surface).
 *
 * Confirms/refutes the 4 candidate bugs surfaced by probe-l1:
 *   B1. opportunity_move_stage skip transitions bypass pair-specific
 *       gates (suspect→runner with no 5C / no convert evidence).
 *   B2. findToolByName persona filter is defeated by the catalog
 *       fall-through (board_observer resolves a write tool).
 *   B3. account_update: (a) no existence check → ok:true on missing
 *       id; (b) no canSeeAccount guard → restricted persona can patch
 *       an out-of-scope account.
 *   B4. resolve_entity does not short-circuit an exact-name match
 *       (already evidenced in probe-l1; re-shown here vs account_lookup).
 */

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { and, eq, inArray, isNull } from "drizzle-orm";

const ORG = "aico";
const ACC_OOS = "acc_dge";
const STAMP = Date.now().toString(36);
const TAG = `UATGAP2-${STAMP}`;
const uniq = (p: string) => `${TAG} ${p}`;

let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } else {
    failures.push(label);
    console.log(`  \u2717 ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)?.slice(0, 400)}` : ""}`);
  }
}
function group(name: string) {
  console.log(`\n\u2500\u2500 ${name}`);
}

async function main() {
  const D: any = await import("@workspace/db");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  const cliIndex = await import("../../src/lib/atelier-cli/index.js");

  const { db, pool, atelierUsers, atelierAccounts, atelierOpportunities, atelierAuditEvents } = D;

  const created = { accounts: new Set<string>(), opps: new Set<string>(), users: new Set<string>() };

  // Task T003 — the demo personas were removed from the seed; this probe now
  // provisions its own EPHEMERAL RESTRICTED persona (created below, cleaned up
  // in finally) with the same partner_firm_resource role the old one had.
  const RESTRICTED_ID = "p_test_probe2_restricted";

  function makeCtx(personaId: string, role: string, name: string) {
    return {
      persona: { id: personaId, name, role, orgId: ORG },
      turnId: `uatgap2-turn-${STAMP}`,
      sessionId: `uatgap2-session-${STAMP}`,
      stepIdx: 0,
    };
  }
  const fpCtx = makeCtx("p_mounir_ariss", "founding_partner", "Mounir Ariss");
  const restrictedCtx = makeCtx(RESTRICTED_ID, "partner_firm_resource", "Test Restricted Resource");
  const cap = (tool: string) => {
    const c = catalog.findByToolName(tool);
    if (!c) throw new Error(`capability ${tool} not registered`);
    return c;
  };

  try {
    // ---- provision the ephemeral RESTRICTED persona (Task T003) ----
    await db
      .insert(atelierUsers)
      .values({
        id: RESTRICTED_ID,
        orgId: ORG,
        email: "test.probe2.restricted@bgts.example",
        name: "Test Restricted Resource",
        initials: "TR",
        role: "partner_firm_resource",
        roleLabel: "Senior Consultant — BGTS",
        title: "Senior Consultant — BGTS",
      })
      .onConflictDoNothing();
    created.users.add(RESTRICTED_ID);

    // ---- seed one account + one opp pinned at suspect via direct insert ----
    group("Seed (direct insert, salesStage pinned)");
    const accId = `acct_uatgap2_${STAMP}`;
    await db.insert(atelierAccounts).values({
      id: accId,
      orgId: ORG,
      name: uniq("GateProbe Co"),
      country: "AE",
      sector: "Technology",
      tier: "B",
      status: "active",
      primaryCurrency: "AED",
      primaryLanguage: "en",
      createdByUserId: "p_mounir_ariss",
    });
    created.accounts.add(accId);

    const oppId = `opp_uatgap2_${STAMP}`;
    await db.insert(atelierOpportunities).values({
      id: oppId,
      orgId: ORG,
      accountId: accId,
      slug: `uatgap2-${STAMP}`,
      name: uniq("GateProbe Opp"),
      salesStage: "suspect",
      partnerOwnerId: "p_mounir_ariss",
      engagementLeadId: "p_mounir_ariss",
      dealSizeHypothesis: 120000,
      probabilityPct: 10,
      nextMilestone: "UAT probe milestone",
      nextMilestoneDate: new Date(),
      closeDate: new Date(),
      forecastCategory: "pipeline",
      buyerPersona: "CIO",
      offeringAnchor: "advisory",
      sourceLead: "uat-probe",
      daysInStage: 0,
      createdByUserId: "p_mounir_ariss",
    });
    created.opps.add(oppId);
    const [freshOpp] = await db
      .select({ salesStage: atelierOpportunities.salesStage, qualify5c: atelierOpportunities.qualify5c })
      .from(atelierOpportunities)
      .where(eq(atelierOpportunities.id, oppId));
    check("seed opp pinned at suspect with no 5C", freshOpp?.salesStage === "suspect" && !freshOpp?.qualify5c, freshOpp);

    // =====================================================
    group("B1a \u00b7 adjacent gate works: suspect\u2192prospect w/o 5C \u2192 stage_gate_failed");
    {
      const move = cap("opportunity_move_stage");
      const r = await move.run({ opportunityId: oppId, toStage: "prospect", confirm: true }, fpCtx);
      check("suspect\u2192prospect w/o 5C \u2192 stage_gate_failed", r.ok === false && r.errorCode === "stage_gate_failed", r);
    }

    group("B1b \u00b7 skip transition bypasses gates: suspect\u2192runner w/o anything");
    {
      const move = cap("opportunity_move_stage");
      const r = await move.run({ opportunityId: oppId, toStage: "runner", confirm: true }, fpCtx);
      // EXPECTED (correct behaviour): gate failure. If ok:true, the pair-specific
      // gate design lets a skip transition sail past 5C + convert evidence.
      check("suspect\u2192runner w/o 5C/evidence \u2192 blocked", r.ok === false, r);
      const [row] = await db
        .select({ salesStage: atelierOpportunities.salesStage })
        .from(atelierOpportunities)
        .where(eq(atelierOpportunities.id, oppId));
      console.log(`    (db salesStage after attempt: ${row?.salesStage})`);
    }

    // =====================================================
    group("B2 \u00b7 findToolByName persona filter fall-through");
    {
      const obs = { id: "p_test_probe2_board_obs", name: "Test Board Observer", role: "board_observer", orgId: ORG };
      const surface = catalog.capabilitiesForPersona(obs as any).map((e: any) => e.toolName);
      const inSurface = surface.includes("opportunity_move_stage");
      const resolved = cliIndex.findToolByName("opportunity_move_stage", obs as any);
      check("board_observer surface excludes opportunity_move_stage", !inSurface);
      check(
        "findToolByName(board_observer) does NOT resolve excluded write tool",
        resolved === undefined,
        { resolvedName: resolved?.name ?? null },
      );
    }

    // =====================================================
    group("B3 \u00b7 account_update: existence + scope");
    {
      const upd = cap("account_update");
      const ghost = await upd.run({ id: "acct_does_not_exist_zz", notes: "ghost", confirm: true }, fpCtx);
      check(
        "update on nonexistent id \u2192 not_found (not silent ok)",
        ghost.ok === false,
        ghost,
      );

      // out-of-scope, real account, restricted persona, correct `id` field
      const [before] = await db
        .select({ notes: atelierAccounts.notes, updatedAt: atelierAccounts.updatedAt })
        .from(atelierAccounts)
        .where(eq(atelierAccounts.id, ACC_OOS));
      const oos = await upd.run({ id: ACC_OOS, notes: `${TAG} oos-probe`, confirm: true }, restrictedCtx);
      const [after] = await db
        .select({ notes: atelierAccounts.notes })
        .from(atelierAccounts)
        .where(eq(atelierAccounts.id, ACC_OOS));
      const wrote = after?.notes === `${TAG} oos-probe`;
      check(
        "restricted persona update on out-of-scope account \u2192 forbidden (no write)",
        oos.ok === false && !wrote,
        { result: oos, wrote },
      );
      if (wrote && before) {
        await db
          .update(atelierAccounts)
          .set({ notes: before.notes ?? null, updatedAt: before.updatedAt ?? new Date() })
          .where(eq(atelierAccounts.id, ACC_OOS));
        console.log("    (restored original notes on out-of-scope account)");
      }
    }

    // =====================================================
    group("B4 \u00b7 resolve_entity exact-match short-circuit vs account_lookup");
    {
      const exactName = uniq("GateProbe Co");
      const lk = await cap("account_lookup").run({ query: exactName }, fpCtx);
      check("account_lookup exact \u2192 unique resolve", lk.ok === true && lk.data?.id === accId, lk);
      const re = await cap("resolve_entity").run({ kind: "account", query: exactName }, fpCtx);
      const uniqueResolve = re.ok === true && (re.data?.entity?.id === accId || re.data?.id === accId);
      check("resolve_entity exact \u2192 unique resolve (no disambiguation)", uniqueResolve, {
        ok: re.ok,
        candidateCount: re.data?.candidateCount,
        disambiguation: Boolean(re.disambiguation),
      });
    }
  } finally {
    // ---- cleanup ----
    try {
      const oppIds = [...created.opps];
      const accIds = [...created.accounts];
      if (oppIds.length) await db.delete(atelierOpportunities).where(inArray(atelierOpportunities.id, oppIds));
      if (accIds.length) await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, accIds));
      if (oppIds.length || accIds.length) {
        await db
          .delete(atelierAuditEvents)
          .where(inArray(atelierAuditEvents.entityId, [...oppIds, ...accIds]));
      }
      // ACC_OOS audit rows from the probe are left in place on purpose —
      // deleting by entityId would wipe pre-existing history for a real row.
      // ephemeral RBAC persona (Task T003)
      if (created.users.size) await db.delete(atelierUsers).where(inArray(atelierUsers.id, [...created.users]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    await pool.end().catch(() => {});
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("FAILED (candidate bugs CONFIRMED where noted):");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
