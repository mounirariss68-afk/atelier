/**
 * Task #1173 — Partner portal foundations probe.
 *
 * Boots the real app in-process on an isolated scratch DB and exercises:
 *   1. Multi-login: two active logins on the SAME firm both read the portal.
 *   2. Offboard: deactivates BOTH logins (sessions revoked → 401), idempotent.
 *   3. Grant assign/revoke → partner_notifications rows (+ unreadCount).
 *   4. Notification read + read-all.
 *   5. Preview-as-partner: leadership GET opportunities/notifications for a
 *      firm (audited), writes 403, read-marking 403; non-leadership internal
 *      role 403.
 *   6. alliance_partner mobile login → 403 portal-web-only (no session).
 *   7. Partner login session TTL <= 24h (inspect atelier_auth_sessions).
 *   8. Per-user portal rate limit → 429 after a burst.
 *   9. Regression: single-login firm flows still pass.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/partner-portal-foundations-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
// Tiny rate-limit override so the burst test is fast + deterministic.
process.env.ATELIER_PORTAL_RATE_LIMIT = process.env.ATELIER_PORTAL_RATE_LIMIT ?? "8";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAuthCredentials,
    atelierAuthSessions,
    atelierPartnerFirms,
    atelierOpportunities,
    atelierAccounts,
    atelierPartnerNotifications,
    atelierAuditEvents,
    atelierPushTokens,
  } = D as any;
  const { eq, and } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const authMod = await import("../../src/routes/auth/index.js");
  const portalMod = await import("../../src/routes/atelier/partnerPortalRoutes.js");
  const { hashPassword } = await import("../../src/lib/auth/passwords.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const ROOT = `http://127.0.0.1:${port}/api`;
  const AUTH = `${ROOT}/auth`;
  const ATELIER = `${ROOT}/atelier`;

  const tag = `probe1173_${Date.now()}`;
  const PW = "Sup3r-Str0ng-Passw0rd!";

  const jreq = async (
    url: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  // Actors.
  const leadId = `u_${tag}_lead`; // founding_partner (leadership)
  const financeId = `u_${tag}_fin`; // finance (internal, NOT leadership)
  const smId = `u_${tag}_sm`; // senior_manager (grant assign/revoke leadership)

  // Firm A + two active alliance-partner logins.
  const firmAId = `pfrm_${tag}_a`;
  const userA1Id = `u_${tag}_a1`;
  const emailA1 = `${tag}_a1@example.test`;
  const userA2Id = `u_${tag}_a2`;
  const emailA2 = `${tag}_a2@example.test`;
  // Firm B — single login (regression + isolation).
  const firmBId = `pfrm_${tag}_b`;
  const userB1Id = `u_${tag}_b1`;
  const emailB1 = `${tag}_b1@example.test`;

  const oppId = `opp_${tag}`;
  const acctId = `acct_${tag}`;

  const cookieA1 = `atelier_persona=${userA1Id}`;
  const cookieA2 = `atelier_persona=${userA2Id}`;
  const cookieLead = `atelier_persona=${leadId}`;
  const cookieFin = `atelier_persona=${financeId}`;

  try {
    await db.insert(atelierUsers).values([
      { id: leadId, orgId: "aico", name: "P1173 Lead", initials: "LD", email: `${tag}_lead@example.test`, role: "founding_partner", roleLabel: "Founding Partner", title: "Partner" },
      { id: financeId, orgId: "aico", name: "P1173 Finance", initials: "FN", email: `${tag}_fin@example.test`, role: "finance", roleLabel: "Finance", title: "Finance" },
      { id: smId, orgId: "aico", name: "P1173 SM", initials: "SM", email: `${tag}_sm@example.test`, role: "senior_manager", roleLabel: "Senior Manager", title: "Senior Manager" },
      { id: userA1Id, orgId: "aico", name: "P1173 Partner A1", initials: "A1", email: emailA1, role: "alliance_partner", roleLabel: "Alliance Partner", title: "Partner", partnerFirmId: firmAId },
      { id: userA2Id, orgId: "aico", name: "P1173 Partner A2", initials: "A2", email: emailA2, role: "alliance_partner", roleLabel: "Alliance Partner", title: "Partner", partnerFirmId: firmAId },
      { id: userB1Id, orgId: "aico", name: "P1173 Partner B1", initials: "B1", email: emailB1, role: "alliance_partner", roleLabel: "Alliance Partner", title: "Partner", partnerFirmId: firmBId },
    ] as any);

    await db.insert(atelierPartnerFirms).values([
      { id: firmAId, orgId: "aico", name: `P1173 Firm A ${tag}`, partnershipStage: "agreed", agreementStage: "signed" },
      { id: firmBId, orgId: "aico", name: `P1173 Firm B ${tag}`, partnershipStage: "agreed", agreementStage: "signed" },
    ] as any);

    const pwHash = hashPassword(PW);
    await db.insert(atelierAuthCredentials).values([
      { email: emailA1, userId: userA1Id, passwordHash: pwHash, userManaged: true },
      { email: emailA2, userId: userA2Id, passwordHash: pwHash, userManaged: true },
      { email: emailB1, userId: userB1Id, passwordHash: pwHash, userManaged: true },
    ] as any);

    await db.insert(atelierAccounts).values([
      { id: acctId, orgId: "aico", name: `P1173 Acct ${tag}`, sector: "Tech", country: "AE" },
    ] as any);
    await db.insert(atelierOpportunities).values([
      {
        id: oppId, orgId: "aico", name: `P1173 Opp ${tag}`, accountId: acctId,
        salesStage: "qualify", nextMilestone: "kickoff", slug: `p1173-opp-${Date.now()}`,
        partnerOwnerId: leadId, engagementLeadId: leadId, dealSizeHypothesis: 100000,
        probabilityPct: 50, sourceLead: "probe", createdByUserId: leadId,
      },
    ] as any);

    // ---- 1. Multi-login: two active logins same firm, both read ----------
    // No grant yet → empty opportunity list, but the read must succeed.
    const readA1 = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieA1 });
    const readA2 = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieA2 });
    check("login A1 reads portal (200)", readA1.status === 200 && readA1.body?.firm?.id === firmAId, readA1);
    check("login A2 reads portal (200) — multi-login allowed", readA2.status === 200 && readA2.body?.firm?.id === firmAId, readA2);

    // ---- 3. Grant assign → notification row (+ unreadCount) --------------
    const assign = await jreq(`${ATELIER}/opportunities/${oppId}/partner-grants`, "POST", { partnerFirmId: firmAId }, { cookie: cookieLead });
    check("grant assign 201", assign.status === 201 && assign.body?.ok === true, assign);
    // Notifications are best-effort (fire after commit) but inserted synchronously.
    const notifsAfterAssign = await jreq(`${ATELIER}/partner-portal/notifications`, "GET", undefined, { cookie: cookieA1 });
    check("grant_shared notification present + unreadCount>=1", notifsAfterAssign.status === 200 && notifsAfterAssign.body?.unreadCount >= 1 && notifsAfterAssign.body?.notifications?.some((n: any) => n.kind === "grant_shared"), notifsAfterAssign.body);
    // Both logins of the firm see the same firm-wide notification.
    const notifsA2 = await jreq(`${ATELIER}/partner-portal/notifications`, "GET", undefined, { cookie: cookieA2 });
    check("firm-wide notification visible to second login", notifsA2.status === 200 && notifsA2.body?.notifications?.some((n: any) => n.kind === "grant_shared"), notifsA2.body);

    // Grant now visible in the opportunities list.
    const readGranted = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieA1 });
    check("granted opp visible after assign", readGranted.status === 200 && readGranted.body?.opportunities?.some((o: any) => o.id === oppId), readGranted.body);

    // ---- 4. Read one + read-all -----------------------------------------
    const firstNotifId = notifsAfterAssign.body?.notifications?.find((n: any) => n.kind === "grant_shared")?.id;
    const readOne = await jreq(`${ATELIER}/partner-portal/notifications/${firstNotifId}/read`, "POST", {}, { cookie: cookieA1 });
    check("mark one notification read", readOne.status === 200 && readOne.body?.ok === true, readOne);

    // ---- Revoke → grant_revoked notification ----------------------------
    const grantId = assign.body?.grantId as string;
    const revoke = await jreq(`${ATELIER}/opportunities/${oppId}/partner-grants/${grantId}/revoke`, "POST", {}, { cookie: cookieLead });
    check("grant revoke 200", revoke.status === 200 && revoke.body?.ok === true, revoke);
    const notifsAfterRevoke = await jreq(`${ATELIER}/partner-portal/notifications`, "GET", undefined, { cookie: cookieA1 });
    check("grant_revoked notification present", notifsAfterRevoke.status === 200 && notifsAfterRevoke.body?.notifications?.some((n: any) => n.kind === "grant_revoked"), notifsAfterRevoke.body);

    const readAll = await jreq(`${ATELIER}/partner-portal/notifications/read-all`, "POST", {}, { cookie: cookieA1 });
    check("mark all read", readAll.status === 200 && readAll.body?.ok === true, readAll);
    const afterReadAll = await jreq(`${ATELIER}/partner-portal/notifications`, "GET", undefined, { cookie: cookieA1 });
    check("unreadCount 0 after read-all", afterReadAll.status === 200 && afterReadAll.body?.unreadCount === 0, afterReadAll.body);

    // ---- 5. Preview-as-partner ------------------------------------------
    // Leadership GET opportunities for firm A via preview header.
    const previewOpps = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("leadership preview: GET opportunities 200", previewOpps.status === 200 && previewOpps.body?.firm?.id === firmAId, previewOpps.status);
    const previewNotifs = await jreq(`${ATELIER}/partner-portal/notifications`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("leadership preview: GET notifications 200", previewNotifs.status === 200 && Array.isArray(previewNotifs.body?.notifications), previewNotifs.status);

    // Preview audited on opportunities read.
    const previewAudit = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.action, "partner_portal.previewed"), eq(atelierAuditEvents.entityId, firmAId)));
    check("preview audited (partner_portal.previewed)", previewAudit.length >= 1, previewAudit.length);

    // Preview writes 403.
    const previewWrite = await jreq(`${ATELIER}/partner-portal/contact-suggestions`, "POST", { contacts: [{ name: "X" }] }, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("preview write → 403 preview-read-only", previewWrite.status === 403 && previewWrite.body?.error === "preview-read-only", previewWrite);
    // Preview read-marking 403.
    const previewReadAll = await jreq(`${ATELIER}/partner-portal/notifications/read-all`, "POST", {}, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("preview read-all → 403 preview-read-only", previewReadAll.status === 403 && previewReadAll.body?.error === "preview-read-only", previewReadAll);

    // Non-leadership internal role (finance) → 403 (not preview-eligible).
    const finPreview = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieFin, "x-partner-preview-firm": firmAId });
    check("non-leadership internal preview → 403", finPreview.status === 403, finPreview);

    // Leadership WITHOUT a preview firm → 403.
    const leadNoFirm = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieLead });
    check("leadership without preview firm → 403", leadNoFirm.status === 403, leadNoFirm);

    // ---- 5b. Preview covers the Contracts + Billing portal surfaces -----
    // These live in partnerBillingRoutes; leadership preview must read them.
    const previewContracts = await jreq(`${ATELIER}/partner-portal/contracts`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("leadership preview: GET contracts 200", previewContracts.status === 200, previewContracts.status);
    const previewInbox = await jreq(`${ATELIER}/partner-portal/inbox`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("leadership preview: GET inbox 200", previewInbox.status === 200, previewInbox.status);
    const previewInvoices = await jreq(`${ATELIER}/partner-portal/invoices`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("leadership preview: GET invoices 200", previewInvoices.status === 200, previewInvoices.status);
    const previewIssued = await jreq(`${ATELIER}/partner-portal/issued`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
    check("leadership preview: GET issued 200", previewIssued.status === 200, previewIssued.status);

    // Multipart POSTs must 403 in preview BEFORE any upload parsing/storage.
    const mpost = async (url: string, cookie: string, previewFirm?: string) => {
      const fd = new FormData();
      fd.append("file", new Blob([Buffer.from("%PDF-1.4 probe")], { type: "application/pdf" }), "probe.pdf");
      fd.append("amount", "100");
      fd.append("currency", "USD");
      fd.append("reference", "PROBE-1");
      const headers: Record<string, string> = { cookie };
      if (previewFirm) headers["x-partner-preview-firm"] = previewFirm;
      const res = await fetch(url, { method: "POST", headers, body: fd });
      const txt = await res.text();
      let body: any = null;
      try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
      return { status: res.status, body };
    };
    const previewInboxPost = await mpost(`${ATELIER}/partner-portal/inbox`, cookieLead, firmAId);
    check("preview POST inbox → 403 preview-read-only", previewInboxPost.status === 403 && previewInboxPost.body?.error === "preview-read-only", previewInboxPost);
    const previewInvPost = await mpost(`${ATELIER}/partner-portal/invoices`, cookieLead, firmAId);
    check("preview POST invoices → 403 preview-read-only", previewInvPost.status === 403 && previewInvPost.body?.error === "preview-read-only", previewInvPost);

    // alliance_partner sending a preview header for ANOTHER firm still only
    // sees its OWN firm (the header is ignored for partners). Reset the
    // per-user throttle so accumulated A1 hits don't 429 these reads.
    portalMod.__resetPortalRateLimit();
    const spoofContracts = await jreq(`${ATELIER}/partner-portal/contracts`, "GET", undefined, { cookie: cookieA1, "x-partner-preview-firm": firmBId });
    check("partner preview-header spoof ignored (own firm read still 200)", spoofContracts.status === 200, spoofContracts.status);
    // Confirm scoping via the opportunities surface which echoes firm.id.
    const spoofOpps = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieA1, "x-partner-preview-firm": firmBId });
    check("partner preview-header spoof → still scoped to own firm A", spoofOpps.status === 200 && spoofOpps.body?.firm?.id === firmAId, spoofOpps.body?.firm?.id);

    // ---- 6. alliance_partner mobile login → 403 (no session) ------------
    authMod.__resetAuthRateLimitForTests();
    const mobileLogin = await jreq(`${AUTH}/login`, "POST", { email: emailA1, password: PW, client: "mobile" });
    check("partner mobile login → 403 portal-web-only", mobileLogin.status === 403 && mobileLogin.body?.error === "portal-web-only", mobileLogin);
    const mobileSessions = await db.select().from(atelierAuthSessions).where(eq(atelierAuthSessions.userId, userA1Id));
    check("mobile-blocked login minted NO session", mobileSessions.length === 0, mobileSessions.length);
    const mobileBlockAudit = await db.select().from(atelierAuditEvents).where(eq(atelierAuditEvents.action, "portal_login_mobile_blocked"));
    check("mobile block audited", mobileBlockAudit.length >= 1, mobileBlockAudit.length);

    // ---- 6b. Mobile restriction is server-verifiable, not body-trusted ----
    // The client:"mobile" 403 at login is only official-app UX (the body
    // flag is client-supplied and a partner could send client:"web"). The
    // DURABLE boundary is the central gate + route guards: a partner holding
    // a normal WEB session still cannot reach ANY mobile-only device surface.
    // `cookieA1` is a genuine partner web session obtained earlier.
    portalMod.__resetPortalRateLimit();
    const pushReg = await jreq(`${ATELIER}/me/push-tokens`, "POST", { token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", platform: "ios" }, { cookie: cookieA1 });
    check(
      "partner web session CANNOT register a push token (mobile-only privilege) → 403",
      pushReg.status === 403,
      pushReg.status,
    );
    const pushTokRows = await db.select().from(atelierPushTokens).where(eq(atelierPushTokens.userId, userA1Id));
    check("no push token persisted for the partner", pushTokRows.length === 0, pushTokRows.length);
    // A representative /me/* sub-path is likewise 403 for the role — the
    // gate allows ONLY exact `/me`, so mobile bootstrap routes are unreachable.
    const meSub = await jreq(`${ATELIER}/me/push-tokens`, "DELETE", { token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }, { cookie: cookieA1 });
    check("partner web session blocked from /me/* device routes → 403", meSub.status === 403, meSub.status);

    // ---- 7. Partner login session TTL <= 24h ----------------------------
    authMod.__resetAuthRateLimitForTests();
    const webLogin = await jreq(`${AUTH}/login`, "POST", { email: emailA1, password: PW, client: "web" });
    check("partner web login 200", webLogin.status === 200 && webLogin.body?.user?.id === userA1Id, webLogin.status);
    const [sess] = await db.select().from(atelierAuthSessions).where(eq(atelierAuthSessions.userId, userA1Id));
    const ttlMs = sess ? sess.expiresAt.getTime() - sess.createdAt.getTime() : 0;
    check("partner session TTL <= 24h", !!sess && ttlMs <= 24 * 3600_000 + 60_000 && ttlMs >= 23 * 3600_000, ttlMs);

    // ---- 8. Portal per-user rate limit → 429 ----------------------------
    portalMod.__resetPortalRateLimit();
    const limit = Number(process.env.ATELIER_PORTAL_RATE_LIMIT);
    let got429 = false;
    for (let i = 0; i < limit + 3; i++) {
      const r = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieA1 });
      if (r.status === 429) { got429 = true; break; }
    }
    check("portal rate limit → 429 after burst", got429, { limit });
    // Preview (internal) is exempt from the throttle.
    portalMod.__resetPortalRateLimit();
    let previewNever429 = true;
    for (let i = 0; i < limit + 3; i++) {
      const r = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
      if (r.status === 429) { previewNever429 = false; break; }
    }
    check("preview (internal) exempt from portal throttle", previewNever429, {});
    portalMod.__resetPortalRateLimit();

    // ---- 8b. Throttle ALSO covers the billing router (/contracts etc.) --
    // Regression: the throttle is mounted on the common parent BEFORE both
    // portal routers, so partnerBillingRoutes GETs (incl. what fronts the
    // multipart upload paths) are rate-limited, not just the opps router.
    portalMod.__resetPortalRateLimit();
    let billingGot429 = false;
    for (let i = 0; i < limit + 3; i++) {
      const r = await jreq(`${ATELIER}/partner-portal/contracts`, "GET", undefined, { cookie: cookieA1 });
      if (r.status === 429) { billingGot429 = true; break; }
    }
    check("billing-router GET throttled → 429 after burst", billingGot429, { limit });
    // Preview stays exempt on the billing router too.
    portalMod.__resetPortalRateLimit();
    let billingPreviewNever429 = true;
    for (let i = 0; i < limit + 3; i++) {
      const r = await jreq(`${ATELIER}/partner-portal/contracts`, "GET", undefined, { cookie: cookieLead, "x-partner-preview-firm": firmAId });
      if (r.status === 429) { billingPreviewNever429 = false; break; }
    }
    check("preview exempt on billing router too", billingPreviewNever429, {});
    portalMod.__resetPortalRateLimit();

    // ---- 2. Offboard: deactivates BOTH logins (sessions revoked) --------
    // A1 has a live web session from step 7 (in atelier_auth_sessions).
    const offboard = await jreq(`${ATELIER}/partners/firms/${firmAId}/offboard`, "POST", {}, { cookie: cookieLead });
    check("offboard 200, deactivated 2", offboard.status === 200 && offboard.body?.deactivated === 2, offboard);
    const stillActive = await db
      .select()
      .from(atelierUsers)
      .where(and(eq(atelierUsers.partnerFirmId, firmAId), eq(atelierUsers.role, "alliance_partner")));
    const activeCount = stillActive.filter((u: any) => u.deletedAt == null).length;
    check("both firm A logins deactivated", activeCount === 0, activeCount);
    const sessionsGone = await db.select().from(atelierAuthSessions).where(eq(atelierAuthSessions.userId, userA1Id));
    check("offboard revoked A1 sessions", sessionsGone.length === 0, sessionsGone.length);
    // Idempotent re-run.
    const offboard2 = await jreq(`${ATELIER}/partners/firms/${firmAId}/offboard`, "POST", {}, { cookie: cookieLead });
    check("offboard idempotent (deactivated 0)", offboard2.status === 200 && offboard2.body?.deactivated === 0, offboard2);

    // Deactivated login can no longer read (persona resolution drops deleted users → 401).
    const afterOffboardRead = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieA1 });
    check("deactivated login read → 401", afterOffboardRead.status === 401, afterOffboardRead.status);

    // ---- 9. Regression: single-login firm B still works -----------------
    portalMod.__resetPortalRateLimit();
    const cookieB1 = `atelier_persona=${userB1Id}`;
    const readB1 = await jreq(`${ATELIER}/partner-portal/opportunities`, "GET", undefined, { cookie: cookieB1 });
    check("regression: single-login firm B reads portal", readB1.status === 200 && readB1.body?.firm?.id === firmBId, readB1.status);
    // Firm B unaffected by firm A offboard.
    const [firmBUser] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, userB1Id));
    check("regression: firm B login untouched by firm A offboard", firmBUser?.deletedAt == null, firmBUser?.deletedAt);
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll partner-portal-foundations checks passed.");
}

main().catch((err) => {
  console.error("PROBE CRASHED", err);
  process.exit(1);
});
