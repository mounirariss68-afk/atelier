/**
 * Task #336 — Microsoft 365 meeting auto-log probe (no real Microsoft, no LLM).
 *
 * Covers:
 *   - POST /me/calendar/autolog/run: ended meeting with a matched contact →
 *     one "meeting" activity on the account + ledger row + audit event
 *   - upcoming / all-day / cancelled / internal-only meetings are skipped
 *   - re-run → no duplicate entry (ledger dedupe)
 *   - GET /me/calendar/autolog: lists the entry with account name
 *   - DELETE /me/calendar/autolog/:id: soft-deletes the activity, marks the
 *     ledger row removed; re-run does NOT re-log; delete is idempotent
 *   - another user cannot see or remove my entries
 *
 * Deterministic — Microsoft is a local HTTP stub via MS_LOGIN_BASE_URL /
 * MS_GRAPH_BASE_URL; AI summary env is cleared so bodies are metadata-only.
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/ms-autolog-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import http from "node:http";
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
    atelierAccounts,
    atelierContacts,
    atelierMsConnections,
    atelierMsMeetingLogs,
    atelierActivities,
    atelierAuditEvents,
  } = D;
  const { eq, and } = await import("drizzle-orm");

  process.env.MS_TOKEN_ENC_SECRET = "probe-enc-secret";
  process.env.MS_CLIENT_ID = "stub-client";
  process.env.MS_TENANT_ID = "stub-tenant";
  process.env.MS_CLIENT_SECRET = "stub-secret";

  const gm = await import("../../src/lib/msGraph.js");

  // ---- Microsoft stub: token refresh + calendarView with mixed events ----
  const NOW = Date.now();
  const iso = (t: number) => new Date(t).toISOString().replace(/Z$/, "");
  const stub = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url.includes("/oauth2/v2.0/token")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "stub-access",
          refresh_token: "stub-refresh-2",
          expires_in: 3600,
          scope: "Calendars.Read User.Read",
        }),
      );
      return;
    }
    if (url.startsWith("/me/calendarView")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          value: [
            {
              // ENDED client meeting → should be logged
              id: "evt_done",
              subject: "QBR with Tasama",
              isAllDay: false,
              start: { dateTime: iso(NOW - 2 * 3600e3), timeZone: "UTC" },
              end: { dateTime: iso(NOW - 1 * 3600e3), timeZone: "UTC" },
              attendees: [
                { emailAddress: { address: "probe.autolog@tasama.test", name: "Probe Contact" } },
                { emailAddress: { address: "random@nowhere.test", name: "Random" } },
              ],
              organizer: { emailAddress: { address: "me@cognirise.ai" } },
              location: { displayName: "Teams" },
            },
            {
              // Still upcoming → skipped
              id: "evt_future",
              subject: "Next week planning",
              isAllDay: false,
              start: { dateTime: iso(NOW + 3600e3), timeZone: "UTC" },
              end: { dateTime: iso(NOW + 7200e3), timeZone: "UTC" },
              attendees: [
                { emailAddress: { address: "probe.autolog@tasama.test" } },
              ],
              organizer: { emailAddress: { address: "me@cognirise.ai" } },
            },
            {
              // Ended but internal-only → skipped
              id: "evt_internal",
              subject: "Internal sync",
              isAllDay: false,
              start: { dateTime: iso(NOW - 4 * 3600e3), timeZone: "UTC" },
              end: { dateTime: iso(NOW - 3.5 * 3600e3), timeZone: "UTC" },
              attendees: [{ emailAddress: { address: "colleague@cognirise.ai" } }],
              organizer: { emailAddress: { address: "me@cognirise.ai" } },
            },
            {
              // Ended all-day → skipped
              id: "evt_allday",
              subject: "Conference day",
              isAllDay: true,
              start: { dateTime: iso(NOW - 30 * 3600e3), timeZone: "UTC" },
              end: { dateTime: iso(NOW - 6 * 3600e3), timeZone: "UTC" },
              attendees: [
                { emailAddress: { address: "probe.autolog@tasama.test" } },
              ],
            },
            {
              // Cancelled → skipped
              id: "evt_cancelled",
              subject: "Cancelled call",
              isCancelled: true,
              start: { dateTime: iso(NOW - 3 * 3600e3), timeZone: "UTC" },
              end: { dateTime: iso(NOW - 2.5 * 3600e3), timeZone: "UTC" },
              attendees: [
                { emailAddress: { address: "probe.autolog@tasama.test" } },
              ],
            },
          ],
        }),
      );
      return;
    }
    if (req.method === "POST" && url.includes("/v1/messages")) {
      // Anthropic stub — deterministic AI recap.
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_stub",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "Stub AI recap of the client meeting." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.MS_LOGIN_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.MS_GRAPH_BASE_URL = `http://127.0.0.1:${stubPort}`;
  // Stub the Anthropic proxy too: the app refuses to boot without these,
  // and it lets the probe assert the AI-summary path deterministically.
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "stub-anthropic-key";

  // ---- app ----
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const runTag = `probe336_${Date.now()}`;
  const userId = `u_${runTag}`;
  const otherId = `u2_${runTag}`;
  const accId = `acc_${runTag}`;
  const contactId = `ct_${runTag}`;

  const api = async (method: string, path: string, asUser = userId) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie: `atelier_persona=${asUser}` },
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

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe AutologUser",
      initials: "PA",
      email: `${runTag}@cognirise.ai`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierUsers).values({
      id: otherId,
      orgId: "aico",
      name: "Probe OtherUser",
      initials: "PO",
      email: `${runTag}.other@cognirise.ai`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: accId,
      orgId: "aico",
      name: `Tasama Autolog ${runTag}`,
      country: "AE",
      sector: "Logistics",
      tier: "C",
      status: "active",
    } as any);
    await db.insert(atelierContacts).values({
      id: contactId,
      orgId: "aico",
      accountId: accId,
      fullName: "Probe Contact",
      email: "probe.autolog@tasama.test",
    } as any);
    await db.insert(atelierMsConnections).values({
      id: `msc_${runTag}`,
      orgId: "aico",
      userId,
      msEmail: "me@cognirise.ai",
      msOid: "ms-oid-336",
      msDisplayName: "Probe User",
      encRefreshToken: gm.encryptToken("stub-refresh-1"),
      scopes: ["Calendars.Read"],
    } as any);

    // ---- not connected → 400 for the other user ----
    const notConn = await api("POST", "/me/calendar/autolog/run", otherId);
    check("run without connection → 400 not-connected", notConn.status === 400 && notConn.body?.error === "not-connected", notConn);

    // ---- first run: exactly one entry from evt_done ----
    const run1 = await api("POST", "/me/calendar/autolog/run");
    check("run 200", run1.status === 200 && run1.body?.ok === true, run1);
    check("one entry created", run1.body?.entriesCreated === 1, run1.body);

    const acts = await db
      .select()
      .from(atelierActivities)
      .where(and(eq(atelierActivities.accountId, accId), eq(atelierActivities.type, "meeting")));
    check("meeting activity on account", acts.length === 1, acts.length);
    const act = acts[0];
    check("activity title from subject", act?.title === "Meeting: QBR with Tasama", act?.title);
    check("activity done + completed at meeting end", act?.status === "done" && Boolean(act?.completedAt), act?.status);
    check("activity owned by calendar user", act?.ownerId === userId && act?.createdByUserId === userId);
    check(
      "body carries metadata (contact, duration, auto-log note)",
      Boolean(act?.body?.includes("Probe Contact")) &&
        Boolean(act?.body?.includes("60 min")) &&
        Boolean(act?.body?.includes("Auto-logged from Microsoft 365.")),
      act?.body,
    );
    check(
      "AI recap prepended to body",
      Boolean(act?.body?.startsWith("Stub AI recap of the client meeting.")),
      act?.body?.slice(0, 60),
    );

    const ledger = await db
      .select()
      .from(atelierMsMeetingLogs)
      .where(eq(atelierMsMeetingLogs.userId, userId));
    check("one ledger row", ledger.length === 1, ledger.length);
    check(
      "ledger row links activity + event + account",
      ledger[0]?.msEventId === "evt_done" && ledger[0]?.accountId === accId && ledger[0]?.activityId === act?.id,
      ledger[0],
    );
    check("summarySource ai (stubbed Anthropic)", ledger[0]?.summarySource === "ai", ledger[0]?.summarySource);

    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.action, "ms.meeting.autologged"));
    check(
      "audit event written",
      audits.some((a) => a.entityId === act?.id),
      audits.length,
    );

    // ---- second run: dedupe ----
    const run2 = await api("POST", "/me/calendar/autolog/run");
    check("re-run creates nothing", run2.status === 200 && run2.body?.entriesCreated === 0, run2.body);
    const acts2 = await db
      .select()
      .from(atelierActivities)
      .where(and(eq(atelierActivities.accountId, accId), eq(atelierActivities.type, "meeting")));
    check("still one activity", acts2.length === 1, acts2.length);

    // ---- list ----
    const list = await api("GET", "/me/calendar/autolog");
    check(
      "list shows the entry with account name",
      list.status === 200 &&
        list.body?.entries?.length === 1 &&
        list.body.entries[0].subject === "QBR with Tasama" &&
        list.body.entries[0].accountName.includes("Tasama Autolog"),
      list.body,
    );
    const logId = list.body.entries[0].id as string;

    // ---- other user sees nothing / cannot remove mine ----
    const otherList = await api("GET", "/me/calendar/autolog", otherId);
    check("other user's list empty", otherList.body?.entries?.length === 0, otherList.body);
    const otherDel = await api("DELETE", `/me/calendar/autolog/${logId}`, otherId);
    check("other user cannot remove my entry", otherDel.status === 404, otherDel);

    // ---- remove ----
    const del = await api("DELETE", `/me/calendar/autolog/${logId}`);
    check("remove ok", del.status === 200 && del.body?.removed === true, del.body);
    const [actAfter] = await db
      .select()
      .from(atelierActivities)
      .where(eq(atelierActivities.id, act!.id));
    check("activity soft-deleted", Boolean(actAfter?.deletedAt), actAfter?.deletedAt);
    const [ledgerAfter] = await db
      .select()
      .from(atelierMsMeetingLogs)
      .where(eq(atelierMsMeetingLogs.id, logId));
    check("ledger row marked removed (kept)", ledgerAfter?.status === "removed" && Boolean(ledgerAfter?.removedAt), ledgerAfter?.status);

    const removeAudit = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.action, "ms.meeting.autolog_removed"));
    check("removal audited", removeAudit.length >= 1, removeAudit.length);

    // ---- removed entries never come back ----
    const run3 = await api("POST", "/me/calendar/autolog/run");
    check("run after removal re-logs nothing", run3.body?.entriesCreated === 0, run3.body);
    const list2 = await api("GET", "/me/calendar/autolog");
    check("list empty after removal", list2.body?.entries?.length === 0, list2.body);

    // ---- idempotent delete ----
    const del2 = await api("DELETE", `/me/calendar/autolog/${logId}`);
    check("second delete idempotent", del2.status === 200 && del2.body?.removed === false, del2.body);
  } finally {
    await db.delete(atelierMsMeetingLogs).where(eq(atelierMsMeetingLogs.userId, userId)).catch(() => {});
    await db.delete(atelierActivities).where(eq(atelierActivities.accountId, accId)).catch(() => {});
    await db.delete(atelierMsConnections).where(eq(atelierMsConnections.userId, userId)).catch(() => {});
    await db.delete(atelierContacts).where(eq(atelierContacts.id, contactId)).catch(() => {});
    await db.delete(atelierAccounts).where(eq(atelierAccounts.id, accId)).catch(() => {});
    await db.delete(atelierUsers).where(eq(atelierUsers.id, userId)).catch(() => {});
    await db.delete(atelierUsers).where(eq(atelierUsers.id, otherId)).catch(() => {});
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`✗ ms-autolog-probe: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("✓ ms-autolog-probe: all checks passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
