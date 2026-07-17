/**
 * Task #53 — Me-lens self-service (timesheets · leave · expenses) probe.
 *
 * Runs standalone (tsx ./tests/me-selfservice/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass so requests act as ephemeral p_test_* personas. All rows created
 * here are removed in `finally`.
 *
 * Coverage:
 *   1. /me/timesheets/current mirrors the ledger grid for the caller's own
 *      roster person (entry add + submit), and the entry routes stay
 *      self-scoped (foreign entry delete 404s).
 *   2. Leave: create with working-day count, annual balance guard (409),
 *      overlap guard (409), cancel; approver queue on /roster; approve /
 *      reject (reason required), no self-approval; balance reflects the
 *      approved days; self-notification emitted to the requester.
 *   3. Entitlements: employee 403; HR PUT then requester balance uses the
 *      configured allowance.
 *   4. Expenses: draft CRUD; context tag validation (internal label
 *      required, bad account 400); deterministic policy — green submit,
 *      amber requires overrideRationale, red hard-blocks; submitted no
 *      longer editable; wallet reimburse approved→reimbursed (finance
 *      only, idempotent 409) + self-notification.
 *   5. /me/expense-contexts reachable by employee persona.
 */

// --- env setup MUST run before any value-import of @workspace/db / app ---
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const EMP_ID = `p_test_ssemp_${STAMP}`;
const PEER_ID = `p_test_sspeer_${STAMP}`;
const LEAD_ID = `p_test_sslead_${STAMP}`;
const HR_ID = `p_test_sshr_${STAMP}`;
const FIN_ID = `p_test_ssfin_${STAMP}`;
const EMP_PERSON = `emp_test_ss_${STAMP}`;
const PEER_PERSON = `emp_test_sspeer_${STAMP}`;
const LEAD_PERSON = `emp_test_sslead_${STAMP}`;
const CAT = `testcat_${STAMP}`;
const POLICY_ID = `pol_test_${STAMP}`;
const XORG = `xorg_test_${STAMP}`;
const XORG_ACC = `acc_xorg_${STAMP}`;

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
    atelierLeaveRequests,
    atelierLeaveEntitlements,
    atelierLeaveTypeEntitlements,
    atelierRosterReportsTo,
    atelierExpenses,
    atelierExpensePolicies,
    atelierAccounts,
    atelierSelfNotifications,
    atelierTimesheetWeeks,
    atelierTimesheetEntries,
    atelierAuditEvents,
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

  try {
    // --- ephemeral personas + roster records ---
    const personas = [
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "SS Employee" },
      { id: PEER_ID, role: "employee", roleLabel: "Employee", name: "SS Peer" },
      { id: LEAD_ID, role: "senior_manager", roleLabel: "Senior Manager", name: "SS Lead" },
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "SS HR" },
      { id: FIN_ID, role: "finance", roleLabel: "Finance", name: "SS Finance" },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "SS",
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
      fullName: "SS Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierEmployees).values({
      id: PEER_PERSON,
      orgId: ORG,
      userId: PEER_ID,
      fullName: "SS Peer",
      email: `${PEER_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });
    await db.insert(atelierEmployees).values({
      id: LEAD_PERSON,
      orgId: ORG,
      userId: LEAD_ID,
      fullName: "SS Lead",
      email: `${LEAD_ID}@cognirise.ai`,
      role: "senior_manager",
      title: "Senior Manager",
    });
    // A live account in ANOTHER org — must be invisible to this org's
    // self personas (context list + tag validation).
    await db.insert(atelierAccounts).values({
      id: XORG_ACC,
      orgId: XORG,
      name: `XOrg Probe Co ${STAMP}`,
      country: "US",
      sector: "Testing",
    });
    // Deterministic expense policy on a unique category.
    await db.insert(atelierExpensePolicies).values({
      id: POLICY_ID,
      category: CAT,
      appliesToRole: null,
      appliesToCountry: null,
      capAmountUsd: 75,
      capUnit: "per_day",
      hardBlockAmountUsd: 400,
      active: true,
    });

    // =====================================================================
    group("timesheets \u00b7 /me mirror");
    // =====================================================================
    const cur = await call("GET", "/me/timesheets/current", EMP_ID);
    check(
      "employee /me/timesheets/current \u2192 200 with own week shell",
      cur.status === 200 && cur.body?.week?.personId === EMP_PERSON,
      `status=${cur.status} personId=${cur.body?.week?.personId}`,
    );
    const weekId = cur.body?.week?.id;
    const monday = cur.body?.week?.weekStartDate;
    const addEntry = await call("POST", `/me/timesheets/${weekId}/entries`, EMP_ID, {
      workDate: monday,
      hours: 6,
      engagementId: null,
      narrative: "probe work",
    });
    check("own entry create \u2192 2xx", addEntry.status < 300, `status=${addEntry.status}`);
    const entryRows = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(eq(atelierTimesheetEntries.weekId, weekId));
    check("entry persisted with 6h", entryRows.some((e: any) => Number(e.hours) === 6));
    // Foreign entry delete must 404 (peer can't touch it via /me).
    const foreignDel = await call(
      "DELETE",
      `/me/timesheets/entries/${entryRows[0]?.id}`,
      PEER_ID,
    );
    check("foreign entry delete via /me \u2192 404", foreignDel.status === 404, `status=${foreignDel.status}`);
    const submit = await call("POST", `/me/timesheets/${weekId}/submit`, EMP_ID, {
      acknowledgeFlags: true,
    });
    check("own week submit \u2192 200", submit.status === 200, `status=${submit.status} ${JSON.stringify(submit.body)}`);

    // =====================================================================
    group("leave \u00b7 request lifecycle + guards");
    // =====================================================================
    const year = new Date().getUTCFullYear() + 1; // future year: no collisions
    const d = (m: number, day: number) =>
      `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    // Mon 2 Feb – Fri 6 Feb of any year won't matter; use fixed dates and
    // rely on countWorkingDays. March 2-6 is Mon-Fri in some years but not
    // all — instead assert workingDays > 0 and use returned values.
    const req1 = await call("POST", "/me/leave", EMP_ID, {
      leaveType: "annual",
      startDate: d(3, 2),
      endDate: d(3, 6),
      note: "probe leave",
    });
    check(
      "annual leave request \u2192 201 pending with working days",
      req1.status === 201 && req1.body?.request?.status === "pending" && req1.body.request.workingDays > 0,
      `status=${req1.status} ${JSON.stringify(req1.body)}`,
    );
    const leaveId = req1.body?.request?.id;
    const overlap = await call("POST", "/me/leave", EMP_ID, {
      leaveType: "annual",
      startDate: d(3, 4),
      endDate: d(3, 10),
    });
    check("overlapping request \u2192 409", overlap.status === 409 && overlap.body?.error === "overlapping-request", `status=${overlap.status} ${overlap.body?.error}`);
    const tooBig = await call("POST", "/me/leave", EMP_ID, {
      leaveType: "annual",
      startDate: d(6, 1),
      endDate: d(8, 31),
    });
    check("balance-busting request \u2192 409 insufficient-balance", tooBig.status === 409 && tooBig.body?.error === "insufficient-balance", `status=${tooBig.status} ${tooBig.body?.error}`);
    const balance1 = await call("GET", `/me/leave?year=${year}`, EMP_ID);
    check(
      "balance counts pending annual days",
      balance1.status === 200 && balance1.body?.balance?.pendingAnnual === req1.body?.request?.workingDays,
      `pending=${balance1.body?.balance?.pendingAnnual}`,
    );

    group("leave \u00b7 manager routing (reports_to)");
    // No reporting edge yet: a senior_manager is NOT a fallback decider, so
    // the request must not be in their queue and approve must 403.
    const preQueue = await call("GET", "/roster/leave-requests?status=pending", LEAD_ID);
    check(
      "non-manager lead queue excludes the request",
      preQueue.status === 200 && !preQueue.body?.requests?.some((r: any) => r.id === leaveId),
      `status=${preQueue.status}`,
    );
    const preApprove = await call("POST", `/roster/leave-requests/${leaveId}/approve`, LEAD_ID, {});
    check(
      "non-manager lead approve \u2192 403 not-your-report",
      preApprove.status === 403 && preApprove.body?.error === "not-your-report",
      `status=${preApprove.status} ${preApprove.body?.error}`,
    );
    // HR queue includes it via the manager-less fallback.
    const hrFallbackQueue = await call("GET", "/roster/leave-requests?status=pending", HR_ID);
    check(
      "HR fallback queue includes manager-less request",
      hrFallbackQueue.status === 200 && hrFallbackQueue.body?.requests?.some((r: any) => r.id === leaveId),
      `status=${hrFallbackQueue.status}`,
    );
    // HR wires the reporting line: EMP reports to LEAD.
    const setLine = await call("PUT", "/roster/reports-to", HR_ID, {
      personId: EMP_PERSON,
      managerPersonIds: [LEAD_PERSON],
    });
    check("HR sets reporting line \u2192 200", setLine.status === 200, `status=${setLine.status} ${JSON.stringify(setLine.body)}`);
    const edgesGet = await call("GET", "/roster/reports-to", HR_ID);
    check(
      "reports-to list shows the edge",
      edgesGet.status === 200 && edgesGet.body?.edges?.some((e: any) => e.personId === EMP_PERSON && e.managerPersonId === LEAD_PERSON),
      `status=${edgesGet.status}`,
    );

    group("leave \u00b7 approver surface");
    const empQueue = await call("GET", "/roster/leave-requests", EMP_ID);
    check("employee \u2192 approver queue 403", empQueue.status === 403, `status=${empQueue.status}`);
    const queue = await call("GET", "/roster/leave-requests?status=pending", LEAD_ID);
    check(
      "lead sees the pending request with person name",
      queue.status === 200 && queue.body?.requests?.some((r: any) => r.id === leaveId && r.personName === "SS Employee"),
      `status=${queue.status}`,
    );
    const selfApprove = await call(
      "POST",
      `/roster/leave-requests/${leaveId}/approve`,
      EMP_ID,
      {},
    );
    check("requester cannot approve (403 either gate)", selfApprove.status === 403, `status=${selfApprove.status}`);
    const rejectNoReason = await call(
      "POST",
      `/roster/leave-requests/${leaveId}/reject`,
      LEAD_ID,
      {},
    );
    check("reject without reason \u2192 400", rejectNoReason.status === 400, `status=${rejectNoReason.status}`);
    const approve = await call(
      "POST",
      `/roster/leave-requests/${leaveId}/approve`,
      LEAD_ID,
      {},
    );
    check("lead approve \u2192 200 approved", approve.status === 200 && approve.body?.request?.status === "approved", `status=${approve.status}`);
    const balance2 = await call("GET", `/me/leave?year=${year}`, EMP_ID);
    check(
      "approved days move pending\u2192used",
      balance2.body?.balance?.usedAnnual === req1.body?.request?.workingDays && balance2.body?.balance?.pendingAnnual === 0,
      `used=${balance2.body?.balance?.usedAnnual} pending=${balance2.body?.balance?.pendingAnnual}`,
    );
    const notifs = await call("GET", "/me/notifications", EMP_ID);
    check(
      "requester got a leave_approved self-notification",
      notifs.status === 200 && notifs.body?.some((n: any) => n.kind === "leave_approved"),
      `kinds=${JSON.stringify(notifs.body?.map((n: any) => n.kind))}`,
    );
    const decided = await call("POST", `/me/leave/${leaveId}/cancel`, EMP_ID);
    check("approved request no longer cancellable \u2192 404", decided.status === 404, `status=${decided.status}`);
    // Cancel path on a fresh pending request.
    const req2 = await call("POST", "/me/leave", EMP_ID, {
      leaveType: "unpaid",
      startDate: d(9, 1),
      endDate: d(9, 3),
    });
    const cancel = await call("POST", `/me/leave/${req2.body?.request?.id}/cancel`, EMP_ID);
    check("pending request cancel \u2192 200 cancelled", cancel.status === 200 && cancel.body?.request?.status === "cancelled", `status=${cancel.status}`);

    group("leave \u00b7 entitlements config");
    const entEmp = await call("GET", "/roster/leave-entitlements", EMP_ID);
    check("employee \u2192 entitlements 403", entEmp.status === 403, `status=${entEmp.status}`);
    const entPut = await call("PUT", "/roster/leave-entitlements", HR_ID, {
      personId: EMP_PERSON,
      year,
      annualDays: 30,
      sickDays: 12,
    });
    check("HR sets a custom entitlement \u2192 200", entPut.status === 200 && entPut.body?.entitlement?.annualDays === 30, `status=${entPut.status}`);
    const balance3 = await call("GET", `/me/leave?year=${year}`, EMP_ID);
    check(
      "requester balance reflects configured allowance",
      balance3.body?.balance?.annualDays === 30 && balance3.body?.balance?.sickDays === 12,
      `annual=${balance3.body?.balance?.annualDays}`,
    );
    const entGet = await call("GET", `/roster/leave-entitlements?year=${year}`, HR_ID);
    check(
      "entitlement list marks the person configured",
      entGet.status === 200 && entGet.body?.entitlements?.some((e: any) => e.personId === EMP_PERSON && e.configured && e.annualDays === 30),
      `status=${entGet.status}`,
    );

    group("leave \u00b7 employment-type defaults");
    const typePut = await call("PUT", "/roster/leave-entitlements", HR_ID, {
      employmentType: "FTE",
      year,
      annualDays: 28,
      sickDays: 11,
    });
    check("HR sets FTE type default \u2192 200", typePut.status === 200, `status=${typePut.status} ${JSON.stringify(typePut.body)}`);
    const peerBalance = await call("GET", `/me/leave?year=${year}`, PEER_ID);
    check(
      "unconfigured FTE person inherits type default",
      peerBalance.body?.balance?.annualDays === 28 && peerBalance.body?.balance?.sickDays === 11,
      `annual=${peerBalance.body?.balance?.annualDays} sick=${peerBalance.body?.balance?.sickDays}`,
    );
    const empBalance = await call("GET", `/me/leave?year=${year}`, EMP_ID);
    check(
      "person-level entitlement wins over type default",
      empBalance.body?.balance?.annualDays === 30,
      `annual=${empBalance.body?.balance?.annualDays}`,
    );
    const entGet2 = await call("GET", `/roster/leave-entitlements?year=${year}`, HR_ID);
    check(
      "typeDefaults surfaced in the entitlements payload",
      entGet2.body?.typeDefaults?.some((t: any) => t.employmentType === "FTE" && t.annualDays === 28 && t.configured),
      `typeDefaults=${JSON.stringify(entGet2.body?.typeDefaults)}`,
    );

    group("timesheets \u00b7 approved leave overlay");
    const wkLeave = await call("POST", "/me/leave", EMP_ID, {
      leaveType: "annual",
      startDate: monday,
      endDate: monday,
      note: "overlay probe",
    });
    check("current-week leave request \u2192 201", wkLeave.status === 201, `status=${wkLeave.status} ${JSON.stringify(wkLeave.body)}`);
    const wkApprove = await call(
      "POST",
      `/roster/leave-requests/${wkLeave.body?.request?.id}/approve`,
      LEAD_ID,
      {},
    );
    check("manager approves current-week leave", wkApprove.status === 200, `status=${wkApprove.status}`);
    const cur2 = await call("GET", "/me/timesheets/current", EMP_ID);
    check(
      "/me/timesheets/current projects approved leave",
      cur2.status === 200 && cur2.body?.approvedLeave?.some((l: any) => l.id === wkLeave.body?.request?.id && Array.isArray(l.dates) && l.dates.includes(monday)),
      `approvedLeave=${JSON.stringify(cur2.body?.approvedLeave)}`,
    );

    // =====================================================================
    group("expenses \u00b7 draft + context tags");
    // =====================================================================
    const badCtx = await call("POST", "/me/expenses", EMP_ID, {
      merchant: "Probe Cafe",
      amount: 10,
      contextType: "internal",
    });
    check("internal context without label \u2192 400", badCtx.status === 400 && badCtx.body?.error === "internal-project-label-required", `status=${badCtx.status} ${badCtx.body?.error}`);
    const badAcc = await call("POST", "/me/expenses", EMP_ID, {
      merchant: "Probe Cafe",
      amount: 10,
      contextType: "account",
      accountId: "acc_does_not_exist",
    });
    check("unknown account context \u2192 400", badAcc.status === 400 && badAcc.body?.error === "account-not-found", `status=${badAcc.status}`);
    const xorgAcc = await call("POST", "/me/expenses", EMP_ID, {
      merchant: "Probe Cafe",
      amount: 10,
      contextType: "account",
      accountId: XORG_ACC,
    });
    check(
      "cross-org account context \u2192 400 account-not-found",
      xorgAcc.status === 400 && xorgAcc.body?.error === "account-not-found",
      `status=${xorgAcc.status} ${xorgAcc.body?.error}`,
    );
    const green = await call("POST", "/me/expenses", EMP_ID, {
      merchant: "Probe Cafe",
      description: "team lunch probe",
      category: CAT,
      amount: 20,
      currency: "USD",
      contextType: "internal",
      internalProjectLabel: "Probe Project",
    });
    check(
      "draft create \u2192 201 with context tag",
      green.status === 201 && green.body?.expense?.status === "draft" && green.body.expense.internalProjectLabel === "Probe Project",
      `status=${green.status}`,
    );
    const greenId = green.body?.expense?.id;
    const listOwn = await call("GET", "/me/expenses", EMP_ID);
    check("own list contains the draft", listOwn.body?.expenses?.some((e: any) => e.id === greenId));
    const listPeer = await call("GET", "/me/expenses", PEER_ID);
    check("peer list does NOT contain it", !listPeer.body?.expenses?.some((e: any) => e.id === greenId));
    const foreignPatch = await call("PATCH", `/me/expenses/${greenId}`, PEER_ID, { amount: 9 });
    check("foreign patch \u2192 404", foreignPatch.status === 404, `status=${foreignPatch.status}`);

    group("expenses \u00b7 deterministic policy on submit");
    const greenSubmit = await call("POST", `/me/expenses/${greenId}/submit`, EMP_ID, {});
    check("under-cap claim submits green", greenSubmit.status === 200 && greenSubmit.body?.expense?.status === "submitted", `status=${greenSubmit.status} ${JSON.stringify(greenSubmit.body)}`);
    const editSubmitted = await call("PATCH", `/me/expenses/${greenId}`, EMP_ID, { amount: 9 });
    check("submitted claim not editable \u2192 409", editSubmitted.status === 409, `status=${editSubmitted.status}`);

    const amber = await call("POST", "/me/expenses", EMP_ID, {
      merchant: "Probe Hotel",
      category: CAT,
      amount: 120,
      currency: "USD",
      contextType: "bd",
    });
    const amberId = amber.body?.expense?.id;
    const amberSubmit = await call("POST", `/me/expenses/${amberId}/submit`, EMP_ID, {});
    check("over-cap submit without rationale \u2192 409 amber", amberSubmit.status === 409 && amberSubmit.body?.error === "amber-requires-rationale", `status=${amberSubmit.status} ${amberSubmit.body?.error}`);
    const amberOverride = await call("POST", `/me/expenses/${amberId}/submit`, EMP_ID, {
      overrideRationale: "client dinner ran long",
    });
    check("amber with rationale submits", amberOverride.status === 200 && amberOverride.body?.expense?.status === "submitted", `status=${amberOverride.status}`);

    const red = await call("POST", "/me/expenses", EMP_ID, {
      merchant: "Probe Jet",
      category: CAT,
      amount: 999,
      currency: "USD",
      contextType: "bd",
    });
    const redId = red.body?.expense?.id;
    const redSubmit = await call("POST", `/me/expenses/${redId}/submit`, EMP_ID, {
      overrideRationale: "please",
    });
    check("over-hard-block submit \u2192 409 red even with rationale", redSubmit.status === 409 && redSubmit.body?.error === "policy-red-block", `status=${redSubmit.status} ${redSubmit.body?.error}`);
    const delDraft = await call("DELETE", `/me/expenses/${redId}`, EMP_ID);
    check("red draft still deletable", delDraft.status === 200, `status=${delDraft.status}`);

    group("expenses \u00b7 approve + reimburse (wallet side)");
    // Firm-overhead claims (no engagement binding) require partner/ops-tier
    // approval — a lead approver gets a scoped 403 by design.
    const leadApprove = await call("POST", `/wallet/expenses/${greenId}/approve`, LEAD_ID, {});
    check("lead cannot approve firm-overhead claim \u2192 403", leadApprove.status === 403 && leadApprove.body?.error === "lead-cannot-approve-firm-overhead", `status=${leadApprove.status}`);
    const walletApprove = await call("POST", `/wallet/expenses/${greenId}/approve`, FIN_ID, {});
    check("finance approves the submitted claim", walletApprove.status === 200 && walletApprove.body?.expense?.status === "approved", `status=${walletApprove.status} ${JSON.stringify(walletApprove.body)}`);
    const reimburseEmp = await call("POST", `/wallet/expenses/${greenId}/reimburse`, EMP_ID, {});
    check("employee cannot reimburse \u2192 403", reimburseEmp.status === 403, `status=${reimburseEmp.status}`);
    const reimburse = await call("POST", `/wallet/expenses/${greenId}/reimburse`, FIN_ID, {});
    check("finance reimburse \u2192 200 reimbursed", reimburse.status === 200 && reimburse.body?.expense?.status === "reimbursed" && !!reimburse.body?.expense?.reimbursedAt, `status=${reimburse.status} ${JSON.stringify(reimburse.body)}`);
    const reimburseAgain = await call("POST", `/wallet/expenses/${greenId}/reimburse`, FIN_ID, {});
    check(
      "second reimburse is idempotent (200 alreadyReimbursed)",
      reimburseAgain.status === 200 && reimburseAgain.body?.alreadyReimbursed === true,
      `status=${reimburseAgain.status} ${JSON.stringify(reimburseAgain.body)}`,
    );
    const notifs2 = await call("GET", "/me/notifications", EMP_ID);
    check(
      "claimant got expense_reimbursed notification",
      notifs2.body?.some((n: any) => n.kind === "expense_reimbursed"),
      `kinds=${JSON.stringify(notifs2.body?.map((n: any) => n.kind))}`,
    );

    group("expense contexts \u00b7 self persona reachability");
    const ctxs = await call("GET", "/me/expense-contexts", EMP_ID);
    check(
      "employee can list context options",
      ctxs.status === 200 && Array.isArray(ctxs.body?.accounts) && Array.isArray(ctxs.body?.engagements),
      `status=${ctxs.status}`,
    );
    const ctxSearch = await call(
      "GET",
      `/me/expense-contexts?q=${encodeURIComponent(`xorg probe co ${STAMP}`)}`,
      EMP_ID,
    );
    check(
      "context list never leaks another org's accounts",
      ctxSearch.status === 200 && !ctxSearch.body?.accounts?.some((a: any) => a.id === XORG_ACC),
      `accounts=${JSON.stringify(ctxSearch.body?.accounts)}`,
    );
  } finally {
    // --- cleanup: everything stamped this run ---
    try {
      const userIds = [EMP_ID, PEER_ID, LEAD_ID, HR_ID, FIN_ID];
      await db.delete(atelierExpenses).where(inArray(atelierExpenses.personId, userIds));
      await db.delete(atelierExpensePolicies).where(eq(atelierExpensePolicies.id, POLICY_ID));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, XORG_ACC));
      await db.delete(atelierLeaveRequests).where(inArray(atelierLeaveRequests.userId, userIds));
      await db
        .delete(atelierLeaveEntitlements)
        .where(inArray(atelierLeaveEntitlements.personId, [EMP_PERSON, PEER_PERSON]));
      await db
        .delete(atelierLeaveTypeEntitlements)
        .where(
          and(
            eq(atelierLeaveTypeEntitlements.employmentType, "FTE"),
            eq(atelierLeaveTypeEntitlements.year, new Date().getUTCFullYear() + 1),
          ),
        );
      await db
        .delete(atelierRosterReportsTo)
        .where(inArray(atelierRosterReportsTo.personId, [EMP_PERSON, PEER_PERSON, LEAD_PERSON]));
      const weeks = await db
        .select({ id: atelierTimesheetWeeks.id })
        .from(atelierTimesheetWeeks)
        .where(inArray(atelierTimesheetWeeks.personId, [EMP_PERSON, PEER_PERSON, LEAD_PERSON]));
      const weekIds = weeks.map((w: any) => w.id);
      if (weekIds.length) {
        await db
          .delete(atelierTimesheetEntries)
          .where(inArray(atelierTimesheetEntries.weekId, weekIds));
        await db.delete(atelierTimesheetWeeks).where(inArray(atelierTimesheetWeeks.id, weekIds));
      }
      await db
        .delete(atelierSelfNotifications)
        .where(inArray(atelierSelfNotifications.userId, userIds));
      await db
        .delete(atelierAuditEvents)
        .where(inArray(atelierAuditEvents.actorId, userIds));
      await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [EMP_PERSON, PEER_PERSON, LEAD_PERSON]));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_ss%_${STAMP}`));
    } catch (e) {
      console.error("cleanup error:", e);
    }
    server.close();
    await pool.end().catch(() => undefined);
  }

  console.log(
    failures.length === 0
      ? `\n\u2713 me-selfservice probe passed (all checks)`
      : `\n\u2717 me-selfservice probe FAILED: ${failures.length} check(s):\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
