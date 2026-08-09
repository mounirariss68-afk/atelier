/**
 * Task #822 — security audit console probe.
 *
 * Covers, end to end against a scratch DB + in-process app boot:
 *   1. ACL: unauthenticated → 401; non-founding-partner → 403 (list + CSV).
 *   2. Auth tab lists auth-trail events with IP; actions tab excludes them.
 *   3. Filters: person (actor label / target email), event type, date range.
 *   4. Pagination: limit/offset with a stable total.
 *   5. Console access is itself audited (security_log_viewed) and debounced.
 *   6. CSV export honors filters, gates on founding partner, sets headers.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/security-log/run.ts
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, like } from "drizzle-orm";

const STAMP = Date.now();
const EMP_ID = `p_test_seclog_${STAMP}`;
const EMP_EMAIL = `test.seclog.${STAMP}@cognirise.ai`;
const FP_ID = `p_test_seclog_fp_${STAMP}`;
const FP_EMAIL = `test.seclog.fp.${STAMP}@cognirise.ai`;
const EMP_PW = `Emp-Pw-${STAMP}-1`;
const FP_PW = `Fp-Pw-${STAMP}-2`;

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

async function main() {
  const { db, atelierAuthCredentials, atelierAuthSessions, atelierAuditEvents, atelierUsers, pool } =
    await import("@workspace/db");
  const { hashPassword } = await import("../../src/lib/auth/passwords.js");
  const authModule = await import("../../src/routes/auth/index.js");
  const resetRate = authModule.__resetAuthRateLimitForTests;
  const app = (await import("../../src/app.js")).default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;

  const post = async (path: string, body: unknown, cookie?: string) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
  };
  const get = async (path: string, cookie?: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
  };
  const cookieOf = (res: Response): string | null => {
    const m = /atelier_auth_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
    return m ? `atelier_auth_session=${m[1]}` : null;
  };

  try {
    // ---- provision ephemeral personas ----
    const [anyOrg] = await db.select({ orgId: atelierUsers.orgId }).from(atelierUsers).limit(1);
    const orgId = anyOrg?.orgId ?? "aico";
    await db.insert(atelierUsers).values([
      { id: EMP_ID, orgId, email: EMP_EMAIL, name: "SecLog Employee", initials: "SE", role: "employee", roleLabel: "Employee", title: "Test Employee" },
      { id: FP_ID, orgId, email: FP_EMAIL, name: "SecLog Partner", initials: "SP", role: "founding_partner", roleLabel: "Founding Partner", title: "Test Partner" },
    ]);
    await db.insert(atelierAuthCredentials).values([
      { email: EMP_EMAIL, userId: EMP_ID, passwordHash: hashPassword(EMP_PW), userManaged: true },
      { email: FP_EMAIL, userId: FP_ID, passwordHash: hashPassword(FP_PW), userManaged: true },
    ]);
    // Seed a couple of BUSINESS audit rows (actions tab material).
    const bizId = `audit_seclog_biz_${STAMP}`;
    await db.insert(atelierAuditEvents).values([
      { id: bizId, orgId, entityType: "account", entityId: `acc_seclog_${STAMP}`, actorType: "human", actorId: FP_ID, actorLabel: "SecLog Partner", action: "account.update", payload: {}, payloadSummary: "seclog probe business row" },
      { id: `${bizId}_2`, orgId, entityType: "expense", entityId: `exp_seclog_${STAMP}`, actorType: "human", actorId: EMP_ID, actorLabel: "SecLog Employee", action: "expense.create", payload: {}, payloadSummary: "seclog probe expense row" },
    ]);

    // Generate auth-trail rows: a failed then successful employee login.
    resetRate?.();
    await post("/login", { email: EMP_EMAIL, password: "wrong-password-1" });
    const empLogin = await post("/login", { email: EMP_EMAIL, password: EMP_PW });
    const empCookie = cookieOf(empLogin.res)!;
    const fpLogin = await post("/login", { email: FP_EMAIL, password: FP_PW });
    const fpCookie = cookieOf(fpLogin.res)!;

    // =====================================================================
    group("ACL \u00b7 founding partner only");
    // =====================================================================
    const anon = await get("/security-log?tab=auth");
    check("unauthenticated \u2192 401", anon.status === 401);
    const emp = await get("/security-log?tab=auth", empCookie);
    check("employee \u2192 403", emp.status === 403, `status=${emp.status}`);
    const empCsv = await get("/security-log/export.csv?tab=auth", empCookie);
    check("employee CSV export \u2192 403", empCsv.status === 403);
    const badTab = await get("/security-log?tab=nope", fpCookie);
    check("invalid tab \u2192 400", badTab.status === 400);

    // =====================================================================
    group("auth tab \u00b7 sign-in trail with IP");
    // =====================================================================
    const auth1 = await get("/security-log?tab=auth&limit=100", fpCookie);
    check("founding partner \u2192 200", auth1.status === 200, `status=${auth1.status}`);
    const evts: any[] = auth1.body?.events ?? [];
    check("only auth entityType rows", evts.length > 0 && evts.every((e) => e.entityType === "auth"));
    // Failed logins record the attempted email as the actor label.
    const empFail = evts.find((e) => e.action === "login_failed" && e.actorLabel === EMP_EMAIL);
    const empOk = evts.find((e) => e.action === "login_success" && e.actorLabel === "SecLog Employee");
    check("failed login row present with IP", !!empFail && typeof empFail.ip === "string" && empFail.ip.length > 0);
    check("successful login row present", !!empOk);
    check("action list included for dropdown", Array.isArray(auth1.body?.actions) && auth1.body.actions.includes("login_success"));

    // =====================================================================
    group("actions tab \u00b7 business trail");
    // =====================================================================
    const act1 = await get("/security-log?tab=actions&limit=100", fpCookie);
    const actEvts: any[] = act1.body?.events ?? [];
    check("no auth rows in actions tab", act1.status === 200 && actEvts.every((e) => e.entityType !== "auth"));
    check("seeded business rows visible", actEvts.some((e) => e.id === bizId) && actEvts.some((e) => e.id === `${bizId}_2`));

    // =====================================================================
    group("filters \u00b7 person, event type, date range");
    // =====================================================================
    const byAction = await get("/security-log?tab=auth&action=login_failed&limit=100", fpCookie);
    check(
      "event-type filter returns only that action",
      (byAction.body?.events ?? []).length > 0 && byAction.body.events.every((e: any) => e.action === "login_failed"),
    );
    const byActor = await get(`/security-log?tab=actions&actor=${encodeURIComponent("SecLog Employee")}&limit=100`, fpCookie);
    check(
      "person filter matches actor label",
      (byActor.body?.events ?? []).length > 0 && byActor.body.events.every((e: any) => e.actorLabel === "SecLog Employee"),
    );
    const byEmail = await get(`/security-log?tab=auth&actor=${encodeURIComponent(EMP_EMAIL)}&limit=100`, fpCookie);
    check(
      "person filter by email finds that person's auth events",
      (byEmail.body?.events ?? []).some((e: any) => e.actorLabel === EMP_EMAIL || e.targetEmail === EMP_EMAIL),
    );
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const future = await get(`/security-log?tab=auth&from=${tomorrow}&limit=100`, fpCookie);
    check("future-only date range \u2192 empty", future.status === 200 && (future.body?.events ?? []).length === 0 && future.body?.total === 0);
    const past = await get(`/security-log?tab=auth&to=${tomorrow}&limit=100`, fpCookie);
    check("inclusive to-date keeps today's rows", (past.body?.events ?? []).length > 0);
    const badDate = await get("/security-log?tab=auth&from=not-a-date", fpCookie);
    check("invalid date \u2192 400", badDate.status === 400);

    // =====================================================================
    group("pagination \u00b7 stable total, limit/offset");
    // =====================================================================
    const pageA = await get("/security-log?tab=auth&limit=2&offset=0", fpCookie);
    const pageB = await get("/security-log?tab=auth&limit=2&offset=2", fpCookie);
    const total = pageA.body?.total ?? 0;
    check("page size respected", (pageA.body?.events ?? []).length === 2, `got=${pageA.body?.events?.length}`);
    check("total stable across pages", total >= 4 && pageB.body?.total === total);
    const idsA = new Set((pageA.body?.events ?? []).map((e: any) => e.id));
    check("pages do not overlap", (pageB.body?.events ?? []).every((e: any) => !idsA.has(e.id)));
    check("offset pages skip the action-list payload", pageB.body?.actions === undefined);

    // =====================================================================
    group("console access is audited (debounced)");
    // =====================================================================
    const viewRows = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.action, "security_log_viewed"), eq(atelierAuditEvents.actorId, FP_ID)));
    check("security_log_viewed written for this partner", viewRows.length >= 1);
    check("debounce: many first-page fetches \u2192 few audit rows", viewRows.length <= 2, `rows=${viewRows.length}`);
    const viewInLog = await get("/security-log?tab=auth&action=security_log_viewed&limit=10", fpCookie);
    check("the view event is itself visible in the console", (viewInLog.body?.events ?? []).length >= 1);

    // =====================================================================
    group("tenancy \u00b7 auth trail is org-scoped");
    // =====================================================================
    // A founding partner in ANOTHER org must not see this org's auth events.
    const ORG2 = `org_test_seclog_${STAMP}`;
    const FP2_ID = `p_test_seclog_fp2_${STAMP}`;
    const FP2_EMAIL = `test.seclog.fp2.${STAMP}@cognirise.ai`;
    const FP2_PW = `Fp2-Pw-${STAMP}-3`;
    await db.insert(atelierUsers).values([
      { id: FP2_ID, orgId: ORG2, email: FP2_EMAIL, name: "SecLog Partner Two", initials: "S2", role: "founding_partner", roleLabel: "Founding Partner", title: "Test Partner 2" },
    ]);
    await db.insert(atelierAuthCredentials).values([
      { email: FP2_EMAIL, userId: FP2_ID, passwordHash: hashPassword(FP2_PW), userManaged: true },
    ]);
    resetRate?.();
    await post("/login", { email: FP2_EMAIL, password: "wrong-password-x" });
    const fp2Login = await post("/login", { email: FP2_EMAIL, password: FP2_PW });
    const fp2Cookie = cookieOf(fp2Login.res)!;
    const fp2Auth = await get("/security-log?tab=auth&limit=100", fp2Cookie);
    const fp2Evts: any[] = fp2Auth.body?.events ?? [];
    check(
      "org2 partner sees ONLY org2 auth events",
      fp2Auth.status === 200 && fp2Evts.length > 0 && fp2Evts.every((e: any) => e.actorLabel.includes("fp2") || e.actorLabel === "SecLog Partner Two" || e.targetEmail === FP2_EMAIL),
      JSON.stringify(fp2Evts.map((e: any) => e.actorLabel)),
    );
    check(
      "org1 sign-ins invisible to org2 partner",
      !fp2Evts.some((e: any) => e.actorLabel === "SecLog Employee" || e.actorLabel === EMP_EMAIL || e.targetEmail === EMP_EMAIL),
    );
    const fp1Auth = await get("/security-log?tab=auth&limit=100", fpCookie);
    check(
      "org2 sign-ins invisible to org1 partner",
      !(fp1Auth.body?.events ?? []).some((e: any) => e.actorLabel === FP2_EMAIL || e.targetEmail === FP2_EMAIL || e.actorLabel === "SecLog Partner Two"),
    );
    const fp2Csv = await fetch(`${BASE}/security-log/export.csv?tab=auth`, { headers: { cookie: fp2Cookie } });
    const fp2CsvText = await fp2Csv.text();
    check("CSV export is org-scoped too", !fp2CsvText.includes(EMP_EMAIL) && !fp2CsvText.includes("SecLog Employee"));
    const fp2Actions = await get("/security-log?tab=actions&limit=100", fp2Cookie);
    check(
      "actions tab already org-scoped",
      (fp2Actions.body?.events ?? []).every((e: any) => !String(e.id).startsWith("audit_seclog_biz_")),
    );
    await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, FP2_ID));
    await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, FP2_EMAIL));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, FP2_ID));

    // =====================================================================
    group("business audit writers \u00b7 org stamped via RLS GUC default");
    // =====================================================================
    // Writers that omit orgId now inherit the request's RLS org through the
    // column default (current_setting('app.org_id')). Prove it at the DB
    // level: an insert WITHOUT orgId under an org2 session lands in org2.
    const gucRowId = `audit_seclog_guc_${STAMP}`;
    await db.transaction(async (tx) => {
      await tx.execute(`SELECT set_config('app.org_id', 'org2_seclog_${STAMP}', true)`);
      await tx.execute(
        `INSERT INTO atelier_audit_events (id, entity_type, entity_id, actor_type, actor_label, action, payload, payload_summary)
         VALUES ('${gucRowId}', 'account', 'acc_guc_${STAMP}', 'human', 'Org2 Actor', 'account.update', '{}'::jsonb, 'guc stamping probe')`,
      );
    });
    const [gucRow] = await db.select().from(atelierAuditEvents).where(eq(atelierAuditEvents.id, gucRowId));
    check("unstamped business write inherits the session org", gucRow?.orgId === `org2_seclog_${STAMP}`, `orgId=${gucRow?.orgId}`);
    const org1Actions = await get("/security-log?tab=actions&limit=100", fpCookie);
    check(
      "org2 business action invisible to org1 partner",
      !(org1Actions.body?.events ?? []).some((e: any) => e.id === gucRowId),
    );
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.id, gucRowId));

    // =====================================================================
    group("CSV export \u00b7 filtered, gated, audited");
    // =====================================================================
    const csv = await fetch(`${BASE}/security-log/export.csv?tab=auth&action=login_failed`, { headers: { cookie: fpCookie } });
    const csvText = await csv.text();
    check("export \u2192 200 text/csv with attachment header", csv.status === 200 && (csv.headers.get("content-type") ?? "").includes("text/csv") && (csv.headers.get("content-disposition") ?? "").includes("attachment"));
    const lines = csvText.trim().split("\n");
    check("CSV has header + only filtered rows", lines[0]!.startsWith("timestamp,action") && lines.slice(1).every((l) => l.includes("login_failed")));
    check("CSV includes the IP column data", lines.slice(1).some((l) => l.split(",")[5] !== ""));
  } finally {
    try {
      await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, EMP_ID));
      await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, FP_ID));
      await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, EMP_EMAIL));
      await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, FP_EMAIL));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, EMP_ID));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, FP_ID));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.id, `audit_seclog_biz_${STAMP}%`));
    } catch (err) {
      console.error("cleanup failed", err);
    }
    server.close();
    await pool.end();
  }

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILURE(S): ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
