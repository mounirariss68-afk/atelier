/**
 * Task #605 — LIVE end-to-end check of the Outlook out-of-office sync
 * against a real connected Microsoft 365 account (gokhan@cognirise.ai).
 *
 * Flow:
 *   1. Gökhan (founding partner) submits leave via POST /me/leave — partner
 *      tier auto-approves and fires applyLeaveOoo with HIS live connection.
 *   2. Poll the leave row for ms_oof_event_id, then read the event straight
 *      from Microsoft Graph (showAs=oof, subject, dates).
 *   3. Read /me/mailboxSettings automaticRepliesSetting (if scope granted)
 *      and check our scheduled reply + hidden marker.
 *   4. Mounir revokes via POST /roster/leave-requests/:id/revoke; verify the
 *      Graph event is gone and the auto-reply is disabled/untouched.
 *   5. Self-cleaning: deletes the leave row; best-effort deletes any leftover
 *      Graph event.
 *
 * Uses a FUTURE window (+21 → +22 days) so the scheduled auto-reply never
 * actively sends mail during the test.
 */
process.env.NODE_ENV = "test";

const GOKHAN = "p_gokhan_guney";
const MOUNIR = "p_mounir_ariss";

async function main() {
  const appMod = await import("../src/app.js");
  const app: any = (appMod as any).default ?? (appMod as any).app;
  const D: any = await import("@workspace/db");
  const { db, pool, atelierLeaveRequests, atelierMsConnections, atelierAuditEvents } = D;
  const { eq, and, desc } = await import("drizzle-orm");
  const { freshAccessToken } = await import("../src/lib/msScheduling.js");
  const { hasMailboxSettingsScope } = await import("../src/lib/msGraph.js");
  const { OOO_REPLY_MARKER } = await import("../src/lib/atelierLeaveOoo.js");

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const gHdrs = { cookie: `atelier_persona=${GOKHAN}`, "content-type": "application/json" };
  const mHdrs = { cookie: `atelier_persona=${MOUNIR}`, "content-type": "application/json" };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  const plus = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const startDate = plus(21);
  const endDate = plus(22);

  const GRAPH = "https://graph.microsoft.com/v1.0";
  let leaveId: string | null = null;
  let eventId: string | null = null;
  let token: string | null = null;

  const graphGet = async (path: string) => {
    const r = await fetch(`${GRAPH}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
  };

  try {
    // ---- 1. Submit leave as Gökhan (auto-approved for partner tier) ----
    let r = await fetch(`${base}/me/leave`, {
      method: "POST",
      headers: gHdrs,
      body: JSON.stringify({ leaveType: "annual", startDate, endDate, note: "T605 live OOO verification — will be revoked immediately" }),
    });
    let j: any = await r.json();
    leaveId = j?.request?.id ?? null;
    check("leave submitted + auto-approved", r.status === 201 && j?.request?.status === "approved", { s: r.status, j });
    if (!leaveId) throw new Error("no leave id — aborting");

    // ---- 2. Poll for ms_oof_event_id (fire-and-forget apply) ----
    for (let i = 0; i < 30 && !eventId; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      const [row] = await db.select().from(atelierLeaveRequests).where(eq(atelierLeaveRequests.id, leaveId));
      eventId = row?.msOofEventId ?? null;
    }
    check("OOF event id stored on leave row", !!eventId, { leaveId });

    // Audit trail from the apply
    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityType, "leave_request"), eq(atelierAuditEvents.entityId, leaveId)))
      .orderBy(desc(atelierAuditEvents.createdAt));
    const applied = audits.find((a: any) => a.action === "leave.ooo.applied");
    console.log("audit leave.ooo.applied payload:", JSON.stringify(applied?.payload ?? null));
    check("leave.ooo.applied audited", !!applied, { actions: audits.map((a: any) => a.action) });

    // ---- 3. Verify live in Graph with Gökhan's own token ----
    const [conn] = await db
      .select()
      .from(atelierMsConnections)
      .where(eq(atelierMsConnections.userId, GOKHAN));
    const fresh = await freshAccessToken(conn);
    token = fresh.accessToken;
    console.log("live scopes:", JSON.stringify(fresh.scopes));
    const mailboxScope = hasMailboxSettingsScope(fresh.scopes);
    console.log("mailboxSettings scope granted:", mailboxScope);

    if (eventId) {
      const ev = await graphGet(`/me/events/${encodeURIComponent(eventId)}?$select=subject,showAs,isAllDay,start,end`);
      check("Graph event exists after approve", ev.status === 200, ev);
      check(
        "Graph event is all-day OOF with expected subject/dates",
        ev.json?.showAs === "oof" &&
          ev.json?.isAllDay === true &&
          String(ev.json?.subject ?? "").startsWith("Out of office") &&
          String(ev.json?.start?.dateTime ?? "").startsWith(startDate),
        ev.json,
      );
    }

    if (mailboxScope) {
      const mb = await graphGet(`/me/mailboxSettings?$select=automaticRepliesSetting`);
      const ar = mb.json?.automaticRepliesSetting ?? {};
      console.log("automaticReplies after approve:", JSON.stringify({ status: ar.status, start: ar.scheduledStartDateTime, end: ar.scheduledEndDateTime }));
      check("auto-reply scheduled after approve", mb.status === 200 && ar.status === "scheduled", { s: mb.status, ar });
      check("auto-reply carries our marker", String(ar.internalReplyMessage ?? "").includes(OOO_REPLY_MARKER), {});
      check("auto-reply window starts on leave start", String(ar.scheduledStartDateTime?.dateTime ?? "").startsWith(startDate), { start: ar.scheduledStartDateTime });
    } else {
      console.log("SKIP auto-reply live check — MailboxSettings scope not granted on this connection (audit shows:", JSON.stringify(applied?.payload), ")");
      check("apply degraded gracefully without mailbox scope", (applied?.payload as any)?.autoReply === "no-scope", { payload: applied?.payload });
    }

    // ---- 4. Revoke as Mounir; verify removal live ----
    r = await fetch(`${base}/roster/leave-requests/${leaveId}/revoke`, { method: "POST", headers: mHdrs, body: "{}" });
    j = await r.json();
    check("revoke accepted", r.status === 200, { s: r.status, j });

    // Poll for the fire-and-forget clear (event id nulled on the row)
    let cleared = false;
    for (let i = 0; i < 30 && !cleared; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      const [row] = await db.select().from(atelierLeaveRequests).where(eq(atelierLeaveRequests.id, leaveId));
      cleared = row ? row.msOofEventId == null && row.status === "cancelled" : false;
    }
    check("leave cancelled + event id cleared on row", cleared, { leaveId });

    if (eventId) {
      const ev2 = await graphGet(`/me/events/${encodeURIComponent(eventId)}?$select=subject`);
      check("Graph event gone after revoke (404)", ev2.status === 404, ev2);
      if (ev2.status === 404) eventId = null; // nothing left to clean
    }

    if (mailboxScope) {
      const mb2 = await graphGet(`/me/mailboxSettings?$select=automaticRepliesSetting`);
      const ar2 = mb2.json?.automaticRepliesSetting ?? {};
      console.log("automaticReplies after revoke:", JSON.stringify({ status: ar2.status }));
      check("auto-reply disabled after revoke", ar2.status === "disabled", { ar2 });
    }

    const audits2 = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityType, "leave_request"), eq(atelierAuditEvents.entityId, leaveId)));
    check("leave.ooo.cleared audited", audits2.some((a: any) => a.action === "leave.ooo.cleared"), { actions: audits2.map((a: any) => a.action) });
  } finally {
    // ---- 5. Cleanup: best-effort delete leftover Graph event, then rows ----
    try {
      if (eventId && token) {
        await fetch(`${GRAPH}/me/events/${encodeURIComponent(eventId)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
        console.log("cleanup: deleted leftover Graph event");
      }
    } catch { /* best effort */ }
    if (leaveId) {
      await db.delete(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityType, "leave_request"), eq(atelierAuditEvents.entityId, leaveId)));
      await db.delete(atelierLeaveRequests).where(eq(atelierLeaveRequests.id, leaveId));
      console.log("cleanup: removed leave + audit rows");
    }
    server.close();
    await pool.end().catch(() => undefined);
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(1);
});
