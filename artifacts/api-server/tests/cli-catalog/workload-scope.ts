/**
 * Task #449 — deterministic ACL regression test for the scoped-caller
 * path of the `person.workload` capability (tool `person_workload`,
 * Task #443).
 *
 * The tool answers "what is X working on?" and must filter accounts /
 * engagements / opportunities the CALLER may not see (canSeeAccount +
 * engagement ACL) while reporting an honest hiddenAccountCount. The
 * positive path and restricted-persona denial were probed live; this
 * suite pins the partial-visibility contract so a regression can't
 * silently leak hidden account/deal names:
 *
 *   1. an engagement_lead manager views a report of theirs who is
 *      staffed on TWO accounts, only ONE of which the caller can see:
 *      visible rows returned, invisible rows excluded, and
 *      hiddenAccountCount === 1 (unique hidden accounts, not rows).
 *   2. no hidden account / engagement / opportunity NAME or id appears
 *      anywhere in the serialized result.
 *   3. roster-scope denial: the same caller asking about a person
 *      OUTSIDE their reports tree gets ok:false "forbidden".
 *   4. founding partner baseline: full card, hiddenAccountCount === 0.
 *
 * Runs standalone against the isolated scratch database (never the
 * live DB); ephemeral p_test_* personas + rows are deleted in `finally`.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import { inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const TAG = `__t449_${STAMP}`;

// atelier_users (logins)
const FP_UID = `p_test_wlfp_${STAMP}`;
const MGR_UID = `p_test_wlmgr_${STAMP}`;
const REP_UID = `p_test_wlrep_${STAMP}`;

// roster employee rows
const MGR_EMP = `emp_mgr_${TAG}`;
const REP_EMP = `emp_rep_${TAG}`;
const OUT_EMP = `emp_out_${TAG}`;

// business rows
const ACC_VIS = `acc_vis_${TAG}`;
const ACC_HID = `acc_hid_${TAG}`;
const ENG_VIS = `eng_vis_${TAG}`;
const ENG_HID = `eng_hid_${TAG}`;
const OPP_VIS = `opp_vis_${TAG}`;
const OPP_HID = `opp_hid_${TAG}`;
const HIDDEN_ACCOUNT_NAME = `Hidden Account ${TAG}`;
const HIDDEN_ENG_NAME = `Hidden Engagement ${TAG}`;
const HIDDEN_OPP_NAME = `Hidden Opportunity ${TAG}`;

const GRANT_MGR_VIS = `ega_mgrvis_${TAG}`;
const GRANT_REP_VIS = `ega_repvis_${TAG}`;
const GRANT_REP_HID = `ega_rephid_${TAG}`;
const TEAM_REP_VIS = `atm_vis_${TAG}`;
const TEAM_REP_HID = `atm_hid_${TAG}`;
const EDGE_ID = `rre_${TAG}`;

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
    atelierEmployees,
    atelierRosterReportsTo,
    atelierAccounts,
    atelierEngagements,
    atelierEngagementAccess,
    atelierAccountTeamMembers,
    atelierOpportunities,
  } = D as any;

  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { findByToolName } = catalog;

  const runTool = async (
    persona: { id: string; name: string; role: string; orgId: string },
    input: Record<string, unknown>,
  ) => {
    const entry = findByToolName("person_workload");
    if (!entry) throw new Error("tool person_workload not registered");
    return entry.run(input, { persona } as any);
  };

  const mgrPersona = { id: MGR_UID, name: "WL Manager", role: "engagement_lead", orgId: ORG };
  const fpPersona = { id: FP_UID, name: "WL FP", role: "founding_partner", orgId: ORG };

  try {
    // ---------------- seed -------------------------------------------
    await db.insert(atelierUsers).values([
      { id: FP_UID, orgId: ORG, email: `wlfp${STAMP}@test.local`, name: `WL FP ${TAG}`, initials: "WF", role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
      { id: MGR_UID, orgId: ORG, email: `wlmgr${STAMP}@test.local`, name: `WL Manager ${TAG}`, initials: "WM", role: "engagement_lead", roleLabel: "Engagement Lead", title: "Engagement Lead" },
      { id: REP_UID, orgId: ORG, email: `wlrep${STAMP}@test.local`, name: `WL Report ${TAG}`, initials: "WR", role: "consultant", roleLabel: "Consultant", title: "Consultant" },
    ]);

    await db.insert(atelierEmployees).values([
      { id: MGR_EMP, orgId: ORG, userId: MGR_UID, fullName: `WL Manager ${TAG}`, email: `wlmgr${STAMP}@test.local`, role: "engagement_lead", status: "active" },
      { id: REP_EMP, orgId: ORG, userId: REP_UID, fullName: `WL Report ${TAG}`, email: `wlrep${STAMP}@test.local`, role: "consultant", status: "active" },
      { id: OUT_EMP, orgId: ORG, userId: null, fullName: `WL Outside Tree ${TAG}`, email: `wlout${STAMP}@test.local`, role: "consultant", status: "active" },
    ]);

    // report → manager edge (puts REP_EMP in the caller's reports tree)
    await db.insert(atelierRosterReportsTo).values({
      id: EDGE_ID,
      orgId: ORG,
      personId: REP_EMP,
      managerPersonId: MGR_EMP,
    });

    await db.insert(atelierAccounts).values([
      { id: ACC_VIS, orgId: ORG, name: `Visible Account ${TAG}`, country: "Morocco", sector: "Technology", partnerOwnerId: FP_UID },
      { id: ACC_HID, orgId: ORG, name: HIDDEN_ACCOUNT_NAME, country: "Morocco", sector: "Energy", partnerOwnerId: FP_UID },
    ]);

    await db.insert(atelierEngagements).values([
      { id: ENG_VIS, orgId: ORG, slug: `wl-vis-${STAMP}`, name: `Visible Engagement ${TAG}`, accountId: ACC_VIS, plmStage: "deliver", partnerOwnerId: FP_UID, engagementLeadId: MGR_UID, startDate: "2026-01-05", plannedEndDate: "2026-12-18" },
      { id: ENG_HID, orgId: ORG, slug: `wl-hid-${STAMP}`, name: HIDDEN_ENG_NAME, accountId: ACC_HID, plmStage: "deliver", partnerOwnerId: FP_UID, engagementLeadId: FP_UID, startDate: "2026-02-02", plannedEndDate: "2026-11-30" },
    ]);

    // Caller's ONLY visibility: an active staffing grant on ENG_VIS.
    // The report is staffed on BOTH engagements.
    await db.insert(atelierEngagementAccess).values([
      { id: GRANT_MGR_VIS, engagementId: ENG_VIS, userId: MGR_UID, roleOnEngagement: "lead", status: "active" },
      { id: GRANT_REP_VIS, engagementId: ENG_VIS, userId: REP_UID, roleOnEngagement: "member", allocationPct: 60, status: "active" },
      { id: GRANT_REP_HID, engagementId: ENG_HID, userId: REP_UID, roleOnEngagement: "member", allocationPct: 40, status: "active" },
    ]);

    // Report holds account-team roles on BOTH accounts.
    await db.insert(atelierAccountTeamMembers).values([
      { id: TEAM_REP_VIS, orgId: ORG, accountId: ACC_VIS, userId: REP_UID, roleOnAccount: "delivery_lead" },
      { id: TEAM_REP_HID, orgId: ORG, accountId: ACC_HID, userId: REP_UID, roleOnAccount: "delivery_lead" },
    ]);

    // Report leads one open opportunity on each account.
    await db.insert(atelierOpportunities).values([
      { id: OPP_VIS, orgId: ORG, slug: `wl-opp-vis-${STAMP}`, name: `Visible Opportunity ${TAG}`, accountId: ACC_VIS, salesStage: "prospect", partnerOwnerId: FP_UID, engagementLeadId: REP_UID, dealSizeHypothesis: 100000, probabilityPct: 30, nextMilestone: "Proposal review", sourceLead: "referral" },
      { id: OPP_HID, orgId: ORG, slug: `wl-opp-hid-${STAMP}`, name: HIDDEN_OPP_NAME, accountId: ACC_HID, salesStage: "prospect", partnerOwnerId: FP_UID, engagementLeadId: REP_UID, dealSizeHypothesis: 200000, probabilityPct: 40, nextMilestone: "Kickoff", sourceLead: "referral" },
    ]);

    // ------ 1. scoped manager: visible rows only, honest hidden count ----
    group("scoped engagement_lead sees only visible rows for their report");
    const r = await runTool(mgrPersona, { personId: REP_EMP });
    check("mgr: ok", r.ok === true, JSON.stringify(r));
    const d = (r.data ?? {}) as any;
    check("mgr: resolves the report", d.person?.id === REP_EMP);
    check("mgr: linked user", d.linkedUser === true);

    check(
      "mgr: visible account-team role present",
      (d.accountRoles ?? []).some((a: any) => a.accountId === ACC_VIS),
    );
    check(
      "mgr: hidden account-team role excluded",
      !(d.accountRoles ?? []).some((a: any) => a.accountId === ACC_HID),
    );
    check(
      "mgr: visible staffing present with allocation",
      (d.engagementStaffings ?? []).some(
        (s: any) => s.engagementId === ENG_VIS && s.allocationPct === 60,
      ),
    );
    check(
      "mgr: hidden staffing excluded",
      !(d.engagementStaffings ?? []).some((s: any) => s.engagementId === ENG_HID),
    );
    check(
      "mgr: visible opportunity present",
      (d.openOpportunities ?? []).some((o: any) => o.id === OPP_VIS),
    );
    check(
      "mgr: hidden opportunity excluded",
      !(d.openOpportunities ?? []).some((o: any) => o.id === OPP_HID),
    );
    check(
      "mgr: hiddenAccountCount counts unique hidden ACCOUNTS (3 hidden rows, 1 account)",
      d.hiddenAccountCount === 1,
      `got ${d.hiddenAccountCount}`,
    );
    check(
      "mgr: totalAllocationPct sums only visible staffings",
      d.totalAllocationPct === 60,
      `got ${d.totalAllocationPct}`,
    );

    // ------ 2. nothing hidden leaks anywhere in the payload -------------
    group("no hidden name or id anywhere in the serialized result");
    const serialized = JSON.stringify(r);
    for (const [label, needle] of [
      ["hidden account name", HIDDEN_ACCOUNT_NAME],
      ["hidden engagement name", HIDDEN_ENG_NAME],
      ["hidden opportunity name", HIDDEN_OPP_NAME],
      ["hidden account id", ACC_HID],
      ["hidden engagement id", ENG_HID],
      ["hidden opportunity id", OPP_HID],
    ] as const) {
      check(`no ${label} in payload`, !serialized.includes(needle));
    }

    // ------ 3. roster-scope denial outside the reports tree -------------
    group("person outside the caller's reports tree is forbidden");
    const denied = await runTool(mgrPersona, { personId: OUT_EMP });
    check("outside-tree: not ok", denied.ok === false, JSON.stringify(denied));
    check("outside-tree: errorCode forbidden", denied.errorCode === "forbidden", JSON.stringify(denied));
    check(
      "outside-tree: no data leaked",
      !("data" in denied) || denied.data == null,
      JSON.stringify(denied),
    );

    // ------ 4. founding partner baseline: full card, zero hidden --------
    group("founding partner sees everything with hiddenAccountCount 0");
    const fp = await runTool(fpPersona, { personId: REP_EMP });
    check("fp: ok", fp.ok === true, JSON.stringify(fp));
    const fd = (fp.data ?? {}) as any;
    check(
      "fp: both account roles",
      (fd.accountRoles ?? []).length === 2 &&
        [ACC_VIS, ACC_HID].every((id) => (fd.accountRoles ?? []).some((a: any) => a.accountId === id)),
    );
    check(
      "fp: both staffings",
      (fd.engagementStaffings ?? []).length === 2,
      `got ${(fd.engagementStaffings ?? []).length}`,
    );
    check(
      "fp: both open opportunities",
      (fd.openOpportunities ?? []).length === 2,
      `got ${(fd.openOpportunities ?? []).length}`,
    );
    check("fp: hiddenAccountCount 0", fd.hiddenAccountCount === 0, `got ${fd.hiddenAccountCount}`);
    check("fp: total allocation sums both", fd.totalAllocationPct === 100, `got ${fd.totalAllocationPct}`);
  } finally {
    // ---------------- cleanup ----------------------------------------
    try {
      await db.delete(atelierOpportunities).where(inArray(atelierOpportunities.id, [OPP_VIS, OPP_HID]));
      await db.delete(atelierAccountTeamMembers).where(inArray(atelierAccountTeamMembers.id, [TEAM_REP_VIS, TEAM_REP_HID]));
      await db.delete(atelierEngagementAccess).where(inArray(atelierEngagementAccess.id, [GRANT_MGR_VIS, GRANT_REP_VIS, GRANT_REP_HID]));
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [ENG_VIS, ENG_HID]));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [ACC_VIS, ACC_HID]));
      await db.delete(atelierRosterReportsTo).where(inArray(atelierRosterReportsTo.id, [EDGE_ID]));
      await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [MGR_EMP, REP_EMP, OUT_EMP]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP_UID, MGR_UID, REP_UID]));
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    await pool.end().catch(() => {});
  }

  console.log(`\n${failures.length === 0 ? "ALL PASS" : `${failures.length} FAILURES`}`);
  if (failures.length) {
    for (const f of failures) console.error(`  \u2717 ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
