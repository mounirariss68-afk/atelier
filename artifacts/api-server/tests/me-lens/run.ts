/**
 * Task #50 — Me lens + HR joiner lifecycle regression probe.
 *
 * Runs standalone (tsx ./tests/me-lens/run.ts) booting the app in-process
 * via app.listen(0) — the CRM harness pattern; NODE_ENV=test enables the
 * persona-cookie bypass so requests can act as ephemeral p_test_* personas
 * without real sessions. All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. /me/profile resolves the caller's own roster record (employee link
 *      by user_id; contractor link by lower-cased email)
 *   2. /me/notifications list + dismiss are strictly self-scope (a foreign
 *      id 404s)
 *   3. employee persona boundary: /me/* allowed, org-wide routes 403
 *   4. HR add-joiner: 201 with one-time temp password; credential row is
 *      user_managed=true + must_change_password=true; roster record
 *      created and linked; welcome self-notification emitted; login works
 *   5. add-joiner gate: consultant 403; duplicate email 409
 *   6. deactivate: login rejected with the generic error, sessions
 *      revoked, audited; reactivate restores login; self-deactivate 400
 */

// --- env setup MUST run before any value-import of @workspace/db / app ---
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { and, eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const HR_ID = `p_test_hr_${STAMP}`;
const EMP_ID = `p_test_emp_${STAMP}`;
const CT_ID = `p_test_ct_${STAMP}`;
const CONSULTANT_ID = `p_test_cons_${STAMP}`;
const JOINER_EMAIL = `test.joiner.${STAMP}@cognirise.ai`;

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
    atelierContractors,
    atelierAuthCredentials,
    atelierAuthSessions,
    atelierSelfNotifications,
    atelierAuditEvents,
    atelierTimesheetWeeks,
    atelierTimesheetEntries,
    atelierExpenses,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;
  const AUTH = `http://127.0.0.1:${port}/api/auth`;

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

  let joinerUserId: string | null = null;

  try {
    // --- ephemeral personas ---
    const personas = [
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "Test HR" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "Test Employee" },
      { id: CT_ID, role: "contractor", roleLabel: "Contractor", name: "Test Contractor" },
      { id: CONSULTANT_ID, role: "consultant", roleLabel: "Consultant", name: "Test Consultant" },
    ];
    for (const p of personas) {
      await db.insert(atelierUsers).values({
        id: p.id,
        orgId: ORG,
        email: `${p.id}@cognirise.ai`,
        name: p.name,
        initials: "TT",
        role: p.role,
        roleLabel: p.roleLabel,
        title: p.name,
        permissions: [],
        bdActive: false,
      }).onConflictDoNothing();
    }
    // Employee roster record linked by user_id.
    await db.insert(atelierEmployees).values({
      id: `emp_test_${STAMP}`,
      orgId: ORG,
      userId: EMP_ID,
      fullName: "Test Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    // Contractor roster record linked by email (no user_id column).
    await db.insert(atelierContractors).values({
      id: `ct_test_${STAMP}`,
      orgId: ORG,
      fullName: "Test Contractor",
      email: `${CT_ID}@cognirise.ai`,
    });

    // =====================================================================
    group("me \u00b7 profile self-resolution");
    // =====================================================================
    const empProfile = await call("GET", "/me/profile", EMP_ID);
    check(
      "employee /me/profile links roster record by user_id",
      empProfile.status === 200 &&
        empProfile.body?.person?.workerType === "employee" &&
        empProfile.body?.person?.id === `emp_test_${STAMP}`,
      `status=${empProfile.status} person=${JSON.stringify(empProfile.body?.person)}`,
    );
    const ctProfile = await call("GET", "/me/profile", CT_ID);
    check(
      "contractor /me/profile links roster record by email",
      ctProfile.status === 200 &&
        ctProfile.body?.person?.workerType === "contractor" &&
        ctProfile.body?.person?.id === `ct_test_${STAMP}`,
      `status=${ctProfile.status} person=${JSON.stringify(ctProfile.body?.person)}`,
    );
    const hrProfile = await call("GET", "/me/profile", HR_ID);
    check(
      "persona with no roster record \u2192 200 with person=null",
      hrProfile.status === 200 && hrProfile.body?.person === null,
      `status=${hrProfile.status}`,
    );

    // =====================================================================
    group("me \u00b7 notifications self-scope");
    // =====================================================================
    await db.insert(atelierSelfNotifications).values({
      id: `selfnotif_test_${STAMP}`,
      orgId: ORG,
      userId: EMP_ID,
      kind: "test",
      title: "Test card",
      body: "b",
    });
    const empNotifs = await call("GET", "/me/notifications", EMP_ID);
    check(
      "owner sees their card",
      empNotifs.status === 200 &&
        Array.isArray(empNotifs.body) &&
        empNotifs.body.some((n: any) => n.id === `selfnotif_test_${STAMP}`),
      `status=${empNotifs.status} n=${empNotifs.body?.length}`,
    );
    const ctNotifs = await call("GET", "/me/notifications", CT_ID);
    check(
      "other users never see it",
      ctNotifs.status === 200 &&
        !ctNotifs.body?.some((n: any) => n.id === `selfnotif_test_${STAMP}`),
    );
    const foreignDismiss = await call(
      "POST",
      `/me/notifications/selfnotif_test_${STAMP}/dismiss`,
      CT_ID,
      {},
    );
    check("foreign dismiss \u2192 404", foreignDismiss.status === 404, `status=${foreignDismiss.status}`);
    const ownDismiss = await call(
      "POST",
      `/me/notifications/selfnotif_test_${STAMP}/dismiss`,
      EMP_ID,
      {},
    );
    check(
      "own dismiss \u2192 200 dismissed",
      ownDismiss.status === 200 && ownDismiss.body?.status === "dismissed",
      `status=${ownDismiss.status}`,
    );
    const afterDismiss = await call("GET", "/me/notifications", EMP_ID);
    check(
      "dismissed card leaves the list",
      afterDismiss.status === 200 &&
        !afterDismiss.body?.some((n: any) => n.id === `selfnotif_test_${STAMP}`),
    );

    // =====================================================================
    group("me \u00b7 data tabs self-scope (Task #58)");
    // =====================================================================
    // Seed one row per surface for the EMPLOYEE; the contractor must never
    // see any of it.
    await db.insert(atelierTimesheetWeeks).values({
      id: `tsw_test_${STAMP}`,
      orgId: ORG,
      personId: `emp_test_${STAMP}`,
      personType: "employee",
      weekIso: "2026-W28",
      weekStartDate: "2026-07-06",
      status: "submitted",
      totalHours: 40,
      billableHours: 32,
    });
    await db.insert(atelierExpenses).values({
      id: `exp_test_${STAMP}`,
      orgId: ORG,
      personId: EMP_ID,
      personType: "employee",
      expenseDate: "2026-07-08",
      captureSource: "manual",
      merchant: "Probe Cafe",
      category: "meals",
      amount: 42,
      currency: "USD",
      usdAmount: 42,
      status: "submitted",
    });

    const empExp = await call("GET", "/me/expenses", EMP_ID);
    check(
      "employee /me/expenses returns own claim",
      empExp.status === 200 && empExp.body?.expenses?.some((x: any) => x.id === `exp_test_${STAMP}`),
      `status=${empExp.status} n=${empExp.body?.expenses?.length}`,
    );
    const ctExp = await call("GET", "/me/expenses", CT_ID);
    check(
      "contractor /me/expenses never contains the employee's claim",
      ctExp.status === 200 && !ctExp.body?.expenses?.some((x: any) => x.id === `exp_test_${STAMP}`),
      `status=${ctExp.status}`,
    );

    const empPay = await call("GET", "/me/pay", EMP_ID);
    check(
      "employee /me/pay bundle is self-scope 200",
      empPay.status === 200 && Array.isArray(empPay.body?.documents),
      `status=${empPay.status} body=${JSON.stringify(empPay.body)?.slice(0, 200)}`,
    );

    const empPerf = await call("GET", "/me/performance", EMP_ID);
    check(
      "employee /me/performance aggregates own tracked weeks",
      empPerf.status === 200 &&
        empPerf.body?.weeksTracked >= 1 &&
        empPerf.body?.totalHours12w >= 40 &&
        empPerf.body?.utilizationPct != null,
      `status=${empPerf.status} body=${JSON.stringify(empPerf.body)?.slice(0, 200)}`,
    );
    const ctPerf = await call("GET", "/me/performance", CT_ID);
    check(
      "contractor /me/performance has no borrowed hours",
      ctPerf.status === 200 && ctPerf.body?.weeksTracked === 0 && ctPerf.body?.totalHours12w === 0,
      `status=${ctPerf.status}`,
    );

    // =====================================================================
    group("me \u00b7 timesheet writes self-scope (Task #79)");
    // =====================================================================
    // Employee opens their current week (shell auto-created as draft),
    // adds/edits/deletes own draft entries, then submits draft -> submitted.
    // Every path derives the person from the caller; foreign weeks 404.
    const curWeek = await call("GET", "/me/timesheets/current", EMP_ID);
    const weekId: string | undefined = curWeek.body?.week?.id;
    check(
      "employee /me/timesheets/current creates own draft week shell",
      curWeek.status === 200 && !!weekId && curWeek.body?.week?.status === "draft" &&
        curWeek.body?.week?.personId === `emp_test_${STAMP}`,
      `status=${curWeek.status} week=${JSON.stringify(curWeek.body?.week)?.slice(0, 200)}`,
    );

    // No-roster persona cannot even resolve a week.
    const hrCur = await call("GET", "/me/timesheets/current", HR_ID);
    check(
      "persona without roster record \u2192 404 person-not-found",
      hrCur.status === 404 && hrCur.body?.error === "person-not-found",
      `status=${hrCur.status} error=${hrCur.body?.error}`,
    );

    // Owner adds a draft entry.
    const addEntry = await call("POST", `/me/timesheets/${weekId}/entries`, EMP_ID, {
      workDate: curWeek.body?.week?.weekStartDate,
      hours: 6,
      narrative: "probe internal work",
    });
    check("owner adds draft entry \u2192 200", addEntry.status === 200 && addEntry.body?.ok === true, `status=${addEntry.status}`);

    const afterAdd = await call("GET", "/me/timesheets/current", EMP_ID);
    const myEntry = afterAdd.body?.entries?.find?.((e: any) => e.narrative === "probe internal work");
    check(
      "entry lands on own week with recomputed totals",
      !!myEntry && afterAdd.body?.week?.totalHours === 6,
      `entries=${afterAdd.body?.entries?.length} total=${afterAdd.body?.week?.totalHours}`,
    );

    // Owner edits the entry in place (upsert by id).
    const editEntry = await call("POST", `/me/timesheets/${weekId}/entries`, EMP_ID, {
      id: myEntry?.id,
      workDate: curWeek.body?.week?.weekStartDate,
      hours: 7.5,
      narrative: "probe internal work (edited)",
    });
    const afterEdit = await call("GET", "/me/timesheets/current", EMP_ID);
    check(
      "owner edits own entry \u2192 hours updated",
      editEntry.status === 200 && afterEdit.body?.week?.totalHours === 7.5,
      `status=${editEntry.status} total=${afterEdit.body?.week?.totalHours}`,
    );

    // Owner can delete their own draft entry while the week is still draft.
    const scratch = await call("POST", `/me/timesheets/${weekId}/entries`, EMP_ID, {
      workDate: curWeek.body?.week?.weekStartDate,
      hours: 1,
      narrative: "probe scratch entry",
    });
    const afterScratch = await call("GET", "/me/timesheets/current", EMP_ID);
    const scratchEntry = afterScratch.body?.entries?.find?.((e: any) => e.narrative === "probe scratch entry");
    const ownDelete = scratchEntry
      ? await call("DELETE", `/me/timesheets/entries/${scratchEntry.id}`, EMP_ID)
      : { status: 0, body: null };
    const afterOwnDelete = await call("GET", "/me/timesheets/current", EMP_ID);
    check(
      "owner deletes own draft entry \u2192 200, totals recomputed",
      scratch.status === 200 && ownDelete.status === 200 &&
        afterOwnDelete.body?.week?.totalHours === 7.5 &&
        !afterOwnDelete.body?.entries?.some?.((e: any) => e.id === scratchEntry?.id),
      `add=${scratch.status} del=${ownDelete.status} total=${afterOwnDelete.body?.week?.totalHours}`,
    );

    // Contractor (a different person) cannot touch the employee's week —
    // foreign week ids 404, never 403, so ids cannot be probed.
    const foreignAdd = await call("POST", `/me/timesheets/${weekId}/entries`, CT_ID, {
      workDate: curWeek.body?.week?.weekStartDate,
      hours: 8,
    });
    check("foreign entry write \u2192 404", foreignAdd.status === 404, `status=${foreignAdd.status}`);
    const foreignSubmit = await call("POST", `/me/timesheets/${weekId}/submit`, CT_ID, {});
    check("foreign submit \u2192 404", foreignSubmit.status === 404, `status=${foreignSubmit.status}`);
    const foreignDelete = await call("DELETE", `/me/timesheets/entries/${myEntry?.id}`, CT_ID);
    check("foreign entry delete \u2192 404", foreignDelete.status === 404, `status=${foreignDelete.status}`);

    // Owner submits the week: draft -> submitted, self-notification emitted.
    const submitWeek = await call("POST", `/me/timesheets/${weekId}/submit`, EMP_ID, {});
    check(
      "owner submit \u2192 200",
      submitWeek.status === 200 && submitWeek.body?.ok === true,
      `status=${submitWeek.status} body=${JSON.stringify(submitWeek.body)?.slice(0, 200)}`,
    );
    const afterSubmit = await call("GET", "/me/timesheets/current", EMP_ID);
    check(
      "week status is submitted after submit",
      afterSubmit.body?.week?.status === "submitted",
      `status=${afterSubmit.body?.week?.status}`,
    );
    const submitNotifs = await call("GET", "/me/notifications", EMP_ID);
    check(
      "submit emits timesheet_submitted self-notification",
      submitNotifs.body?.some?.((n: any) => n.kind === "timesheet_submitted"),
    );

    // Submitted week is locked for further self-service writes.
    const lockedAdd = await call("POST", `/me/timesheets/${weekId}/entries`, EMP_ID, {
      workDate: curWeek.body?.week?.weekStartDate,
      hours: 1,
    });
    check("entry write on submitted week \u2192 409 week-locked", lockedAdd.status === 409, `status=${lockedAdd.status}`);
    const lockedResubmit = await call("POST", `/me/timesheets/${weekId}/submit`, EMP_ID, {});
    check("re-submit of submitted week \u2192 409", lockedResubmit.status === 409, `status=${lockedResubmit.status}`);
    const lockedDelete = await call("DELETE", `/me/timesheets/entries/${myEntry?.id}`, EMP_ID);
    check("entry delete on submitted week \u2192 409", lockedDelete.status === 409, `status=${lockedDelete.status}`);

    // =====================================================================
    group("employee persona \u00b7 self-only boundary");
    // =====================================================================
    const empAccounts = await call("GET", "/accounts", EMP_ID);
    check("employee \u2192 /accounts 403", empAccounts.status === 403, `status=${empAccounts.status}`);
    const empJoiners = await call("GET", "/roster/joiners", EMP_ID);
    check("employee \u2192 /roster/joiners 403", empJoiners.status === 403, `status=${empJoiners.status}`);
    const empMe = await call("GET", "/me", EMP_ID);
    check("employee \u2192 /me identity allowed", empMe.status === 200, `status=${empMe.status}`);

    // =====================================================================
    group("contractor persona \u00b7 self-only boundary");
    // =====================================================================
    // Task #50 — the legacy contractor allowlist (/engagements,
    // /ledger/timesheets, /wallet/expenses) is retired; contractors are
    // Me-only exactly like employees.
    for (const path of ["/accounts", "/engagements", "/ledger/timesheets", "/wallet/expenses", "/roster/joiners"]) {
      const r = await call("GET", path, CT_ID);
      check(`contractor \u2192 ${path} 403`, r.status === 403, `status=${r.status}`);
    }
    const ctMe = await call("GET", "/me", CT_ID);
    check("contractor \u2192 /me identity allowed", ctMe.status === 200, `status=${ctMe.status}`);
    // Self-only personas must not see the org directory via /personas.
    const empPersonas = await call("GET", "/personas", EMP_ID);
    check(
      "employee \u2192 /personas returns ONLY self",
      empPersonas.status === 200 &&
        Array.isArray(empPersonas.body) &&
        empPersonas.body.length === 1 &&
        empPersonas.body[0]?.id === EMP_ID,
      `status=${empPersonas.status} n=${empPersonas.body?.length} ids=${empPersonas.body?.map?.((p: any) => p.id).join(",")}`,
    );
    const ctPersonas = await call("GET", "/personas", CT_ID);
    check(
      "contractor \u2192 /personas returns ONLY self",
      ctPersonas.status === 200 &&
        ctPersonas.body?.length === 1 &&
        ctPersonas.body[0]?.id === CT_ID,
      `status=${ctPersonas.status} n=${ctPersonas.body?.length}`,
    );

    // =====================================================================
    group("joiners \u00b7 HR add-joiner");
    // =====================================================================
    const consAdd = await call("POST", "/roster/joiners", CONSULTANT_ID, {
      fullName: "Nope",
      email: `nope.${STAMP}@cognirise.ai`,
      workerType: "employee",
    });
    check("consultant add-joiner \u2192 403", consAdd.status === 403, `status=${consAdd.status}`);

    const add = await call("POST", "/roster/joiners", HR_ID, {
      fullName: "Jo Iner",
      email: JOINER_EMAIL,
      workerType: "employee",
      title: "Junior Analyst",
      startDate: "2026-08-01",
    });
    joinerUserId = add.body?.user?.id ?? null;
    const tempPw: string | undefined = add.body?.tempPassword;
    check(
      "HR add-joiner \u2192 201 with user + one-time temp password",
      add.status === 201 && !!joinerUserId && typeof tempPw === "string" && tempPw.startsWith("Join-"),
      `status=${add.status} body=${JSON.stringify(add.body)?.slice(0, 200)}`,
    );

    const [cred] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, JOINER_EMAIL));
    check(
      "credential is user_managed + must_change_password, not disabled",
      !!cred && cred.userManaged === true && cred.mustChangePassword === true && cred.disabled === false,
      JSON.stringify({ um: cred?.userManaged, mcp: cred?.mustChangePassword, dis: cred?.disabled }),
    );
    check(
      "credential carries must_change_reason=joiner (first-login copy)",
      cred?.mustChangeReason === "joiner",
      `reason=${cred?.mustChangeReason}`,
    );
    const [joinerEmp] = joinerUserId
      ? await db
          .select()
          .from(atelierEmployees)
          .where(eq(atelierEmployees.userId, joinerUserId))
      : [];
    check("roster record created and linked by user_id", !!joinerEmp);
    check(
      "start date persisted on the roster record",
      joinerEmp?.startDate === "2026-08-01",
      `startDate=${joinerEmp?.startDate}`,
    );
    const joinerNotifs = joinerUserId ? await call("GET", "/me/notifications", joinerUserId) : { status: 0, body: null };
    check(
      "welcome self-notification emitted",
      joinerNotifs.status === 200 && joinerNotifs.body?.some((n: any) => n.kind === "welcome"),
    );
    const joinerProfile = joinerUserId ? await call("GET", "/me/profile", joinerUserId) : { status: 0, body: null };
    check(
      "joiner /me/profile resolves their new roster record",
      joinerProfile.status === 200 && joinerProfile.body?.person?.workerType === "employee",
    );

    const dupAdd = await call("POST", "/roster/joiners", HR_ID, {
      fullName: "Jo Iner II",
      email: JOINER_EMAIL,
      workerType: "contractor",
    });
    check("duplicate email \u2192 409", dupAdd.status === 409, `status=${dupAdd.status}`);

    // Temp password actually logs in.
    const loginRes = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: JOINER_EMAIL, password: tempPw }),
    });
    check("temp password login \u2192 200", loginRes.status === 200, `status=${loginRes.status}`);
    const loginBody: any = await loginRes.json().catch(() => null);
    check(
      "login response flags mustChangePassword",
      loginBody?.mustChangePassword === true,
      JSON.stringify(loginBody)?.slice(0, 200),
    );
    check(
      "login response carries mustChangeReason=joiner",
      loginBody?.mustChangeReason === "joiner",
      `reason=${loginBody?.mustChangeReason}`,
    );

    // =====================================================================
    group("joiners \u00b7 forced first-login password change (Task #59)");
    // =====================================================================
    // The joiner's REAL session cookie (not the persona bypass).
    const setCookie = loginRes.headers.get("set-cookie") ?? "";
    const m = /atelier_auth_session=([^;]+)/.exec(setCookie);
    const joinerCookie = m ? `atelier_auth_session=${m[1]}` : "";
    check("temp-password login sets a session cookie", !!joinerCookie);

    // isTestAuthBypass() reads NODE_ENV per-request; flip it off so the
    // global auth gate actually runs for these real-session requests.
    const NEW_JOINER_PW = `Chosen-By-Joiner-${STAMP}!`;
    process.env.NODE_ENV = "development";
    try {
      const sess = await fetch(`${AUTH}/session`, { headers: { cookie: joinerCookie } });
      const sessBody: any = await sess.json().catch(() => null);
      check(
        "/auth/session flags mustChangePassword + reason=joiner",
        sess.status === 200 &&
          sessBody?.mustChangePassword === true &&
          sessBody?.mustChangeReason === "joiner",
        `status=${sess.status} body=${JSON.stringify(sessBody)?.slice(0, 200)}`,
      );

      const blocked = await fetch(`${API}/me`, { headers: { cookie: joinerCookie } });
      const blockedBody: any = await blocked.json().catch(() => null);
      check(
        "data route blocked until change \u2192 403 password-change-required",
        blocked.status === 403 && blockedBody?.error === "password-change-required",
        `status=${blocked.status} error=${blockedBody?.error}`,
      );

      const change = await fetch(`${AUTH}/change-password`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: joinerCookie },
        body: JSON.stringify({ currentPassword: tempPw, newPassword: NEW_JOINER_PW }),
      });
      check("forced change with temp password \u2192 200", change.status === 200, `status=${change.status}`);

      const [credAfter] = await db
        .select()
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.email, JOINER_EMAIL));
      check(
        "credential cleared: must_change_password=false, reason=null",
        credAfter?.mustChangePassword === false && credAfter?.mustChangeReason === null,
        JSON.stringify({ mcp: credAfter?.mustChangePassword, reason: credAfter?.mustChangeReason }),
      );

      const unblocked = await fetch(`${API}/me`, { headers: { cookie: joinerCookie } });
      check("data route unblocked after change \u2192 200", unblocked.status === 200, `status=${unblocked.status}`);

      // The landing surface: /me/notifications via the REAL session still
      // shows the welcome card the joiner sees on /me.
      const notifs = await fetch(`${API}/me/notifications`, { headers: { cookie: joinerCookie } });
      const notifsBody: any = await notifs.json().catch(() => null);
      check(
        "welcome notification visible via real session after change",
        notifs.status === 200 && notifsBody?.some?.((n: any) => n.kind === "welcome"),
        `status=${notifs.status}`,
      );
    } finally {
      process.env.NODE_ENV = "test";
    }

    // =====================================================================
    group("joiners \u00b7 deactivate / reactivate");
    // =====================================================================
    const selfDeact = await call("POST", `/roster/joiners/${HR_ID}/deactivate`, HR_ID, {});
    check("self-deactivate \u2192 400", selfDeact.status === 400, `status=${selfDeact.status}`);

    const deact = await call("POST", `/roster/joiners/${joinerUserId}/deactivate`, HR_ID, {});
    check(
      "deactivate \u2192 200 status=deactivated",
      deact.status === 200 && deact.body?.status === "deactivated",
      `status=${deact.status} body=${JSON.stringify(deact.body)?.slice(0, 150)}`,
    );
    const sessions = joinerUserId
      ? await db
          .select()
          .from(atelierAuthSessions)
          .where(eq(atelierAuthSessions.userId, joinerUserId))
      : [];
    const liveSessions = sessions.filter((s: any) => !s.revokedAt);
    check("all sessions revoked on deactivate", liveSessions.length === 0, `live=${liveSessions.length}`);

    const deadLogin = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: JOINER_EMAIL, password: tempPw }),
    });
    const deadBody: any = await deadLogin.json().catch(() => null);
    check(
      "deactivated login \u2192 401 generic invalid-credentials",
      deadLogin.status === 401 && deadBody?.error === "invalid-credentials",
      `status=${deadLogin.status} error=${deadBody?.error}`,
    );

    const auditRows = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, "joiner"),
          eq(atelierAuditEvents.entityId, joinerUserId!),
        ),
      );
    check(
      "joiner_added + leaver_deactivated audited",
      auditRows.some((r: any) => r.action === "joiner_added") &&
        auditRows.some((r: any) => r.action === "leaver_deactivated"),
      auditRows.map((r: any) => r.action).join(","),
    );

    const react = await call("POST", `/roster/joiners/${joinerUserId}/reactivate`, HR_ID, {});
    check("reactivate \u2192 200 status=active", react.status === 200 && react.body?.status === "active");
    // Task #59 — the joiner already rotated their password above, so the
    // reactivated login must use the chosen password, not the temp one.
    const aliveLogin = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: JOINER_EMAIL, password: NEW_JOINER_PW }),
    });
    check("reactivated login \u2192 200", aliveLogin.status === 200, `status=${aliveLogin.status}`);

    // Joiner list shows the row with the right status.
    const list = await call("GET", "/roster/joiners", HR_ID);
    const row = list.body?.find?.((j: any) => j.userId === joinerUserId);
    check(
      "GET /roster/joiners shows the joiner as active (temp password already rotated)",
      list.status === 200 && row?.status === "active" && row?.mustChangePassword === false,
      JSON.stringify(row),
    );
  } finally {
    // --- cleanup: every row this suite created ---
    try {
      if (joinerUserId) {
        await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, joinerUserId));
        await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, JOINER_EMAIL));
        await db.delete(atelierSelfNotifications).where(eq(atelierSelfNotifications.userId, joinerUserId));
        await db.delete(atelierEmployees).where(eq(atelierEmployees.userId, joinerUserId));
        await db.delete(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityType, "joiner"), eq(atelierAuditEvents.entityId, joinerUserId)));
        await db.delete(atelierUsers).where(eq(atelierUsers.id, joinerUserId));
      }
      await db.delete(atelierSelfNotifications).where(eq(atelierSelfNotifications.id, `selfnotif_test_${STAMP}`));
      // Task #79 — timesheet-write probe rows (entries, current-week shell,
      // submit notification + audit rows keyed by the shell week's id).
      await db.delete(atelierTimesheetEntries).where(eq(atelierTimesheetEntries.personId, `emp_test_${STAMP}`));
      await db.delete(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityType, "timesheet_week"), like(atelierAuditEvents.entityId, `tsw_emp_test_${STAMP}_%`)));
      await db.delete(atelierSelfNotifications).where(eq(atelierSelfNotifications.userId, EMP_ID));
      await db.delete(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.personId, `emp_test_${STAMP}`));
      await db.delete(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.id, `tsw_test_${STAMP}`));
      await db.delete(atelierExpenses).where(eq(atelierExpenses.id, `exp_test_${STAMP}`));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, `emp_test_${STAMP}`));
      await db.delete(atelierContractors).where(eq(atelierContractors.id, `ct_test_${STAMP}`));
      for (const id of [HR_ID, EMP_ID, CT_ID, CONSULTANT_ID]) {
        await db.delete(atelierUsers).where(eq(atelierUsers.id, id));
      }
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_joiner_%`));
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 me-lens probe: all checks passed"
      : `\n\u2717 me-lens probe: ${failures.length} failed:\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
