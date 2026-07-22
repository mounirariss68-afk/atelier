/**
 * Task #513 — Partners lens access + CRUD probe.
 *
 * Runs standalone (tsx ./tests/partners/run.ts) booting the app in-process
 * via app.listen(0); NODE_ENV=test enables the persona-cookie bypass so
 * requests act as ephemeral p_test_* personas. All rows created here are
 * removed in `finally`.
 *
 * Coverage:
 *   1. Lens boundary: partner_firm_resource, contractor, employee,
 *      recruiter and board_observer are 403'd on /partners/* (and legacy
 *      /alliances/*) at the central gate; consultant / hr /
 *      compliance_officer / finance / partner / founding_partner read 200.
 *   2. Write roles: consultant (reader-only) gets 403 on firm create;
 *      senior_manager / finance / founding_partner can create.
 *   3. Firm CRUD lifecycle: create → read → patch (tier change appends
 *      tierHistory) → archive (list no longer returns it).
 *   4. Target promote: creates a firm, stamps promotedFirmId + status.
 *   5. Joint pipeline: create against a real opportunity, response is
 *      enriched with opportunityName/clientName/salesStage.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_pn_fp_${STAMP}`;
const FIN_ID = `p_test_pn_fin_${STAMP}`;
const SM_ID = `p_test_pn_sm_${STAMP}`;
const CONS_ID = `p_test_pn_cons_${STAMP}`;
const HR_ID = `p_test_pn_hr_${STAMP}`;
const CO_ID = `p_test_pn_co_${STAMP}`;
const PFR_ID = `p_test_pn_pfr_${STAMP}`;
const CTR_ID = `p_test_pn_ctr_${STAMP}`;
const EMP_ID = `p_test_pn_emp_${STAMP}`;
const REC_ID = `p_test_pn_rec_${STAMP}`;
const BO_ID = `p_test_pn_bo_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierPartnerFirms,
    atelierPartnerTargets,
    atelierAllianceJointPipeline,
    atelierAllianceCertifications,
    atelierAllianceConflicts,
    atelierAuditEvents,
    atelierCounterparty,
    atelierContract,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string,
    path: string,
    personaId: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const accId = `acct_test_pn_${STAMP}`;
  const oppId = `opp_test_pn_${STAMP}`;

  try {
    const personas = [
      { id: FP_ID, role: "founding_partner", name: "PN FP" },
      { id: FIN_ID, role: "finance", name: "PN Finance" },
      { id: SM_ID, role: "senior_manager", name: "PN SM" },
      { id: CONS_ID, role: "consultant", name: "PN Consultant" },
      { id: HR_ID, role: "hr", name: "PN HR" },
      { id: CO_ID, role: "compliance_officer", name: "PN Compliance" },
      { id: PFR_ID, role: "partner_firm_resource", name: "PN PFR" },
      { id: CTR_ID, role: "contractor", name: "PN Contractor" },
      { id: EMP_ID, role: "employee", name: "PN Employee" },
      { id: REC_ID, role: "recruiter", name: "PN Recruiter" },
      { id: BO_ID, role: "board_observer", name: "PN Board" },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "PN",
          role: p.role,
          roleLabel: p.name,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }

    // Seed a real account + opportunity for the joint-pipeline linkage.
    await db.insert(atelierAccounts).values({
      id: accId,
      orgId: ORG,
      name: `PN Probe Account ${STAMP}`,
      country: "AE",
      sector: "Technology",
      tier: "B",
      status: "active",
      primaryCurrency: "AED",
      primaryLanguage: "en",
      createdByUserId: FP_ID,
    });
    await db.insert(atelierOpportunities).values({
      id: oppId,
      orgId: ORG,
      accountId: accId,
      slug: `pn-probe-${STAMP}`,
      name: `PN Probe Opp ${STAMP}`,
      salesStage: "prospect",
      partnerOwnerId: FP_ID,
      engagementLeadId: FP_ID,
      dealSizeHypothesis: 100000,
      probabilityPct: 20,
      nextMilestone: "probe",
      nextMilestoneDate: new Date(),
      closeDate: new Date(),
      forecastCategory: "pipeline",
      buyerPersona: "CIO",
      offeringAnchor: "advisory",
      sourceLead: "pn-probe",
      daysInStage: 0,
      createdByUserId: FP_ID,
    });

    // =====================================================================
    group("lens boundary \u2014 denied personas 403 at the gate");
    // =====================================================================
    for (const [label, pid] of [
      ["partner_firm_resource", PFR_ID],
      ["contractor", CTR_ID],
      ["employee", EMP_ID],
      ["recruiter", REC_ID],
      ["board_observer", BO_ID],
    ] as const) {
      const r = await call("GET", "/partners/firms", pid);
      check(`${label} \u2192 403 on /partners/firms`, r.status === 403, `status=${r.status}`);
    }
    const pfrLegacy = await call("GET", "/alliances/partner-firms", PFR_ID);
    check("partner_firm_resource \u2192 403 on legacy /alliances/*", pfrLegacy.status === 403, `status=${pfrLegacy.status}`);

    // =====================================================================
    group("lens boundary \u2014 readers 200");
    // =====================================================================
    for (const [label, pid] of [
      ["founding_partner", FP_ID],
      ["finance", FIN_ID],
      ["senior_manager", SM_ID],
      ["consultant", CONS_ID],
      ["hr", HR_ID],
      ["compliance_officer", CO_ID],
    ] as const) {
      const r = await call("GET", "/partners/firms", pid);
      check(`${label} \u2192 200 on /partners/firms`, r.status === 200 && Array.isArray(r.body?.items), `status=${r.status}`);
    }

    // =====================================================================
    group("write roles \u2014 reader-only personas cannot create");
    // =====================================================================
    const firmInput = { name: `PN Probe Firm ${STAMP}`, kind: "boutique SI", status: "active" };
    for (const [label, pid] of [
      ["consultant", CONS_ID],
      ["hr", HR_ID],
      ["compliance_officer", CO_ID],
    ] as const) {
      const r = await call("POST", "/partners/firms", pid, firmInput);
      check(`${label} \u2192 403 on firm create`, r.status === 403, `status=${r.status}`);
    }

    // =====================================================================
    group("firm CRUD lifecycle (founding_partner)");
    // =====================================================================
    const created = await call("POST", "/partners/firms", FP_ID, {
      ...firmInput,
      tier: "transactional",
      country: "AE",
    });
    const firmId = created.body?.id as string | undefined;
    check("create firm \u2192 201 with id", created.status === 201 && !!firmId, `status=${created.status}`);

    const smCreated = await call("POST", "/partners/firms", SM_ID, { name: `PN SM Firm ${STAMP}` });
    check("senior_manager can create firm", smCreated.status === 201, `status=${smCreated.status}`);
    const finCreated = await call("POST", "/partners/firms", FIN_ID, { name: `PN FIN Firm ${STAMP}` });
    check("finance can create firm", finCreated.status === 201, `status=${finCreated.status}`);

    if (firmId) {
      const got = await call("GET", `/partners/firms/${firmId}`, CONS_ID);
      check("consultant can read firm detail", got.status === 200 && got.body?.name === firmInput.name, `status=${got.status}`);

      const patched = await call("PATCH", `/partners/firms/${firmId}`, FIN_ID, { tier: "preferred", capabilities: { delivery: 4 } });
      check(
        "patch tier \u2192 tierHistory appended",
        patched.status === 200 &&
          Array.isArray(patched.body?.tierHistory) &&
          patched.body.tierHistory.some((h: any) => h.toTier === "preferred"),
        `status=${patched.status} hist=${JSON.stringify(patched.body?.tierHistory)?.slice(0, 200)}`,
      );
      check("patch capabilities persisted", patched.body?.capabilities?.delivery === 4);

      const consPatch = await call("PATCH", `/partners/firms/${firmId}`, CONS_ID, { notes: "should fail" });
      check("consultant \u2192 403 on firm patch", consPatch.status === 403, `status=${consPatch.status}`);

      // ---- joint pipeline against the real opportunity ----
      group("joint pipeline \u2014 CRM-linked");
      const jp = await call("POST", "/partners/joint-pipeline", FP_ID, {
        opportunityId: oppId,
        partnerFirmId: firmId,
        leadParty: "cognirise",
        cognirisePct: 60,
        partnerPct: 40,
        partnerSourced: true,
      });
      check(
        "create joint-pipeline entry \u2192 201 enriched with opp fields",
        jp.status === 201 && jp.body?.opportunityName?.includes("PN Probe Opp") && !!jp.body?.clientName,
        `status=${jp.status} body=${JSON.stringify(jp.body)?.slice(0, 200)}`,
      );
      const jpBadOpp = await call("POST", "/partners/joint-pipeline", FP_ID, {
        opportunityId: "opp_does_not_exist",
        partnerFirmId: firmId,
        leadParty: "cognirise",
        cognirisePct: 50,
        partnerPct: 50,
      });
      check("joint-pipeline rejects unknown opportunity", jpBadOpp.status === 422, `status=${jpBadOpp.status}`);

      // ---- agreements: NDA maps to the partner firm by counterparty name ----
      group("agreements NDA \u2192 firm mapping");
      const cpId = `cp_test_pn_${STAMP}`;
      const contractId = `ct_test_pn_${STAMP}`;
      await db.insert(atelierCounterparty).values({
        id: cpId,
        orgId: ORG,
        kind: "partner_firm",
        legalName: `PN Probe Firm ${STAMP} Ltd`,
        displayName: `PN Probe Firm ${STAMP}`,
      });
      await db.insert(atelierContract).values({
        id: contractId,
        orgId: ORG,
        instrumentType: "nda",
        counterpartyId: cpId,
        title: `PN Probe NDA ${STAMP}`,
        status: "in_signature",
      });
      const agr = await call("GET", "/partners/agreements", FP_ID);
      const agrItem = (agr.body?.items ?? []).find((a: any) => a.id === contractId);
      check(
        "NDA agreement resolves partnerFirmId via counterparty name",
        agr.status === 200 && agrItem?.partnerFirmId === firmId,
        `status=${agr.status} item=${JSON.stringify(agrItem)?.slice(0, 200)}`,
      );

      // ---- archive ----
      group("archive firm");
      const arch = await call("POST", `/partners/firms/${firmId}/archive`, FP_ID);
      check("archive firm \u2192 200", arch.status === 200, `status=${arch.status}`);
      const listAfter = await call("GET", "/partners/firms", FP_ID);
      const stillThere = (listAfter.body?.items ?? []).some((f: any) => f.id === firmId);
      check("archived firm no longer listed", listAfter.status === 200 && !stillThere);
    }

    // =====================================================================
    group("target promote");
    // =====================================================================
    const target = await call("POST", "/partners/targets", SM_ID, {
      name: `PN Probe Target ${STAMP}`,
      ecosystem: "AWS",
      priority: "high",
      status: "evaluating",
    });
    const targetId = target.body?.id as string | undefined;
    check("create target \u2192 201", target.status === 201 && !!targetId, `status=${target.status}`);
    if (targetId) {
      const promoted = await call("POST", `/partners/targets/${targetId}/promote`, SM_ID);
      check(
        "promote target \u2192 firm created + status promoted",
        promoted.status === 201 &&
          promoted.body?.target?.status === "promoted" &&
          !!promoted.body?.firm?.id,
        `status=${promoted.status} body=${JSON.stringify(promoted.body)?.slice(0, 200)}`,
      );
      const consPromote = await call("POST", `/partners/targets/${targetId}/promote`, CONS_ID);
      check("consultant \u2192 403 on promote", consPromote.status === 403, `status=${consPromote.status}`);
    }
  } finally {
    // ---- cleanup: tag-sweep everything this probe created ----
    try {
      await db.delete(atelierAllianceJointPipeline).where(like(atelierAllianceJointPipeline.id, "%"));
      await db.delete(atelierAllianceCertifications).where(like(atelierAllianceCertifications.credential, `%${STAMP}%`));
      await db.delete(atelierAllianceConflicts).where(like(atelierAllianceConflicts.headline, `%${STAMP}%`));
      await db.delete(atelierPartnerFirms).where(like(atelierPartnerFirms.name, `%${STAMP}%`));
      await db.delete(atelierPartnerTargets).where(like(atelierPartnerTargets.name, `%${STAMP}%`));
      const { hardDeleteOpportunities } = await import("../../src/lib/atelier-opportunity-delete.ts");
      await hardDeleteOpportunities([oppId]);
      await db.delete(atelierContract).where(like(atelierContract.id, `ct_test_pn_%`));
      await db.delete(atelierCounterparty).where(like(atelierCounterparty.id, `cp_test_pn_%`));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [accId]));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `p_test_pn_%_${STAMP}`));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_pn_%_${STAMP}`));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILURES`}`);
  if (failures.length) {
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
