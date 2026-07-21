/**
 * Task #415 — Chat timesheet logging probe.
 *
 * Runs standalone (tsx ./tests/cli-timesheet/run.ts) against an
 * isolated scratch database. Verifies the hardened chat timesheet
 * tools:
 *
 *   1. timesheet_entry_create ignores model-supplied weekId/personId/
 *      personType, resolves the caller's roster person itself,
 *      get-or-creates the correct ISO-week row, and recomputes week
 *      totals.
 *   2. workDate defaults to today; invalid hours / dates / activity
 *      codes fail loudly with no row inserted.
 *   3. A caller with no roster person gets a clear error — never a
 *      false "Write success" — and no garbage row.
 *   4. timesheet_current targets the actual current ISO week and
 *      includes the week's entries.
 *   5. timesheet_entry_update is self-scoped, validates hours, and
 *      recomputes totals.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import { and, eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const EMP_UID = `p_test_ts_${STAMP}`;
const NOBODY_UID = `p_test_tsnobody_${STAMP}`;
const EMP_PERSON = `emp_test_ts_${STAMP}`;
const TAG = `__t415_${STAMP}`;

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
    atelierTimesheetWeeks,
    atelierTimesheetEntries,
    atelierAuditEvents,
  } = D as any;

  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { findByToolName } = catalog;
  const { isoWeekOf } = await import("../../src/routes/atelier/ledgerRoutes.js");

  const empPersona = { id: EMP_UID, name: "TS Emp", role: "employee", orgId: ORG };
  const nobodyPersona = { id: NOBODY_UID, name: "TS Nobody", role: "employee", orgId: ORG };

  const runTool = async (
    toolName: string,
    persona: { id: string; name: string; role: string; orgId: string },
    input: Record<string, unknown> = {},
  ) => {
    const entry = findByToolName(toolName);
    if (!entry) throw new Error(`tool ${toolName} not registered`);
    return entry.run(input, { persona } as any);
  };

  const today = new Date().toISOString().slice(0, 10);
  const { weekIso: currentWeekIso } = isoWeekOf(new Date());

  try {
    // ---------------- seed -------------------------------------------
    await db.insert(atelierUsers).values([
      {
        id: EMP_UID,
        orgId: ORG,
        email: `tsemp${STAMP}@test.local`,
        name: `TS Emp ${TAG}`,
        initials: "TE",
        role: "employee",
        roleLabel: "Employee",
        title: "Test Persona",
      },
      {
        id: NOBODY_UID,
        orgId: ORG,
        email: `tsnobody${STAMP}@test.local`,
        name: `TS Nobody ${TAG}`,
        initials: "TN",
        role: "employee",
        roleLabel: "Employee",
        title: "Test Persona",
      },
    ]);
    await db.insert(atelierEmployees).values({
      id: EMP_PERSON,
      orgId: ORG,
      userId: EMP_UID,
      fullName: `TS Emp ${TAG}`,
      email: `tsemp${STAMP}@test.local`,
      role: "employee",
      title: "Consultant",
      startDate: "2024-01-15",
    });

    // ---------------- 1. hardened create ------------------------------
    group("timesheet_entry_create hardening");

    const noConfirm = await runTool("timesheet_entry_create", empPersona, { hours: 4 });
    check("create without confirm: needs_confirm", noConfirm.ok === false && (noConfirm as any).errorCode === "needs_confirm");

    // Hostile model-supplied identity/week keys must be ignored.
    const created = await runTool("timesheet_entry_create", empPersona, {
      confirm: true,
      hours: 4,
      activityCode: "bench",
      narrative: `bench day ${TAG}`,
      weekId: "undefined",
      personId: "undefined",
      personType: "undefined",
    });
    check("create: ok with server-resolved identity", created.ok === true, JSON.stringify(created));
    const entryId = (created as any).data?.id as string;
    const [row] = entryId
      ? await db.select().from(atelierTimesheetEntries).where(eq(atelierTimesheetEntries.id, entryId))
      : [null];
    check(
      "create: entry keyed to roster person, not literal strings",
      !!row && row.personId === EMP_PERSON && row.personType === "employee" && row.workDate === today,
      JSON.stringify(row),
    );
    const [week] = row
      ? await db.select().from(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.id, row.weekId))
      : [null];
    check(
      "create: week get-or-created for the current ISO week",
      !!week && week.weekIso === currentWeekIso && week.personId === EMP_PERSON,
      JSON.stringify(week),
    );
    check("create: week totals recomputed", !!week && Number(week.totalHours) === 4, `totalHours=${week?.totalHours}`);
    check(
      "create: result surfaces week info",
      (created as any).data?.weekIso === currentWeekIso && (created as any).data?.weekTotalHours === 4,
      JSON.stringify((created as any).data),
    );

    // Second entry same week — same week row, totals accumulate.
    const created2 = await runTool("timesheet_entry_create", empPersona, {
      confirm: true,
      hours: 2,
      workDate: today,
      activityCode: "internal",
    });
    check("create #2: ok", created2.ok === true, JSON.stringify(created2));
    check(
      "create #2: reuses same week row, totals = 6",
      (created2 as any).data?.weekId === week?.id && (created2 as any).data?.weekTotalHours === 6,
      JSON.stringify((created2 as any).data),
    );

    // ---------------- 2. validation failures --------------------------
    group("Validation failures (nothing inserted)");
    const badHours = await runTool("timesheet_entry_create", empPersona, { confirm: true, hours: 30 });
    check("hours>24 rejected", badHours.ok === false && (badHours as any).errorCode === "invalid_hours");
    const zeroHours = await runTool("timesheet_entry_create", empPersona, { confirm: true, hours: 0 });
    check("hours=0 rejected", zeroHours.ok === false && (zeroHours as any).errorCode === "invalid_hours");
    const badDate = await runTool("timesheet_entry_create", empPersona, { confirm: true, hours: 2, workDate: "undefined" });
    check("workDate 'undefined' rejected", badDate.ok === false && (badDate as any).errorCode === "invalid_work_date");
    const badCode = await runTool("timesheet_entry_create", empPersona, { confirm: true, hours: 2, activityCode: "undefined" });
    check("bad activityCode rejected", badCode.ok === false && (badCode as any).errorCode === "invalid_activity_code");
    const badEng = await runTool("timesheet_entry_create", empPersona, { confirm: true, hours: 2, engagementId: `eng_missing_${TAG}` });
    check("unknown engagement rejected", badEng.ok === false && (badEng as any).errorCode === "engagement_not_found");

    const orphanRows = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(inArray(atelierTimesheetEntries.personId, ["undefined", "null", ""]));
    check("no orphaned literal-string rows written", orphanRows.length === 0, JSON.stringify(orphanRows));

    // ---------------- 3. missing identity fails loudly -----------------
    group("Missing roster person");
    const noPerson = await runTool("timesheet_entry_create", nobodyPersona, { confirm: true, hours: 3 });
    check(
      "no roster person: typed error, not Write success",
      noPerson.ok === false && (noPerson as any).errorCode === "no_roster_person",
      JSON.stringify(noPerson),
    );
    const nobodyRows = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(eq(atelierTimesheetEntries.createdByUserId, NOBODY_UID));
    check("no roster person: nothing inserted", nobodyRows.length === 0);

    // ---------------- 4. read side ------------------------------------
    group("timesheet_current");
    const cur = await runTool("timesheet_current", empPersona);
    check(
      "current: returns the current ISO week with totals",
      cur.ok === true && (cur as any).data?.weekIso === currentWeekIso && (cur as any).data?.totalHours === 6,
      JSON.stringify((cur as any).data),
    );
    const curEntries = ((cur as any).data?.entries ?? []) as any[];
    check(
      "current: includes today's entries with hours + activity",
      curEntries.length === 2 &&
        curEntries.every((e) => e.workDate === today) &&
        curEntries.some((e) => e.id === entryId && e.activityCode === "bench" && e.hours === 4),
      JSON.stringify(curEntries),
    );

    // ---------------- 5. update ---------------------------------------
    group("timesheet_entry_update");
    const upd = await runTool("timesheet_entry_update", empPersona, { confirm: true, id: entryId, hours: 5 });
    check(
      "update: ok + week totals recomputed to 7",
      upd.ok === true && (upd as any).data?.weekTotalHours === 7,
      JSON.stringify(upd),
    );
    const badUpd = await runTool("timesheet_entry_update", empPersona, { confirm: true, id: entryId, hours: -1 });
    check("update: invalid hours rejected", badUpd.ok === false && (badUpd as any).errorCode === "invalid_hours");
    const missingUpd = await runTool("timesheet_entry_update", empPersona, { confirm: true, id: `tse_missing_${TAG}`, hours: 2 });
    check("update: unknown entry rejected", missingUpd.ok === false && (missingUpd as any).errorCode === "not_found");
    const foreignUpd = await runTool("timesheet_entry_update", nobodyPersona, { confirm: true, id: entryId, hours: 1 });
    check(
      "update: caller without roster person cannot edit",
      foreignUpd.ok === false && (foreignUpd as any).errorCode === "no_roster_person",
    );
  } finally {
    // ---------------- cleanup (tag sweep) -----------------------------
    const D2 = await import("@workspace/db");
    const {
      db: dbx,
      pool: poolx,
      atelierUsers: U,
      atelierEmployees: E,
      atelierTimesheetWeeks: TW,
      atelierTimesheetEntries: TE,
      atelierAuditEvents: AE,
    } = D2 as any;
    try {
      await dbx.delete(TE).where(eq(TE.personId, EMP_PERSON));
      await dbx.delete(TW).where(eq(TW.personId, EMP_PERSON));
      await dbx.delete(AE).where(inArray(AE.actorId, [EMP_UID, NOBODY_UID]));
      await dbx.delete(E).where(eq(E.id, EMP_PERSON));
      await dbx.delete(U).where(inArray(U.id, [EMP_UID, NOBODY_UID]));
    } catch (err) {
      console.error("cleanup error", err);
    }
    await poolx.end().catch(() => {});
  }

  console.log(`\n${failures.length === 0 ? "ALL PASS" : `${failures.length} FAILURE(S)`}`);
  if (failures.length > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
