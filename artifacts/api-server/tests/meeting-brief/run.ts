/**
 * Task #347 — Pre-meeting brief regression probe.
 *
 * Locks down GET /atelier/accounts/:accountId/meeting-brief (Task #337,
 * surfaced from the Home "My meetings" card) so its contents keep matching
 * the account page as the timeline / opportunity code evolves.
 *
 * Runs standalone (tsx ./tests/meeting-brief/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass. All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. Shape: accountId / accountName (brandName wins) / generatedAt.
 *   2. openOpportunities: open stages included; terminal stages
 *      (contract/lost/no_decision/withdrawn) and soft-deleted opps excluded.
 *   3. openTasks: open activity included with overdue=true for a past
 *      dueDate; done activities excluded; future-due task not overdue.
 *   4. openActions: open/in_progress account-plan actions included with
 *      resolved ownerName + overdue flag; done actions excluded.
 *   5. recentActivity: timeline folds in the activity rows.
 *   6. ACL: consultant without an engagement grant → 403 account-forbidden;
 *      consultant WITH an active grant on the account's engagement → 200.
 *   7. Unknown account → 404; unauthenticated → 401.
 */

process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_mbfp_${STAMP}`;
const CON_ID = `p_test_mbcon_${STAMP}`;
const ACCT = `__probe347_acct_${STAMP}`;
const ENG = `__probe347_eng_${STAMP}`;
const GRANT = `__probe347_grant_${STAMP}`;
const OPP_OPEN = `__probe347_opp_open_${STAMP}`;
const OPP_WON = `__probe347_opp_won_${STAMP}`;
const OPP_DEL = `__probe347_opp_del_${STAMP}`;
const ACT_OVERDUE = `__probe347_act_over_${STAMP}`;
const ACT_FUTURE = `__probe347_act_fut_${STAMP}`;
const ACT_DONE = `__probe347_act_done_${STAMP}`;
const AXN_OPEN = `__probe347_axn_open_${STAMP}`;
const AXN_DONE = `__probe347_axn_done_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
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
    atelierOpportunities,
    atelierActivities,
    atelierAccountActions,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function get(
    path: string,
    personaId?: string,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      headers: personaId ? { cookie: `atelier_persona=${personaId}` } : {},
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  try {
    // ---- fixtures ----
    for (const p of [
      { id: FP_ID, role: "founding_partner", roleLabel: "Founding Partner", name: "MB Founding Partner" },
      { id: CON_ID, role: "consultant", roleLabel: "Consultant", name: "MB Consultant" },
    ]) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "MB",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    await db.insert(atelierAccounts).values({
      id: ACCT,
      orgId: ORG,
      name: `Probe347 Legal Name ${STAMP}`,
      brandName: `Probe347 Brand ${STAMP}`,
      country: "France",
      sector: "Probe",
      partnerOwnerId: FP_ID,
      createdByUserId: FP_ID,
    } as any);
    await db.insert(atelierEngagements).values({
      id: ENG,
      orgId: ORG,
      slug: `probe347-eng-${STAMP}`,
      accountId: ACCT,
      name: `Probe347 Engagement ${STAMP}`,
      plmStage: "mobilize",
      startDate: isoDaysFromNow(-30),
      plannedEndDate: isoDaysFromNow(60),
      charter: "Probe347 charter",
      partnerOwnerId: FP_ID,
      engagementLeadId: FP_ID,
      createdByUserId: FP_ID,
    } as any);
    await db.insert(atelierOpportunities).values([
      {
        id: OPP_OPEN,
        orgId: ORG,
        slug: `probe347-open-${STAMP}`,
        name: "Probe347 Open Deal",
        accountId: ACCT,
        salesStage: "identify",
        partnerOwnerId: FP_ID,
        engagementLeadId: FP_ID,
        dealSizeHypothesis: 250000,
        probabilityPct: 40,
        nextMilestone: "probe",
        sourceLead: "manual",
        createdByUserId: FP_ID,
      },
      {
        id: OPP_WON,
        orgId: ORG,
        slug: `probe347-won-${STAMP}`,
        name: "Probe347 Won Deal",
        accountId: ACCT,
        salesStage: "contract",
        partnerOwnerId: FP_ID,
        engagementLeadId: FP_ID,
        dealSizeHypothesis: 500000,
        probabilityPct: 100,
        nextMilestone: "probe",
        sourceLead: "manual",
        createdByUserId: FP_ID,
      },
      {
        id: OPP_DEL,
        orgId: ORG,
        slug: `probe347-del-${STAMP}`,
        name: "Probe347 Deleted Deal",
        accountId: ACCT,
        salesStage: "identify",
        partnerOwnerId: FP_ID,
        engagementLeadId: FP_ID,
        dealSizeHypothesis: 100000,
        probabilityPct: 10,
        nextMilestone: "probe",
        sourceLead: "manual",
        createdByUserId: FP_ID,
        deletedAt: new Date(),
      },
    ] as any);
    await db.insert(atelierActivities).values([
      {
        id: ACT_OVERDUE,
        orgId: ORG,
        accountId: ACCT,
        parentType: "account",
        parentId: ACCT,
        type: "task",
        title: "Probe347 overdue task",
        ownerId: FP_ID,
        dueDate: isoDaysFromNow(-3),
        status: "open",
        createdByUserId: FP_ID,
      },
      {
        id: ACT_FUTURE,
        orgId: ORG,
        accountId: ACCT,
        parentType: "account",
        parentId: ACCT,
        type: "task",
        title: "Probe347 future task",
        ownerId: FP_ID,
        dueDate: isoDaysFromNow(14),
        status: "open",
        createdByUserId: FP_ID,
      },
      {
        id: ACT_DONE,
        orgId: ORG,
        accountId: ACCT,
        parentType: "account",
        parentId: ACCT,
        type: "task",
        title: "Probe347 done task",
        ownerId: FP_ID,
        dueDate: isoDaysFromNow(-10),
        status: "done",
        completedAt: new Date(),
        createdByUserId: FP_ID,
      },
    ] as any);
    await db.insert(atelierAccountActions).values([
      {
        id: AXN_OPEN,
        orgId: ORG,
        accountId: ACCT,
        title: "Probe347 open action",
        ownerId: FP_ID,
        status: "open",
        priority: "high",
        dueDate: isoDaysFromNow(-1),
        createdByUserId: FP_ID,
      },
      {
        id: AXN_DONE,
        orgId: ORG,
        accountId: ACCT,
        title: "Probe347 done action",
        ownerId: FP_ID,
        status: "done",
        priority: "low",
        completedAt: new Date(),
        createdByUserId: FP_ID,
      },
    ] as any);

    // =====================================================================
    group("brief shape + contents (founding partner)");
    // =====================================================================
    const brief = await get(`/accounts/${ACCT}/meeting-brief`, FP_ID);
    check("meeting-brief \u2192 200", brief.status === 200, brief.status);
    const b = brief.body ?? {};
    check("accountId echoed", b.accountId === ACCT, b.accountId);
    check(
      "accountName uses brandName",
      b.accountName === `Probe347 Brand ${STAMP}`,
      b.accountName,
    );
    check(
      "generatedAt is a fresh ISO timestamp",
      typeof b.generatedAt === "string" &&
        Math.abs(Date.now() - Date.parse(b.generatedAt)) < 60_000,
      b.generatedAt,
    );

    // ---- open vs terminal vs deleted opportunities ----
    const oppIds = new Set((b.openOpportunities ?? []).map((o: any) => o.id));
    check("open opportunity included", oppIds.has(OPP_OPEN), [...oppIds]);
    check("terminal (contract) opportunity excluded", !oppIds.has(OPP_WON));
    check("soft-deleted opportunity excluded", !oppIds.has(OPP_DEL));
    const openOpp = (b.openOpportunities ?? []).find((o: any) => o.id === OPP_OPEN);
    check(
      "open opportunity carries stage + size + probability",
      openOpp?.salesStage === "identify" &&
        Number(openOpp?.dealSizeHypothesis) === 250000 &&
        Number(openOpp?.probabilityPct) === 40,
      openOpp,
    );

    // ---- open tasks with overdue flag ----
    const tasks = b.openTasks ?? [];
    const overdueTask = tasks.find((t: any) => t.id === ACT_OVERDUE);
    const futureTask = tasks.find((t: any) => t.id === ACT_FUTURE);
    check("overdue open task included + flagged", overdueTask?.overdue === true, overdueTask);
    check("future-due open task included, not overdue", futureTask?.overdue === false, futureTask);
    check(
      "done task excluded from openTasks",
      !tasks.some((t: any) => t.id === ACT_DONE),
    );
    check(
      "overdue task sorted before future task",
      tasks.findIndex((t: any) => t.id === ACT_OVERDUE) <
        tasks.findIndex((t: any) => t.id === ACT_FUTURE),
      tasks.map((t: any) => t.id),
    );

    // ---- account-plan actions with resolved owner names ----
    const actions = b.openActions ?? [];
    const openAction = actions.find((a: any) => a.id === AXN_OPEN);
    check("open account action included", !!openAction, actions.map((a: any) => a.id));
    check(
      "action owner name resolved",
      openAction?.ownerName === "MB Founding Partner",
      openAction?.ownerName,
    );
    check("action overdue flag set for past due date", openAction?.overdue === true, openAction);
    check(
      "action carries priority + dueDate",
      openAction?.priority === "high" && openAction?.dueDate === isoDaysFromNow(-1),
      openAction,
    );
    check(
      "done action excluded from openActions",
      !actions.some((a: any) => a.id === AXN_DONE),
    );

    // ---- recent activity timeline folds in the activity rows ----
    const recentIds = new Set((b.recentActivity ?? []).map((e: any) => e.refId));
    check(
      "recentActivity includes the logged tasks",
      recentIds.has(ACT_OVERDUE) && recentIds.has(ACT_FUTURE),
      [...recentIds],
    );
    check(
      "recentActivity capped at 8 entries",
      (b.recentActivity ?? []).length <= 8,
      (b.recentActivity ?? []).length,
    );

    // =====================================================================
    group("ACL + not-found behaviour");
    // =====================================================================
    const noGrant = await get(`/accounts/${ACCT}/meeting-brief`, CON_ID);
    check(
      "consultant without grant \u2192 403 account-forbidden",
      noGrant.status === 403 && noGrant.body?.error === "account-forbidden",
      `${noGrant.status} ${noGrant.body?.error}`,
    );

    await db.insert(atelierEngagementAccess).values({
      id: GRANT,
      orgId: ORG,
      engagementId: ENG,
      userId: CON_ID,
      status: "active",
      grantedByUserId: FP_ID,
    } as any);
    const withGrant = await get(`/accounts/${ACCT}/meeting-brief`, CON_ID);
    check(
      "consultant with active engagement grant \u2192 200",
      withGrant.status === 200 && withGrant.body?.accountId === ACCT,
      withGrant.status,
    );

    const missing = await get(`/accounts/__probe347_nope_${STAMP}/meeting-brief`, FP_ID);
    check(
      "unknown account \u2192 404 not-found",
      missing.status === 404 && missing.body?.error === "not-found",
      `${missing.status} ${missing.body?.error}`,
    );

    const anon = await get(`/accounts/${ACCT}/meeting-brief`);
    check("unauthenticated \u2192 401", anon.status === 401, anon.status);
  } finally {
    try {
      await db.delete(atelierEngagementAccess).where(inArray(atelierEngagementAccess.id, [GRANT]));
      await db.delete(atelierAccountActions).where(inArray(atelierAccountActions.id, [AXN_OPEN, AXN_DONE]));
      await db.delete(atelierActivities).where(inArray(atelierActivities.id, [ACT_OVERDUE, ACT_FUTURE, ACT_DONE]));
      await db.delete(atelierOpportunities).where(inArray(atelierOpportunities.id, [OPP_OPEN, OPP_WON, OPP_DEL]));
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [ENG]));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [ACCT]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP_ID, CON_ID]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 meeting-brief probe passed"
      : `\n\u2717 ${failures.length} failure(s): ${failures.join("; ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
