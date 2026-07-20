/**
 * Task #442 — deterministic ACL regression test for the compound
 * `account.who_works` capability (tool `account_team_and_pipeline`).
 *
 * The tool composes team + open opportunities + active engagements +
 * recent meetings for ONE account in a single answer. This suite pins
 * the access contract so a future ACL or schema change can't silently
 * widen what a scoped consultant or ungranted persona sees:
 *
 *   1. founding partner gets the full card: all four blocks populated.
 *   2. a consultant whose ONLY access is an engagement staffing grant
 *      on the account still gets the card (grant ⇒ canSeeAccount).
 *   3. a persona with no grants gets ok:false errorCode "forbidden".
 *   4. the team projection never serializes compensation / bank / HR
 *      fields (checked against CHAT_PERSON_FORBIDDEN_FIELDS).
 *
 * Runs standalone against the isolated scratch database (never the
 * live DB); ephemeral personas + rows are deleted in `finally`.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import { inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const TAG = `__t442_${STAMP}`;

const FP_UID = `p_test_wwfp_${STAMP}`;
const GRANTED_UID = `p_test_wwgrant_${STAMP}`;
const OUTSIDER_UID = `p_test_wwout_${STAMP}`;
const TEAM_UID = `p_test_wwteam_${STAMP}`;

const ACC_ID = `acc_${TAG}`;
const ENG_ID = `eng_${TAG}`;
const OPP_ID = `opp_${TAG}`;
const TEAM_ROW_ID = `atm_${TAG}`;
const GRANT_ID = `ega_${TAG}`;
const MTG_ID = `mtg_${TAG}`;

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
    atelierEngagements,
    atelierEngagementAccess,
    atelierAccountTeamMembers,
    atelierOpportunities,
    atelierMeetings,
  } = D as any;

  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { findByToolName } = catalog;
  const { CHAT_PERSON_FORBIDDEN_FIELDS } = await import(
    "../../src/lib/atelier-cli/people-read-capabilities.js"
  );

  const fpPersona = { id: FP_UID, name: "WW FP", role: "founding_partner", orgId: ORG };
  const grantedPersona = { id: GRANTED_UID, name: "WW Granted", role: "consultant", orgId: ORG };
  const outsiderPersona = { id: OUTSIDER_UID, name: "WW Outsider", role: "consultant", orgId: ORG };

  const runTool = async (
    persona: { id: string; name: string; role: string; orgId: string },
    input: Record<string, unknown> = {},
  ) => {
    const entry = findByToolName("account_team_and_pipeline");
    if (!entry) throw new Error("tool account_team_and_pipeline not registered");
    return entry.run(input, { persona } as any);
  };

  try {
    // ---------------- seed -------------------------------------------
    await db.insert(atelierUsers).values([
      { id: FP_UID, orgId: ORG, email: `wwfp${STAMP}@test.local`, name: `WW FP ${TAG}`, initials: "WF", role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
      { id: GRANTED_UID, orgId: ORG, email: `wwgrant${STAMP}@test.local`, name: `WW Granted ${TAG}`, initials: "WG", role: "consultant", roleLabel: "Consultant", title: "Consultant" },
      { id: OUTSIDER_UID, orgId: ORG, email: `wwout${STAMP}@test.local`, name: `WW Outsider ${TAG}`, initials: "WO", role: "consultant", roleLabel: "Consultant", title: "Consultant" },
      { id: TEAM_UID, orgId: ORG, email: `wwteam${STAMP}@test.local`, name: `WW Team ${TAG}`, initials: "WT", role: "consultant", roleLabel: "Consultant", title: "Engagement Manager" },
    ]);

    await db.insert(atelierAccounts).values({
      id: ACC_ID,
      orgId: ORG,
      name: `WhoWorks Test Account ${TAG}`,
      country: "Morocco",
      sector: "Technology",
      partnerOwnerId: FP_UID,
    });

    await db.insert(atelierEngagements).values({
      id: ENG_ID,
      orgId: ORG,
      slug: `ww-eng-${STAMP}`,
      name: `WhoWorks Engagement ${TAG}`,
      accountId: ACC_ID,
      plmStage: "deliver",
      partnerOwnerId: FP_UID,
      engagementLeadId: TEAM_UID,
      startDate: "2026-01-05",
      plannedEndDate: "2026-12-18",
    });

    await db.insert(atelierOpportunities).values({
      id: OPP_ID,
      orgId: ORG,
      slug: `ww-opp-${STAMP}`,
      name: `WhoWorks Opportunity ${TAG}`,
      accountId: ACC_ID,
      salesStage: "prospect",
      partnerOwnerId: FP_UID,
      engagementLeadId: TEAM_UID,
      dealSizeHypothesis: 250000,
      probabilityPct: 40,
      nextMilestone: "Proposal review",
      sourceLead: "referral",
    });

    await db.insert(atelierAccountTeamMembers).values({
      id: TEAM_ROW_ID,
      orgId: ORG,
      accountId: ACC_ID,
      userId: TEAM_UID,
      roleOnAccount: "delivery_lead",
    });

    await db.insert(atelierEngagementAccess).values({
      id: GRANT_ID,
      engagementId: ENG_ID,
      userId: GRANTED_UID,
      roleOnEngagement: "member",
      status: "active",
    });

    await db.insert(atelierMeetings).values({
      id: MTG_ID,
      orgId: ORG,
      parentType: "engagement",
      parentId: ENG_ID,
      kind: "steering",
      title: `WhoWorks Steering ${TAG}`,
      date: "2026-07-01",
    });

    // ---------------- 1. founding partner: full card ------------------
    group("founding partner sees all four blocks");
    const fp = await runTool(fpPersona, { accountId: ACC_ID });
    check("fp: ok", fp.ok === true, JSON.stringify(fp));
    const d = (fp.data ?? {}) as any;
    check("fp: account block", d.account?.id === ACC_ID);
    check("fp: team includes partner owner", (d.team ?? []).some((t: any) => t.id === FP_UID && t.accountRoles?.includes("partner_owner")));
    check("fp: team includes account team member", (d.team ?? []).some((t: any) => t.id === TEAM_UID && t.accountRoles?.includes("delivery_lead")));
    check(
      "fp: team includes engagement-staffed consultant",
      (d.team ?? []).some((t: any) => t.id === GRANTED_UID && (t.staffedOn ?? []).some((s: any) => s.engagementId === ENG_ID)),
    );
    check("fp: one open opportunity", d.openOpportunityCount === 1 && d.openOpportunities?.[0]?.id === OPP_ID);
    check("fp: opportunity stage surfaced", d.openOpportunities?.[0]?.stage === "prospect");
    check("fp: one active engagement", d.activeEngagementCount === 1 && d.activeEngagements?.[0]?.id === ENG_ID);
    check("fp: recent meeting present", (d.recentMeetings ?? []).some((m: any) => m.id === MTG_ID));

    // ---------------- 2. granted consultant: scoped card --------------
    group("consultant with only an engagement grant gets the card");
    const gr = await runTool(grantedPersona, { accountId: ACC_ID });
    check("granted: ok", gr.ok === true, JSON.stringify(gr));
    const gd = (gr.data ?? {}) as any;
    check("granted: account block", gd.account?.id === ACC_ID);
    check("granted: team visible", Array.isArray(gd.team) && gd.team.length >= 1);
    check("granted: engagement visible", (gd.activeEngagements ?? []).some((e: any) => e.id === ENG_ID));
    check(
      "granted: meeting on granted engagement visible",
      (gd.recentMeetings ?? []).some((m: any) => m.id === MTG_ID),
    );

    // ---------------- 3. ungranted persona: forbidden -----------------
    group("persona with no grants is forbidden");
    const out = await runTool(outsiderPersona, { accountId: ACC_ID });
    check("outsider: not ok", out.ok === false, JSON.stringify(out));
    check("outsider: errorCode forbidden", out.errorCode === "forbidden", JSON.stringify(out));
    check(
      "outsider: no data leaked",
      !("data" in out) || out.data == null,
      JSON.stringify(out),
    );

    // ---------------- 4. projection never leaks HR fields -------------
    group("team projection excludes compensation/bank/HR fields");
    const serialized = JSON.stringify(fp.data);
    for (const f of CHAT_PERSON_FORBIDDEN_FIELDS) {
      check(`no "${f}" key in card`, !serialized.includes(`"${f}":`));
    }
    // Belt and braces on the per-member shape: only the whitelisted keys.
    const allowedTeamKeys = new Set(["id", "name", "title", "roleLabel", "accountRoles", "staffedOn"]);
    for (const member of d.team ?? []) {
      const extra = Object.keys(member).filter((k) => !allowedTeamKeys.has(k));
      check(`team member ${member.id} has no extra keys`, extra.length === 0, extra.join(","));
    }
  } finally {
    // ---------------- cleanup ----------------------------------------
    try {
      await db.delete(atelierMeetings).where(inArray(atelierMeetings.id, [MTG_ID]));
      await db.delete(atelierEngagementAccess).where(inArray(atelierEngagementAccess.id, [GRANT_ID]));
      await db.delete(atelierAccountTeamMembers).where(inArray(atelierAccountTeamMembers.id, [TEAM_ROW_ID]));
      await db.delete(atelierOpportunities).where(inArray(atelierOpportunities.id, [OPP_ID]));
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [ENG_ID]));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [ACC_ID]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP_UID, GRANTED_UID, OUTSIDER_UID, TEAM_UID]));
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
