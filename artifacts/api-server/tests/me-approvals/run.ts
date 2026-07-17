/**
 * Task #78 — Me-lens pending-approvals digest probe.
 *
 * Runs standalone (tsx ./tests/me-approvals/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass. All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. Non-approver (employee) gets 200 total=0 (no leak, no 403).
 *   2. Partner sees a submitted timesheet week + submitted expense, but NOT
 *      the leave request of a person who has a manager (org-chart routing).
 *   3. The manager (senior_manager with a reports_to edge) sees the leave
 *      request; no led engagements → no timesheets/expenses.
 *   4. Stale flag: items older than staleAfterDays are marked stale and
 *      counted in staleTotal.
 *   5. No self-approval: the partner's own submitted expense is excluded
 *      from the partner's digest.
 */

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const EMP_ID = `p_test_apemp_${STAMP}`;
const MGR_ID = `p_test_apmgr_${STAMP}`;
const PARTNER_ID = `p_test_appart_${STAMP}`;
const FIN_ID = `p_test_apfin_${STAMP}`;
const EMP_PERSON = `emp_test_ap_${STAMP}`;
const MGR_PERSON = `emp_test_apmgr_${STAMP}`;
const WEEK_ID = `tsw_test_ap_${STAMP}`;
const LEAVE_ID = `lv_test_ap_${STAMP}`;
const EXP_ID = `exp_test_ap_${STAMP}`;
const EXP_OWN_ID = `exp_test_apown_${STAMP}`;
const EDGE_ID = `rte_test_ap_${STAMP}`;

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
    atelierTimesheetWeeks,
    atelierLeaveRequests,
    atelierExpenses,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(personaId: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}/me/approvals`, {
      headers: { cookie: `atelier_persona=${personaId}` },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);

  try {
    // --- ephemeral personas + roster ---
    const personas = [
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "AP Employee" },
      { id: MGR_ID, role: "senior_manager", roleLabel: "Senior Manager", name: "AP Manager" },
      { id: PARTNER_ID, role: "partner", roleLabel: "Partner", name: "AP Partner" },
      { id: FIN_ID, role: "finance", roleLabel: "Finance", name: "AP Finance" },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "AP",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    await db.insert(atelierEmployees).values({
      id: EMP_PERSON,
      orgId: ORG,
      userId: EMP_ID,
      fullName: "AP Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierEmployees).values({
      id: MGR_PERSON,
      orgId: ORG,
      userId: MGR_ID,
      fullName: "AP Manager",
      email: `${MGR_ID}@cognirise.ai`,
      role: "senior_manager",
      title: "Senior Manager",
    });
    // Manager edge: EMP reports to MGR (leave routes to MGR, not partner).
    await db.insert(atelierRosterReportsTo).values({
      id: EDGE_ID,
      orgId: ORG,
      personId: EMP_PERSON,
      managerPersonId: MGR_PERSON,
    });

    // Submitted timesheet week — 5 days old (stale).
    await db.insert(atelierTimesheetWeeks).values({
      id: WEEK_ID,
      orgId: ORG,
      personId: EMP_PERSON,
      personType: "employee",
      weekIso: "2026-W98", // synthetic, unique enough
      weekStartDate: iso(daysAgo(9)),
      status: "submitted",
      submittedAt: daysAgo(5),
      submittedByUserId: EMP_ID,
    });
    // Pending leave request — 1 day old (fresh).
    await db.insert(atelierLeaveRequests).values({
      id: LEAVE_ID,
      orgId: ORG,
      userId: EMP_ID,
      personId: EMP_PERSON,
      personType: "employee",
      leaveType: "annual",
      startDate: iso(daysAgo(-10)),
      endDate: iso(daysAgo(-12)),
      workingDays: 3,
      status: "pending",
      createdAt: daysAgo(1),
    });
    // Submitted expense from the employee — 4 days old (stale).
    await db.insert(atelierExpenses).values({
      id: EXP_ID,
      orgId: ORG,
      personId: EMP_ID,
      personType: "employee",
      expenseDate: iso(daysAgo(6)),
      captureSource: "manual",
      merchant: "AP Probe Cafe",
      category: "meals",
      amount: 42,
      currency: "USD",
      usdAmount: 42,
      status: "submitted",
      submittedAt: daysAgo(4),
    });
    // Submitted expense from the PARTNER — must never show in the
    // partner's own digest (no self-approval).
    await db.insert(atelierExpenses).values({
      id: EXP_OWN_ID,
      orgId: ORG,
      personId: PARTNER_ID,
      personType: "employee",
      expenseDate: iso(daysAgo(2)),
      captureSource: "manual",
      merchant: "AP Partner Own",
      category: "meals",
      amount: 10,
      currency: "USD",
      usdAmount: 10,
      status: "submitted",
      submittedAt: daysAgo(2),
    });

    // =====================================================================
    group("non-approver \u2192 empty digest");
    // =====================================================================
    const emp = await call(EMP_ID);
    check("employee \u2192 200", emp.status === 200, `status=${emp.status}`);
    check("employee total=0", emp.body?.total === 0, JSON.stringify(emp.body));

    // =====================================================================
    group("partner digest");
    // =====================================================================
    const par = await call(PARTNER_ID);
    check("partner \u2192 200", par.status === 200, `status=${par.status}`);
    const kinds = (par.body?.items ?? []).map((i: any) => `${i.kind}:${i.id}`);
    check(
      "partner sees the submitted timesheet week",
      kinds.includes(`timesheet:${WEEK_ID}`),
      JSON.stringify(kinds),
    );
    check(
      "partner sees the employee's submitted expense",
      kinds.includes(`expense:${EXP_ID}`),
      JSON.stringify(kinds),
    );
    check(
      "partner does NOT see own submitted expense",
      !kinds.includes(`expense:${EXP_OWN_ID}`),
      JSON.stringify(kinds),
    );
    check(
      "partner does NOT see the managed employee's leave (org-chart routed)",
      !kinds.includes(`leave:${LEAVE_ID}`),
      JSON.stringify(kinds),
    );
    const tsItem = (par.body?.items ?? []).find((i: any) => i.id === WEEK_ID);
    check(
      "5-day-old timesheet is stale",
      tsItem?.stale === true && tsItem?.ageDays >= 3,
      JSON.stringify(tsItem),
    );
    check(
      "staleTotal counts stale items",
      typeof par.body?.staleTotal === "number" && par.body.staleTotal >= 2,
      `staleTotal=${par.body?.staleTotal}`,
    );
    check(
      "categories present",
      par.body?.categories?.timesheets?.count >= 1 && par.body?.categories?.expenses?.count >= 1,
      JSON.stringify(par.body?.categories),
    );

    // =====================================================================
    group("manager digest (org-chart leave routing)");
    // =====================================================================
    const mgr = await call(MGR_ID);
    check("manager \u2192 200", mgr.status === 200, `status=${mgr.status}`);
    const mgrKinds = (mgr.body?.items ?? []).map((i: any) => `${i.kind}:${i.id}`);
    check(
      "manager sees the report's pending leave",
      mgrKinds.includes(`leave:${LEAVE_ID}`),
      JSON.stringify(mgrKinds),
    );
    check(
      "manager (no led engagements) sees no timesheets/expenses",
      !mgrKinds.some((k: string) => k.startsWith("timesheet:") || k.startsWith("expense:")),
      JSON.stringify(mgrKinds),
    );
    const lvItem = (mgr.body?.items ?? []).find((i: any) => i.id === LEAVE_ID);
    check("1-day-old leave is NOT stale", lvItem?.stale === false, JSON.stringify(lvItem));

    // =====================================================================
    group("finance digest (wallet approval parity)");
    // =====================================================================
    const fin = await call(FIN_ID);
    check("finance \u2192 200", fin.status === 200, `status=${fin.status}`);
    const finKinds = (fin.body?.items ?? []).map((i: any) => `${i.kind}:${i.id}`);
    check(
      "finance sees the employee's submitted expense (can approve on /wallet)",
      finKinds.includes(`expense:${EXP_ID}`),
      JSON.stringify(finKinds),
    );
    check(
      "finance (lead approver) sees the submitted timesheet week",
      finKinds.includes(`timesheet:${WEEK_ID}`),
      JSON.stringify(finKinds),
    );
    check(
      "finance does NOT see org-chart-routed leave",
      !finKinds.includes(`leave:${LEAVE_ID}`),
      JSON.stringify(finKinds),
    );
  } finally {
    // --- cleanup (reverse dependency order) ---
    await db.delete(atelierExpenses).where(inArray(atelierExpenses.id, [EXP_ID, EXP_OWN_ID]));
    await db.delete(atelierLeaveRequests).where(eq(atelierLeaveRequests.id, LEAVE_ID));
    await db.delete(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.id, WEEK_ID));
    await db.delete(atelierRosterReportsTo).where(eq(atelierRosterReportsTo.id, EDGE_ID));
    await db
      .delete(atelierEmployees)
      .where(inArray(atelierEmployees.id, [EMP_PERSON, MGR_PERSON]));
    await db
      .delete(atelierUsers)
      .where(inArray(atelierUsers.id, [EMP_ID, MGR_ID, PARTNER_ID, FIN_ID]));
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n\u2713 me-approvals probe passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
