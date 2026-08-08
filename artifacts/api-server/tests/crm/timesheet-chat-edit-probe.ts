/**
 * Task #802 — fix or remove a logged time entry from chat by describing it.
 *
 * Pins, at capability level on a scratch DB:
 *   1. update_my_time resolves the entry server-side from date +
 *      engagement/client name; two-phase confirm; commit changes hours
 *      and recomputes week totals.
 *   2. Several matching entries (same date/hours) → ranked
 *      disambiguation on entryId, navigateTo:null.
 *   3. Zero matches after narrowing → friendly copy naming that day's
 *      actual entries; empty day → honest entry_not_found copy.
 *   4. Entries in submitted/approved weeks never resolve (draft/rejected
 *      weeks only); self-scope: another person's entries never appear.
 *   5. remove_my_time is two-phase; commit soft-deletes and recomputes
 *      week totals.
 *   6. coverage timesheet_entry_update accepts the same description
 *      (id now optional) and updates via the shared resolver.
 *
 * Fixtures compute weeks via isoWeekOf — no hardcoded week labels.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/timesheet-chat-edit-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe802_${Date.now()}`;
const ORG = "aico";

async function main() {
  const D = (await import("@workspace/db")) as any;
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierAccounts,
    atelierEngagements,
    atelierTimesheetWeeks,
    atelierTimesheetEntries,
  } = D;
  const { eq, inArray } = await import("drizzle-orm");
  const { isoWeekOf } = await import("../../src/routes/atelier/ledgerRoutes.js");
  await import("../../src/lib/atelier-cli/me-write-capabilities.js");
  await import("../../src/lib/atelier-cli/coverage-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");

  const IDS = {
    me: `u_${TAG}_me`,
    emp: `pe_${TAG}_me`,
    empOther: `pe_${TAG}_other`,
    acct1: `acc_${TAG}_tasama`,
    acct2: `acc_${TAG}_tadawul`,
    eng1: `eng_${TAG}_tasama`,
    eng2: `eng_${TAG}_ta2`,
    eng3: `eng_${TAG}_ta3`,
    wDraft: `tsw_${TAG}_draft`,
    wLocked: `tsw_${TAG}_locked`,
    wOther: `tsw_${TAG}_other`,
    e1: `tse_${TAG}_e1`,
    e2: `tse_${TAG}_e2`,
    e3: `tse_${TAG}_e3`,
    eLocked: `tse_${TAG}_locked`,
    eOther: `tse_${TAG}_other`,
  };
  const ctx = { persona: { id: IDS.me, orgId: ORG, role: "founding_partner", name: "Probe Me" } } as any;

  // dayA lives in a PAST draft week (3 weeks ago); dayB in an APPROVED week (5 weeks ago).
  const pastA = new Date(Date.now() - 21 * 86400000);
  const { weekIso: wAIso, weekStart: wAStart } = isoWeekOf(pastA);
  const dayA = new Date(wAStart.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const emptyDay = new Date(wAStart.getTime() + 3 * 86400000).toISOString().slice(0, 10);
  const pastB = new Date(Date.now() - 35 * 86400000);
  const { weekIso: wBIso, weekStart: wBStart } = isoWeekOf(pastB);
  const dayB = new Date(wBStart.getTime() + 1 * 86400000).toISOString().slice(0, 10);

  try {
    await db
      .insert(atelierUsers)
      .values([
        {
          id: IDS.me,
          orgId: ORG,
          email: `${TAG}.me@cognirise.ai`,
          name: "Probe Me",
          initials: "PM",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: ["*"],
        },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierEmployees)
      .values([
        { id: IDS.emp, orgId: ORG, userId: IDS.me, fullName: "Probe Me", email: `${TAG}.me@cognirise.ai`, role: "Partner", status: "active" },
        { id: IDS.empOther, orgId: ORG, userId: null, fullName: "Probe Other", email: `${TAG}.other@cognirise.ai`, role: "Consultant", status: "active" },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierAccounts)
      .values([
        { id: IDS.acct1, orgId: ORG, name: `Tasama Holdings ${TAG}`, country: "SA", sector: "Financial Services", status: "active", tier: "strategic" },
        { id: IDS.acct2, orgId: ORG, name: `Tadawul Group ${TAG}`, country: "SA", sector: "Financial Services", status: "active", tier: "strategic" },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierEngagements)
      .values([
        { id: IDS.eng1, orgId: ORG, accountId: IDS.acct1, name: `Falcon Transformation ${TAG}`, slug: `tasama-${TAG}`, plmStage: "deliver", partnerOwnerId: IDS.me, engagementLeadId: IDS.me, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
        { id: IDS.eng2, orgId: ORG, accountId: IDS.acct2, name: `Tadawul Diligence ${TAG}`, slug: `ta2-${TAG}`, plmStage: "deliver", partnerOwnerId: IDS.me, engagementLeadId: IDS.me, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
        { id: IDS.eng3, orgId: ORG, accountId: IDS.acct2, name: `PMO Buildout ${TAG}`, slug: `ta3-${TAG}`, plmStage: "deliver", partnerOwnerId: IDS.me, engagementLeadId: IDS.me, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierTimesheetWeeks)
      .values([
        { id: IDS.wDraft, orgId: ORG, personId: IDS.emp, personType: "employee", weekIso: wAIso, weekStartDate: wAStart.toISOString().slice(0, 10), status: "draft", totalHours: 10, billableHours: 10 },
        { id: IDS.wLocked, orgId: ORG, personId: IDS.emp, personType: "employee", weekIso: wBIso, weekStartDate: wBStart.toISOString().slice(0, 10), status: "approved", totalHours: 7, billableHours: 0 },
        { id: IDS.wOther, orgId: ORG, personId: IDS.empOther, personType: "employee", weekIso: wAIso, weekStartDate: wAStart.toISOString().slice(0, 10), status: "draft", totalHours: 8, billableHours: 8 },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierTimesheetEntries)
      .values([
        { id: IDS.e1, orgId: ORG, weekId: IDS.wDraft, personId: IDS.emp, personType: "employee", workDate: dayA, engagementId: IDS.eng1, activityCode: "billable", hours: 4, billable: true, source: "human", status: "draft", createdByUserId: IDS.me },
        { id: IDS.e2, orgId: ORG, weekId: IDS.wDraft, personId: IDS.emp, personType: "employee", workDate: dayA, engagementId: IDS.eng2, activityCode: "billable", hours: 3, billable: true, source: "human", status: "draft", createdByUserId: IDS.me },
        { id: IDS.e3, orgId: ORG, weekId: IDS.wDraft, personId: IDS.emp, personType: "employee", workDate: dayA, engagementId: IDS.eng3, activityCode: "billable", hours: 3, billable: true, source: "human", status: "draft", createdByUserId: IDS.me },
        { id: IDS.eLocked, orgId: ORG, weekId: IDS.wLocked, personId: IDS.emp, personType: "employee", workDate: dayB, engagementId: null, activityCode: "internal", hours: 7, billable: false, source: "human", status: "draft", createdByUserId: IDS.me },
        { id: IDS.eOther, orgId: ORG, weekId: IDS.wOther, personId: IDS.empOther, personType: "employee", workDate: dayA, engagementId: IDS.eng1, activityCode: "billable", hours: 8, billable: true, source: "human", status: "draft", createdByUserId: IDS.me },
      ] as any)
      .onConflictDoNothing();

    const updateTime = findByToolName("update_my_time")!;
    const removeTime = findByToolName("remove_my_time")!;
    const coverageUpdate = findByToolName("timesheet_entry_update")!;

    // 1 — unique description → two-phase preview pinned to the right entry
    const prev: any = await updateTime.run({ workDate: dayA, engagement: "tasama", hours: 6 }, ctx);
    check(
      "802: update by date+client resolves the entry, two-phase preview",
      prev?.ok === true &&
        prev?.confirmation?.pending?.input?.entryId === IDS.e1 &&
        /4h/.test(String(prev?.confirmation?.summary ?? "")) &&
        /6h/.test(String(prev?.confirmation?.summary ?? "")),
      JSON.stringify(prev).slice(0, 400),
    );
    const commit: any = await updateTime.run({ ...prev.confirmation.pending.input }, ctx);
    const [e1After] = await db.select().from(atelierTimesheetEntries).where(eq(atelierTimesheetEntries.id, IDS.e1));
    const [wAfter] = await db.select().from(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.id, IDS.wDraft));
    check(
      "802: commit updates hours + recomputes week totals",
      commit?.ok === true && Number(e1After?.hours) === 6 && Number(wAfter?.totalHours) === 12 && Number(wAfter?.billableHours) === 12,
      JSON.stringify({ commit, e1After, wAfter }).slice(0, 400),
    );
    check(
      "802: commit returns navigateTo",
      commit?.data?.navigateTo?.path === "/me/timesheets",
      JSON.stringify(commit?.data).slice(0, 200),
    );

    // 2 — several matches (two 3h entries) → ranked disambiguation on entryId
    const amb: any = await updateTime.run({ workDate: dayA, hoursWas: 3, hours: 5 }, ctx);
    check(
      "802: several matching entries → ranked disambiguation, navigateTo:null",
      amb?.ok === true &&
        amb?.disambiguation?.field === "entryId" &&
        (amb?.disambiguation?.options ?? []).length === 2 &&
        amb?.data?.navigateTo === null,
      JSON.stringify(amb).slice(0, 400),
    );
    check(
      "802: self-scope — other person's same-day entry never offered",
      (amb?.disambiguation?.options ?? []).every((o: any) => o.id !== IDS.eOther),
      JSON.stringify(amb?.disambiguation?.options).slice(0, 300),
    );

    // 3 — zero after narrowing → friendly copy naming that day's entries
    const miss: any = await updateTime.run({ workDate: dayA, engagement: "Zebra Nonesuch", hours: 2 }, ctx);
    check(
      "802: descriptor miss → friendly copy naming that day's actual entries",
      miss?.ok === true &&
        /That day has/i.test(String(miss?.data?.prompt ?? "")) &&
        (miss?.disambiguation?.options ?? []).length >= 2,
      JSON.stringify(miss).slice(0, 400),
    );
    // Empty day → honest miss
    const empty: any = await updateTime.run({ workDate: emptyDay, hours: 2 }, ctx);
    check(
      "802: empty day → entry_not_found with honest copy",
      empty?.ok === false && empty?.errorCode === "entry_not_found",
      JSON.stringify(empty).slice(0, 300),
    );

    // 4 — locked (approved) week entries never resolve
    const locked: any = await updateTime.run({ workDate: dayB, hours: 2 }, ctx);
    check(
      "802: approved-week entry unreachable (draft/rejected weeks only)",
      locked?.ok === false && locked?.errorCode === "entry_not_found",
      JSON.stringify(locked).slice(0, 300),
    );

    // nothing to change
    const noop: any = await updateTime.run({ workDate: dayA, engagement: "tasama" }, ctx);
    check(
      "802: no new hours/narrative → nothing_to_change",
      noop?.ok === false && noop?.errorCode === "nothing_to_change",
      JSON.stringify(noop).slice(0, 200),
    );

    // 6a — coverage timesheet_entry_update ambiguous description (both
    // Tadawul entries still present at this point)
    const covAmb: any = await coverageUpdate.run({ workDate: dayA, engagement: "tadawul", hours: 2, confirm: true }, ctx);
    check(
      "802: coverage update ambiguous description → disambiguation on id",
      covAmb?.ok === true && covAmb?.disambiguation?.field === "id" && (covAmb?.disambiguation?.options ?? []).length === 2,
      JSON.stringify(covAmb).slice(0, 400),
    );

    // 5 — remove: two-phase confirm, soft delete, totals recompute
    const rPrev: any = await removeTime.run({ workDate: dayA, engagement: "Diligence" }, ctx);
    check(
      "802: remove resolves by engagement name, two-phase preview",
      rPrev?.ok === true &&
        rPrev?.confirmation?.pending?.input?.entryId === IDS.e2 &&
        /remove/i.test(String(rPrev?.confirmation?.summary ?? "")),
      JSON.stringify(rPrev).slice(0, 400),
    );
    const rCommit: any = await removeTime.run({ ...rPrev.confirmation.pending.input }, ctx);
    const [e2After] = await db.select().from(atelierTimesheetEntries).where(eq(atelierTimesheetEntries.id, IDS.e2));
    const [wAfter2] = await db.select().from(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.id, IDS.wDraft));
    check(
      "802: remove commit soft-deletes + recomputes totals",
      rCommit?.ok === true && e2After?.deletedAt != null && Number(wAfter2?.totalHours) === 9,
      JSON.stringify({ rCommit, wAfter2 }).slice(0, 400),
    );
    // Removed entry no longer resolvable
    const gone: any = await removeTime.run({ workDate: dayA, engagement: "Diligence" }, ctx);
    check(
      "802: removed entry no longer matches (friendly re-ask, not the same id)",
      gone?.ok === true
        ? (gone?.disambiguation?.options ?? []).every((o: any) => o.id !== IDS.e2)
        : gone?.errorCode === "entry_not_found",
      JSON.stringify(gone).slice(0, 300),
    );

    // 6b — coverage timesheet_entry_update by unique description (id optional now)
    const cov: any = await coverageUpdate.run({ workDate: dayA, engagement: "tasama", hours: 5, confirm: true }, ctx);
    const [e1Cov] = await db.select().from(atelierTimesheetEntries).where(eq(atelierTimesheetEntries.id, IDS.e1));
    check(
      "802: coverage update by unique description commits",
      cov?.ok === true && cov?.data?.id === IDS.e1 && Number(e1Cov?.hours) === 5,
      JSON.stringify(cov).slice(0, 300),
    );
  } finally {
    try {
      await db
        .delete(atelierTimesheetEntries)
        .where(inArray(atelierTimesheetEntries.weekId, [IDS.wDraft, IDS.wLocked, IDS.wOther]));
      await db
        .delete(atelierTimesheetWeeks)
        .where(inArray(atelierTimesheetWeeks.id, [IDS.wDraft, IDS.wLocked, IDS.wOther]));
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [IDS.eng1, IDS.eng2, IDS.eng3]));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [IDS.acct1, IDS.acct2]));
      await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [IDS.emp, IDS.empOther]));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, IDS.me));
      await pool.end();
    } catch (e) {
      console.error("cleanup failed", e);
    }
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
