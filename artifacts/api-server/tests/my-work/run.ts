/**
 * Task #940 — "Assigned to me" consolidated roll-up probe.
 *
 * Locks down GET /atelier/my-open-tasks (Home "Assigned to me" card) now
 * that it merges account activity tasks, account plan actions, and
 * engagement RAID items, plus the owner validation added to the RAID
 * write surfaces (REST + chat/CLI tools).
 *
 * Runs standalone (tsx ./tests/my-work/run.ts) booting the app in-process
 * via app.listen(0); NODE_ENV=test enables the persona-cookie bypass.
 * All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. Combined endpoint returns only MY open items across all three
 *      kinds, each with kind, parent context, dueDate, overdue, href.
 *   2. Done/closed/deleted items and items owned by someone else are
 *      excluded; rows in another org are excluded (org scoping).
 *   3. Ordering: overdue items first, then by dueDate ascending.
 *   4. Counts: openCount / overdueCount match the item list.
 *   5. Owner validation: REST RAID create with unknown owner → 400
 *      invalid-owner; valid owner → 201. CLI raid_add capability and
 *      legacy add_raid_item tool reject unknown owners with
 *      errorCode invalid_owner and persist nothing.
 */

process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const ME_ID = `p_test_mw_me_${STAMP}`;
const OTHER_ID = `p_test_mw_other_${STAMP}`;
const ACCT = `__probe940_acct_${STAMP}`;
const ENG = `__probe940_eng_${STAMP}`;
const ACT_OVERDUE = `__probe940_act_over_${STAMP}`;
const ACT_FUTURE = `__probe940_act_fut_${STAMP}`;
const ACT_DONE = `__probe940_act_done_${STAMP}`;
const ACT_OTHER = `__probe940_act_other_${STAMP}`;
const AXN_OPEN = `__probe940_axn_open_${STAMP}`;
const AXN_PROG = `__probe940_axn_prog_${STAMP}`;
const AXN_DONE = `__probe940_axn_done_${STAMP}`;
const AXN_OTHERORG = `__probe940_axn_oorg_${STAMP}`;
const RAID_OPEN = `__probe940_raid_open_${STAMP}`;
const RAID_CLOSED = `__probe940_raid_closed_${STAMP}`;
const RAID_OTHER = `__probe940_raid_other_${STAMP}`;

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
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
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
    atelierActivities,
    atelierAccountActions,
    atelierRaidItems,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function req(
    method: string,
    path: string,
    personaId?: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(personaId ? { cookie: `atelier_persona=${personaId}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const createdRaidIds: string[] = [];
  try {
    // ---- fixtures ----
    for (const p of [
      { id: ME_ID, role: "founding_partner", roleLabel: "Founding Partner", name: "MW Me" },
      { id: OTHER_ID, role: "partner", roleLabel: "Partner", name: "MW Other" },
    ]) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "MW",
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
      name: `Probe940 Legal ${STAMP}`,
      brandName: `Probe940 Brand ${STAMP}`,
      country: "France",
      sector: "Probe",
      partnerOwnerId: ME_ID,
      createdByUserId: ME_ID,
    } as any);
    await db.insert(atelierEngagements).values({
      id: ENG,
      orgId: ORG,
      slug: `probe940-eng-${STAMP}`,
      accountId: ACCT,
      name: `Probe940 Engagement ${STAMP}`,
      plmStage: "mobilize",
      startDate: isoDaysFromNow(-30),
      plannedEndDate: isoDaysFromNow(60),
      charter: "Probe940 charter",
      partnerOwnerId: ME_ID,
      engagementLeadId: ME_ID,
      createdByUserId: ME_ID,
    } as any);
    await db.insert(atelierActivities).values([
      { id: ACT_OVERDUE, orgId: ORG, accountId: ACCT, parentType: "account", parentId: ACCT, type: "task", title: "Overdue activity", ownerId: ME_ID, status: "open", dueDate: isoDaysFromNow(-3), createdByUserId: ME_ID },
      { id: ACT_FUTURE, orgId: ORG, accountId: ACCT, parentType: "account", parentId: ACCT, type: "call", title: "Future activity", ownerId: ME_ID, status: "open", dueDate: isoDaysFromNow(5), createdByUserId: ME_ID },
      { id: ACT_DONE, orgId: ORG, accountId: ACCT, parentType: "account", parentId: ACCT, type: "task", title: "Done activity", ownerId: ME_ID, status: "done", dueDate: isoDaysFromNow(-1), createdByUserId: ME_ID },
      { id: ACT_OTHER, orgId: ORG, accountId: ACCT, parentType: "account", parentId: ACCT, type: "task", title: "Someone else's activity", ownerId: OTHER_ID, status: "open", dueDate: isoDaysFromNow(-1), createdByUserId: ME_ID },
    ] as any);
    await db.insert(atelierAccountActions).values([
      { id: AXN_OPEN, orgId: ORG, accountId: ACCT, title: "Open plan action", ownerId: ME_ID, status: "open", priority: "high", dueDate: isoDaysFromNow(-2), createdByUserId: ME_ID },
      { id: AXN_PROG, orgId: ORG, accountId: ACCT, title: "In-progress plan action", ownerId: ME_ID, status: "in_progress", priority: "medium", dueDate: isoDaysFromNow(10), createdByUserId: ME_ID },
      { id: AXN_DONE, orgId: ORG, accountId: ACCT, title: "Done plan action", ownerId: ME_ID, status: "done", priority: "low", createdByUserId: ME_ID },
      { id: AXN_OTHERORG, orgId: "otherorg", accountId: ACCT, title: "Other-org plan action", ownerId: ME_ID, status: "open", priority: "low", createdByUserId: ME_ID },
    ] as any);
    await db.insert(atelierRaidItems).values([
      { id: RAID_OPEN, orgId: ORG, engagementId: ENG, kind: "risk", severity: "red", status: "open", ownerId: ME_ID, dueDate: isoDaysFromNow(-1), description: "Open RAID risk", createdByUserId: ME_ID },
      { id: RAID_CLOSED, orgId: ORG, engagementId: ENG, kind: "issue", severity: "amber", status: "closed", ownerId: ME_ID, dueDate: isoDaysFromNow(-1), description: "Closed RAID issue", createdByUserId: ME_ID },
      { id: RAID_OTHER, orgId: ORG, engagementId: ENG, kind: "dependency", severity: "green", status: "open", ownerId: OTHER_ID, description: "Other's RAID", createdByUserId: ME_ID },
    ] as any);

    // ---- 1-4. combined endpoint ----
    group("GET /my-open-tasks — consolidated assigned-to-me");
    const r = await req("GET", "/my-open-tasks", ME_ID);
    check("200", r.status === 200, r);
    const items: any[] = (r.body?.items ?? []).filter((i: any) =>
      String(i.id).includes(`_${STAMP}`) || String(i.title ?? "").includes("Probe940") ||
      [ACT_OVERDUE, ACT_FUTURE, AXN_OPEN, AXN_PROG, RAID_OPEN].includes(i.id),
    );
    const ids = items.map((i) => i.id);
    check("includes overdue activity", ids.includes(ACT_OVERDUE));
    check("includes future activity", ids.includes(ACT_FUTURE));
    check("includes open plan action", ids.includes(AXN_OPEN));
    check("includes in-progress plan action", ids.includes(AXN_PROG));
    check("includes open RAID item", ids.includes(RAID_OPEN));
    check("excludes done activity", !ids.includes(ACT_DONE));
    check("excludes other's activity", !ids.includes(ACT_OTHER));
    check("excludes done plan action", !ids.includes(AXN_DONE));
    check("excludes other-org plan action (org-scoped)", !ids.includes(AXN_OTHERORG));
    check("excludes closed RAID item", !ids.includes(RAID_CLOSED));
    check("excludes other's RAID item", !ids.includes(RAID_OTHER));

    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    check("activity item kind/href", byId[ACT_OVERDUE]?.kind === "activity" && byId[ACT_OVERDUE]?.href === `/accounts/${ACCT}`, byId[ACT_OVERDUE]);
    check("activity overdue flagged", byId[ACT_OVERDUE]?.overdue === true && byId[ACT_FUTURE]?.overdue === false);
    check("plan action kind/href", byId[AXN_OPEN]?.kind === "plan_action" && byId[AXN_OPEN]?.href === `/accounts/${ACCT}?tab=account_plan`);
    check("plan action overdue flagged", byId[AXN_OPEN]?.overdue === true && byId[AXN_PROG]?.overdue === false);
    check("raid kind/type/href", byId[RAID_OPEN]?.kind === "raid" && byId[RAID_OPEN]?.type === "risk" && byId[RAID_OPEN]?.href === `/engagements/${ENG}`);
    check("raid parent context", byId[RAID_OPEN]?.engagementName?.includes("Probe940") && byId[RAID_OPEN]?.accountId === ACCT, byId[RAID_OPEN]);
    check("account name resolved (brandName)", byId[ACT_OVERDUE]?.accountName === `Probe940 Brand ${STAMP}`);

    // Ordering: all overdue probe items must appear before non-overdue ones,
    // and overdue segment sorted by dueDate ascending.
    const probeOrder = (r.body?.items ?? []).filter((i: any) => ids.includes(i.id));
    const firstNotOverdue = probeOrder.findIndex((i: any) => !i.overdue);
    const lastOverdue = probeOrder.map((i: any) => i.overdue).lastIndexOf(true);
    check("overdue-first ordering", firstNotOverdue === -1 || lastOverdue < firstNotOverdue, probeOrder.map((i: any) => ({ id: i.id, overdue: i.overdue, dueDate: i.dueDate })));
    const overdueDates = probeOrder.filter((i: any) => i.overdue).map((i: any) => i.dueDate ?? "");
    check("overdue segment dueDate ascending", overdueDates.every((d: string, idx: number) => idx === 0 || overdueDates[idx - 1] <= d), overdueDates);

    // Counts (endpoint-global; probe rows are a subset).
    const all = r.body?.items ?? [];
    check("openCount matches items", r.body?.openCount === all.length);
    check("overdueCount matches items", r.body?.overdueCount === all.filter((i: any) => i.overdue).length);
    check("unauthenticated → 401", (await req("GET", "/my-open-tasks")).status === 401);

    // ---- 5. owner validation ----
    group("Owner validation — REST RAID create");
    const bad = await req("POST", `/engagements/${ENG}/raid`, ME_ID, {
      kind: "risk", severity: "amber", description: "bad owner", ownerUserId: "u_does_not_exist",
    });
    check("unknown owner → 400 invalid-owner", bad.status === 400 && bad.body?.error === "invalid-owner", bad);
    const good = await req("POST", `/engagements/${ENG}/raid`, ME_ID, {
      kind: "risk", severity: "amber", description: "good owner", ownerUserId: OTHER_ID,
    });
    check("valid owner → 201", good.status === 201, good);
    if (good.body?.id) createdRaidIds.push(good.body.id);

    group("Owner validation — CLI tools");
    await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
    const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");
    const cli = await import("../../src/lib/atelier-cli/index.js");
    const [meRow] = await db.select().from(atelierUsers).where(inArray(atelierUsers.id, [ME_ID]));
    const ctx = { persona: meRow } as any;

    const raidAdd = findByToolName("raid_add");
    check("raid_add capability found", !!raidAdd);
    if (raidAdd) {
      const res1 = await raidAdd.run(
        { confirm: true, engagementId: ENG, kind: "risk", description: "cli bad owner", ownerId: "u_does_not_exist" } as any,
        ctx,
      );
      check("raid_add unknown owner rejected", res1?.ok === false && (res1 as any)?.errorCode === "invalid_owner", res1);
      const res2 = await raidAdd.run(
        { confirm: true, engagementId: ENG, kind: "risk", description: "cli good owner", ownerId: OTHER_ID } as any,
        ctx,
      );
      check("raid_add valid owner ok", res2?.ok === true, res2);
      if ((res2 as any)?.data?.id) createdRaidIds.push((res2 as any).data.id);
    }

    const legacy = (cli as any).TOOL_REGISTRY?.["add_raid_item"];
    check("legacy add_raid_item found", !!legacy);
    if (legacy) {
      const res3 = await legacy.run(
        { confirm: true, engagementId: ENG, kind: "issue", severity: "amber", description: "legacy bad owner", ownerUserId: "u_does_not_exist" },
        ctx,
      );
      check("add_raid_item unknown owner rejected", res3?.ok === false && res3?.errorCode === "invalid_owner", res3);
      const res4 = await legacy.run(
        { confirm: true, engagementId: ENG, kind: "issue", severity: "amber", description: "legacy good owner", ownerUserId: OTHER_ID },
        ctx,
      );
      check("add_raid_item valid owner ok", res4?.ok === true, res4);
      if (res4?.data?.id) createdRaidIds.push(res4.data.id);
    }
    // Nothing persisted for the rejected writes.
    const { sql } = await import("drizzle-orm");
    const orphanRows = await db
      .select({ id: atelierRaidItems.id })
      .from(atelierRaidItems)
      .where(sql`${atelierRaidItems.ownerId} = 'u_does_not_exist'`);
    check("no RAID rows persisted with unknown owner", orphanRows.length === 0, orphanRows);
  } finally {
    try {
      await db.delete(atelierRaidItems).where(inArray(atelierRaidItems.id, [RAID_OPEN, RAID_CLOSED, RAID_OTHER, ...createdRaidIds]));
      await db.delete(atelierAccountActions).where(inArray(atelierAccountActions.id, [AXN_OPEN, AXN_PROG, AXN_DONE, AXN_OTHERORG]));
      await db.delete(atelierActivities).where(inArray(atelierActivities.id, [ACT_OVERDUE, ACT_FUTURE, ACT_DONE, ACT_OTHER]));
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [ENG]));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [ACCT]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [ME_ID, OTHER_ID]));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length) {
    console.error(`\n\u2717 ${failures.length} failure(s):`, failures);
    process.exit(1);
  }
  console.log("\n\u2713 my-work probe passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
