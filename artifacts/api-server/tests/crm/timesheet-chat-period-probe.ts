/**
 * Task #788 — chat timesheet questions beyond the current week +
 * engagement-scoped time logging.
 *
 * Pins, at capability level on a scratch DB:
 *   1. my_timesheets date=<past date> resolves the ISO week SERVER-side
 *      and returns that week (with day-level entries).
 *   2. my_timesheets month=YYYY-MM returns the weeks overlapping the
 *      month; a miss names the caller's real recent weeks (friendly).
 *   3. timesheet_current accepts date/weekIso for past weeks; bad
 *      formats get honest invalid_body copy.
 *   4. log_my_time engagement="<name>" resolves org-scoped; unique →
 *      confirm preview carries engagementId; ambiguous → ranked
 *      disambiguation {field:"engagementId", navigateTo:null}; unknown
 *      name → nearest candidates; commit writes billable entry and
 *      recomputes week totals as of today.
 *   5. Self-scope: another person's weeks never appear.
 *
 * Fixtures compute weeks via isoWeekOf — no hardcoded week labels.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/timesheet-chat-period-probe.ts
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

const TAG = `probe788_${Date.now()}`;
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
  await import("../../src/lib/atelier-cli/me-capabilities.js");
  await import("../../src/lib/atelier-cli/me-write-capabilities.js");
  await import("../../src/lib/atelier-cli/cli-only-capabilities-reads.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");

  const IDS = {
    me: `u_${TAG}_me`,
    other: `u_${TAG}_other`,
    emp: `pe_${TAG}_me`,
    empOther: `pe_${TAG}_other`,
    acct1: `acc_${TAG}_tasama`,
    acct2: `acc_${TAG}_tadawul`,
    eng1: `eng_${TAG}_tasama`,
    eng2: `eng_${TAG}_ta2`,
    eng3: `eng_${TAG}_ta3`,
    eng4: `eng_${TAG}_orphan`,
    eng5: `eng_${TAG}_closed`,
    wPast: `tsw_${TAG}_past`,
    wPastOther: `tsw_${TAG}_pastother`,
    ePast: `tse_${TAG}_past`,
  };
  const ctx = { persona: { id: IDS.me, orgId: ORG, role: "founding_partner", name: "Probe Me" } } as any;

  // A date safely in a PAST ISO week (4 weeks ago, Wednesday-ish).
  const past = new Date(Date.now() - 28 * 86400000);
  const { weekIso: pastWeekIso, weekStart: pastWeekStart } = isoWeekOf(past);
  const pastDate = new Date(pastWeekStart.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const pastMonth = pastDate.slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

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
        {
          id: IDS.emp,
          orgId: ORG,
          userId: IDS.me,
          fullName: "Probe Me",
          email: `${TAG}.me@cognirise.ai`,
          role: "Partner",
          status: "active",
        },
        {
          id: IDS.empOther,
          orgId: ORG,
          userId: null,
          fullName: "Probe Other",
          email: `${TAG}.other@cognirise.ai`,
          role: "Consultant",
          status: "active",
        },
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
        // Malformed/cross-tenant account ref — the account name must NOT leak.
        { id: IDS.eng4, orgId: ORG, accountId: `acc_${TAG}_foreign_ref`, name: `Orphanline Advisory ${TAG}`, slug: `orph-${TAG}`, plmStage: "deliver", partnerOwnerId: IDS.me, engagementLeadId: IDS.me, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
        // Closed engagement — must never take new billable time.
        { id: IDS.eng5, orgId: ORG, accountId: IDS.acct1, name: `Zephyr Wind-down ${TAG}`, slug: `zeph-${TAG}`, plmStage: "closed", partnerOwnerId: IDS.me, engagementLeadId: IDS.me, startDate: "2025-01-01", plannedEndDate: "2025-12-31" },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierTimesheetWeeks)
      .values([
        {
          id: IDS.wPast,
          orgId: ORG,
          personId: IDS.emp,
          personType: "employee",
          weekIso: pastWeekIso,
          weekStartDate: pastWeekStart.toISOString().slice(0, 10),
          status: "approved",
          totalHours: 7,
          billableHours: 0,
        },
        {
          id: IDS.wPastOther,
          orgId: ORG,
          personId: IDS.empOther,
          personType: "employee",
          weekIso: pastWeekIso,
          weekStartDate: pastWeekStart.toISOString().slice(0, 10),
          status: "approved",
          totalHours: 40,
          billableHours: 40,
        },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierTimesheetEntries)
      .values([
        {
          id: IDS.ePast,
          orgId: ORG,
          weekId: IDS.wPast,
          personId: IDS.emp,
          personType: "employee",
          workDate: pastDate,
          engagementId: null,
          activityCode: "internal",
          hours: 7,
          billable: false,
          source: "human",
          status: "draft",
          createdByUserId: IDS.me,
        },
      ] as any)
      .onConflictDoNothing();

    const myTimesheets = findByToolName("my_timesheets")!;
    const tsCurrent = findByToolName("timesheet_current")!;
    const logTime = findByToolName("log_my_time")!;

    // 1 — historical read via a raw date (server derives the ISO week)
    const byDate: any = await myTimesheets.run({ date: pastDate }, ctx);
    check(
      "788: my_timesheets date=<past> resolves the ISO week server-side",
      byDate?.ok === true &&
        byDate?.data?.total === 1 &&
        byDate?.data?.items?.[0]?.weekIso === pastWeekIso &&
        Array.isArray(byDate?.data?.entries) &&
        byDate.data.entries.some((e: any) => e.id === IDS.ePast),
      JSON.stringify(byDate).slice(0, 400),
    );
    check(
      "788: self-scope — other person's week never appears",
      byDate?.data?.items?.every((w: any) => w.id !== IDS.wPastOther),
      JSON.stringify(byDate?.data?.items).slice(0, 200),
    );

    // 2 — month filter + friendly miss
    const byMonth: any = await myTimesheets.run({ month: pastMonth }, ctx);
    check(
      "788: my_timesheets month filter includes the past week",
      byMonth?.ok === true && byMonth?.data?.items?.some((w: any) => w.weekIso === pastWeekIso),
      JSON.stringify(byMonth).slice(0, 300),
    );
    const missMonth: any = await myTimesheets.run({ month: "2019-01" }, ctx);
    check(
      "788: month miss → friendly copy naming real recent weeks",
      missMonth?.ok === true &&
        missMonth?.data?.total === 0 &&
        String(missMonth?.data?.note ?? "").includes(pastWeekIso),
      JSON.stringify(missMonth).slice(0, 300),
    );
    const badMonth: any = await myTimesheets.run({ month: "January" }, ctx);
    check(
      "788: bad month format → honest invalid_body",
      badMonth?.ok === false && badMonth?.errorCode === "invalid_body",
      JSON.stringify(badMonth).slice(0, 200),
    );
    // Semantic (not just regex) validation
    const m19: any = await myTimesheets.run({ month: "2026-19" }, ctx);
    const d230: any = await myTimesheets.run({ date: "2026-02-30" }, ctx);
    const w00: any = await myTimesheets.run({ weekIso: "2026-W00" }, ctx);
    const w54: any = await myTimesheets.run({ weekIso: "2026-W54" }, ctx);
    const w53ok: any = await myTimesheets.run({ weekIso: "2026-W53" }, ctx); // 2026 has 53 ISO weeks
    check(
      "788: semantic period validation (month 19, Feb 30, W00, W54 all invalid_body)",
      [m19, d230, w00, w54].every((r) => r?.ok === false && r?.errorCode === "invalid_body"),
      JSON.stringify({ m19, d230, w00, w54 }).slice(0, 300),
    );
    check(
      "788: real 53rd week accepted (miss copy, not invalid)",
      w53ok?.ok === true,
      JSON.stringify(w53ok).slice(0, 200),
    );

    // 3 — timesheet_current past week via date + weekIso, bad format
    const tcDate: any = await tsCurrent.run({ date: pastDate }, ctx);
    check(
      "788: timesheet_current date=<past> returns that week",
      tcDate?.ok === true && tcDate?.data?.weekIso === pastWeekIso,
      JSON.stringify(tcDate).slice(0, 300),
    );
    const tcWeek: any = await tsCurrent.run({ weekIso: pastWeekIso.toLowerCase() }, ctx);
    check(
      "788: timesheet_current weekIso (case-insensitive) returns that week",
      tcWeek?.ok === true && tcWeek?.data?.weekIso === pastWeekIso,
      JSON.stringify(tcWeek).slice(0, 300),
    );
    const tcBad: any = await tsCurrent.run({ weekIso: "week 12" }, ctx);
    check(
      "788: timesheet_current bad weekIso → invalid_body",
      tcBad?.ok === false && tcBad?.errorCode === "invalid_body",
      JSON.stringify(tcBad).slice(0, 200),
    );

    // 4a — unique engagement name → preview carries engagementId
    const prev: any = await logTime.run({ workDate: today, hours: 3, engagement: "tasama" }, ctx);
    check(
      "788: client/account name (not in engagement title) resolves uniquely",
      prev?.ok === true &&
        prev?.confirmation?.pending?.input?.engagementId === IDS.eng1 &&
        /Falcon Transformation/.test(String(prev?.confirmation?.summary ?? "")),
      JSON.stringify(prev).slice(0, 400),
    );

    // 4b — ambiguous name → ranked disambiguation, navigateTo:null
    const amb: any = await logTime.run({ workDate: today, hours: 3, engagement: "tadawul" }, ctx);
    check(
      "788: ambiguous engagement → ranked disambiguation on engagementId",
      amb?.ok === true &&
        amb?.disambiguation?.field === "engagementId" &&
        (amb?.disambiguation?.options ?? []).length === 2 &&
        amb?.data?.navigateTo === null,
      JSON.stringify(amb).slice(0, 400),
    );

    // 4c — unknown name → nearest candidates, never a bare error
    const near: any = await logTime.run({ workDate: today, hours: 3, engagement: "Tasma" }, ctx);
    check(
      "788: near-miss CLIENT name → did-you-mean includes the client's engagement",
      near?.ok === true &&
        (near?.disambiguation?.options ?? []).length > 0 &&
        (near?.disambiguation?.options ?? []).some((o: any) => o.id === IDS.eng1) &&
        /did you mean/i.test(String(near?.data?.prompt ?? "")),
      JSON.stringify(near).slice(0, 400),
    );

    // 4c2 — engagement with an unresolvable account ref still resolves by
    // its own name, with no account name leaked in the preview
    const orphan: any = await logTime.run(
      { workDate: today, hours: 2, engagement: "Orphanline" },
      ctx,
    );
    check(
      "788: orphan/cross-tenant account ref → resolves by engagement name, no account leak",
      orphan?.ok === true &&
        orphan?.confirmation?.pending?.input?.engagementId === IDS.eng4 &&
        !JSON.stringify(orphan).includes("foreign_ref"),
      JSON.stringify(orphan).slice(0, 300),
    );

    // 4c3 — closed engagements can never take new time, by name or by id
    const closedByName: any = await logTime.run(
      { workDate: today, hours: 2, engagement: "Zephyr" },
      ctx,
    );
    const closedById: any = await logTime.run(
      { workDate: today, hours: 2, engagementId: IDS.eng5 },
      ctx,
    );
    check(
      "788: closed engagement unreachable by name (not matched, not suggested)",
      closedByName?.ok === false
        ? !JSON.stringify(closedByName).includes(IDS.eng5)
        : (closedByName?.disambiguation?.options ?? []).every((o: any) => o.id !== IDS.eng5) &&
          closedByName?.confirmation?.pending?.input?.engagementId !== IDS.eng5,
      JSON.stringify(closedByName).slice(0, 300),
    );
    check(
      "788: closed engagement rejected by explicit id",
      closedById?.ok === false && closedById?.errorCode === "engagement_not_found",
      JSON.stringify(closedById).slice(0, 300),
    );

    // 4d — commit writes a billable entry + recomputes totals as of today
    const commit: any = await logTime.run(
      { ...prev.confirmation.pending.input },
      ctx,
    );
    check(
      "788: commit logs billable time against the engagement",
      commit?.ok === true && /Falcon Transformation/.test(String(commit?.data?.label ?? "")),
      JSON.stringify(commit).slice(0, 300),
    );
    const { weekIso: nowWeekIso } = isoWeekOf(new Date());
    const [nowWeek] = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(eq(atelierTimesheetWeeks.id, commit?.data ? (await db
        .select()
        .from(atelierTimesheetEntries)
        .where(eq(atelierTimesheetEntries.id, commit.data.id)))[0].weekId : "none"));
    check(
      "788: week totals recomputed (billable hours present, current ISO week)",
      nowWeek?.weekIso === nowWeekIso && Number(nowWeek?.billableHours) >= 3,
      JSON.stringify(nowWeek).slice(0, 300),
    );

    // 4e — no engagement given → internal time, unchanged fast path
    const plain: any = await logTime.run({ workDate: today, hours: 1 }, ctx);
    check(
      "788: engagement-free logging unchanged (internal)",
      plain?.ok === true && plain?.confirmation?.pending?.input?.confirm === true,
      JSON.stringify(plain).slice(0, 300),
    );
  } finally {
    try {
      const myWeeks = await db
        .select({ id: atelierTimesheetWeeks.id })
        .from(atelierTimesheetWeeks)
        .where(inArray(atelierTimesheetWeeks.personId, [IDS.emp, IDS.empOther]));
      const weekIds = myWeeks.map((w: any) => w.id);
      if (weekIds.length > 0) {
        await db
          .delete(atelierTimesheetEntries)
          .where(inArray(atelierTimesheetEntries.weekId, weekIds));
        await db.delete(atelierTimesheetWeeks).where(inArray(atelierTimesheetWeeks.id, weekIds));
      }
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [IDS.eng1, IDS.eng2, IDS.eng3, IDS.eng4, IDS.eng5]));
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
