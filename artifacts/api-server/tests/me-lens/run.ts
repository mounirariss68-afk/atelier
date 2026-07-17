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
