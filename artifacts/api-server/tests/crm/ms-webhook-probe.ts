/**
 * Task #629 — Graph webhook + delta-sync calendar cache probe (no real
 * Microsoft).
 *
 * Covers:
 *   - webhook validation handshake: POST ?validationToken=... → text echo
 *   - ensureCalendarSubscription: creates a Graph subscription via stub,
 *     persists row with clientState
 *   - runCalendarDeltaSync full sync: events cached, deltaLink stored
 *   - GET /me/calendar served FROM CACHE (no live calendarView call)
 *   - webhook notification (valid clientState) → incremental delta round:
 *     tombstone removes cached row + soft-cancels the matching Atelier
 *     internal meeting (organizer mailbox); changedAt bumped
 *   - webhook with WRONG clientState → dropped (no sync round)
 *   - GET /me/calendar/changed returns the changedAt signal
 *   - removeCalendarSubscription: sub + cache + sync-state rows deleted
 *
 * Deterministic — Microsoft is a local HTTP stub via MS_LOGIN_BASE_URL /
 * MS_GRAPH_BASE_URL. Run: NODE_ENV=test pnpm exec tsx tests/crm/ms-webhook-probe.ts
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => Promise<boolean>, ms = 6000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cond()) return true;
    await sleep(150);
  }
  return cond();
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierMeetings,
    atelierMsConnections,
    atelierMsCalEvents,
    atelierMsCalSubscriptions,
    atelierMsCalSyncState,
  } = D;
  const { eq, and } = await import("drizzle-orm");

  // ---- MS env BEFORE anything evaluates msConfigured() ----
  process.env.MS_TOKEN_ENC_SECRET = "probe-enc-secret";
  process.env.MS_CLIENT_ID = "stub-client";
  process.env.MS_TENANT_ID = "stub-tenant";
  process.env.MS_CLIENT_SECRET = "stub-secret";
  process.env.MS_WEBHOOK_PUBLIC_URL = "https://probe.example.test/api/ms/calendar/webhook";

  const NOW = Date.now();
  const iso = (offsetMs: number) =>
    new Date(NOW + offsetMs).toISOString().replace(/Z$/, "");

  // ---- Microsoft stub ----
  // deltaQueue: pages served for INCREMENTAL rounds ($deltatoken URLs).
  // Full-sync rounds (startDateTime URLs) always serve the seed page.
  let graphBase = ""; // filled in after listen
  let deltaQueue: Array<Record<string, unknown>> = [];
  let fullSyncCalls = 0;
  let incrementalCalls = 0;
  let liveCalendarViewCalls = 0;
  const authoritativeEvents = new Map<string, Record<string, unknown>>();
  const seedEvents = [
    {
      id: "evt-keep",
      iCalUId: "uid-keep",
      subject: "Client sync",
      start: { dateTime: iso(3600e3), timeZone: "UTC" },
      end: { dateTime: iso(7200e3), timeZone: "UTC" },
      attendees: [],
      organizer: { emailAddress: { address: "me@cognirise.ai" } },
    },
    {
      id: "evt-doomed",
      iCalUId: "uid-doomed",
      subject: "Meeting to be cancelled",
      start: { dateTime: iso(2 * 86400e3), timeZone: "UTC" },
      end: { dateTime: iso(2 * 86400e3 + 3600e3), timeZone: "UTC" },
      attendees: [],
      organizer: { emailAddress: { address: "me@cognirise.ai" } },
    },
    {
      id: "friday-1",
      iCalUId: "uid-friday-series",
      seriesMasterId: "friday-master",
      type: "occurrence",
      start: { dateTime: iso(4 * 86400e3), timeZone: "UTC" },
      end: { dateTime: iso(4 * 86400e3 + 3600e3), timeZone: "UTC" },
      attendees: [],
    },
    {
      id: "friday-2",
      iCalUId: "uid-friday-series",
      seriesMasterId: "friday-master",
      type: "occurrence",
      subject: "Friday leadership sync",
      start: { dateTime: iso(11 * 86400e3), timeZone: "UTC" },
      end: { dateTime: iso(11 * 86400e3 + 3600e3), timeZone: "UTC" },
      attendees: [],
    },
  ];
  authoritativeEvents.set("friday-master", {
    id: "friday-master",
    type: "seriesMaster",
    subject: "Friday leadership sync",
  });
  authoritativeEvents.set("friday-1", {
    id: "friday-1",
    iCalUId: "uid-friday-series",
    seriesMasterId: "friday-master",
    type: "occurrence",
    start: { dateTime: iso(4 * 86400e3), timeZone: "UTC" },
    end: { dateTime: iso(4 * 86400e3 + 3600e3), timeZone: "UTC" },
    attendees: [],
  });
  const stub = http.createServer((req, res) => {
    const url = req.url ?? "";
    const json = (body: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url.includes("/oauth2/v2.0/token")) {
      json({
        access_token: "stub-access",
        refresh_token: "stub-refresh-next",
        expires_in: 3600,
        scope: "Calendars.Read Calendars.ReadWrite User.Read",
      });
      return;
    }
    if (req.method === "POST" && url.startsWith("/subscriptions")) {
      json({
        id: "graph-sub-1",
        resource: "/me/events",
        expirationDateTime: new Date(NOW + 60 * 3600e3).toISOString(),
      });
      return;
    }
    if (req.method === "PATCH" && url.startsWith("/subscriptions/")) {
      json({
        id: "graph-sub-1",
        expirationDateTime: new Date(NOW + 60 * 3600e3).toISOString(),
      });
      return;
    }
    if (req.method === "DELETE" && url.startsWith("/subscriptions/")) {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.startsWith("/me/calendarView/delta")) {
      if (url.includes("%24deltatoken") || url.includes("$deltatoken")) {
        incrementalCalls += 1;
        const page = deltaQueue.shift() ?? { value: [] };
        json({
          ...page,
          "@odata.deltaLink": `${graphBase}/me/calendarView/delta?$deltatoken=t${incrementalCalls + 1}`,
        });
      } else {
        fullSyncCalls += 1;
        json({
          value: seedEvents,
          "@odata.deltaLink": `${graphBase}/me/calendarView/delta?$deltatoken=t1`,
        });
      }
      return;
    }
    if (url.startsWith("/me/calendars")) {
      json({ value: [] }); // no holiday calendars in this probe
      return;
    }
    if (url.startsWith("/me/events/")) {
      const id = decodeURIComponent(url.slice("/me/events/".length).split("?")[0] ?? "");
      const event = authoritativeEvents.get(id);
      if (!event) {
        res.statusCode = 404;
        json({ error: { code: "ErrorItemNotFound" } });
      } else {
        json(event);
      }
      return;
    }
    if (url.startsWith("/me/calendarView")) {
      // LIVE (non-delta) calendar read — the cache should make this
      // unnecessary once populated.
      liveCalendarViewCalls += 1;
      json({ value: [] });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  graphBase = `http://127.0.0.1:${stubPort}`;
  process.env.MS_LOGIN_BASE_URL = graphBase;
  process.env.MS_GRAPH_BASE_URL = graphBase;

  // ---- app + sync lib (import AFTER env is set) ----
  const gm = await import("../../src/lib/msGraph.js");
  const sync = await import("../../src/lib/msCalendarSync.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const ROOT = `http://127.0.0.1:${port}`;
  const BASE = `${ROOT}/api/atelier`;

  const runTag = `probe629_${Date.now()}`;
  const userId = `u_${runTag}`;
  const meetingId = `mtg_${runTag}`;
  const cookie = `atelier_persona=${userId}`;

  const api = async (method: string, path: string) => {
    const res = await fetch(`${BASE}${path}`, { method, headers: { cookie } });
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
    // ---- seed user + MS connection (directly — connect flow is covered
    // by ms-calendar-probe) ----
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe WebhookUser",
      initials: "PW",
      email: `${runTag}@cognirise.ai`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierMsConnections).values({
      id: `msc_${runTag}`,
      orgId: "aico",
      userId,
      msOid: "ms-oid-629",
      msDisplayName: "Probe WebhookUser",
      msEmail: "me@cognirise.ai",
      encRefreshToken: gm.encryptToken("stub-refresh-0"),
      scopes: "Calendars.Read Calendars.ReadWrite User.Read",
    } as any);

    // ---- 1. validation handshake ----
    const vres = await fetch(`${ROOT}/api/ms/calendar/webhook?validationToken=tok-629`, {
      method: "POST",
    });
    const vtxt = await vres.text();
    check(
      "validation handshake echoes token as text/plain",
      vres.status === 200 &&
        vtxt === "tok-629" &&
        (vres.headers.get("content-type") ?? "").includes("text/plain"),
      { status: vres.status, vtxt },
    );

    // ---- 2. subscription creation ----
    const [conn] = await db
      .select()
      .from(atelierMsConnections)
      .where(eq(atelierMsConnections.userId, userId));
    const ensured = await sync.ensureCalendarSubscription(conn);
    check("ensureCalendarSubscription ok", ensured.ok === true, ensured);
    const [sub] = await db
      .select()
      .from(atelierMsCalSubscriptions)
      .where(eq(atelierMsCalSubscriptions.userId, userId));
    check(
      "subscription row persisted with clientState",
      Boolean(sub) && sub.subscriptionId === "graph-sub-1" && sub.clientState.length >= 32,
      sub,
    );
    const ensured2 = await sync.ensureCalendarSubscription(conn);
    check("second ensure is a no-op (still ok)", ensured2.ok === true, ensured2);

    // ---- 3. full delta sync populates the cache ----
    const full = await sync.runCalendarDeltaSync(userId, "probe-initial");
    check("initial sync is a FULL sync", (full as any).ok === true && (full as any).full === true, full);
    const cached = await db
      .select()
      .from(atelierMsCalEvents)
      .where(eq(atelierMsCalEvents.userId, userId));
    check(
      "seed events and recurring occurrences cached",
      cached.length === 4 &&
        new Set(cached.map((c) => c.msEventId)).size === 4 &&
        cached.every((c) => c.source === "calendar"),
      cached.map((c) => c.msEventId),
    );
    const [state1] = await db
      .select()
      .from(atelierMsCalSyncState)
      .where(eq(atelierMsCalSyncState.userId, userId));
    check(
      "sync state has deltaLink + changedAt",
      Boolean(state1?.deltaLink?.includes("$deltatoken=t1")) && Boolean(state1?.changedAt),
      state1,
    );
    const fridayInitial = cached.find((c) => c.msEventId === "friday-1");
    check(
      "full sync resolves recurring occurrence subject from series master",
      (fridayInitial?.payload as any)?.subject === "Friday leadership sync",
      fridayInitial?.payload,
    );

    // ---- 4. GET /me/calendar served from cache ----
    const liveBefore = liveCalendarViewCalls;
    const cal = await api("GET", "/me/calendar");
    const calIds = (cal.body?.meetings ?? []).map((m: any) => m.id);
    check(
      "calendar read returns cached events",
      cal.status === 200 &&
        cal.body?.connected === true &&
        calIds.includes("evt-keep") &&
        calIds.includes("evt-doomed"),
      { status: cal.status, calIds },
    );
    check(
      "calendar read did NOT hit live Graph calendarView",
      liveCalendarViewCalls === liveBefore,
      { liveBefore, liveCalendarViewCalls },
    );

    // ---- 5. changed signal ----
    const ch1 = await api("GET", "/me/calendar/changed");
    check(
      "changed endpoint returns ISO changedAt",
      ch1.status === 200 && typeof ch1.body?.changedAt === "string",
      ch1,
    );

    // ---- 6. webhook notification → incremental sync: tombstone removes,
    // sparse updates preserve fields, and one occurrence changes in isolation
    //         cached row + soft-cancels the Atelier internal meeting ----
    await db.insert(atelierMeetings).values({
      id: meetingId,
      orgId: "aico",
      parentType: "internal",
      parentId: "internal",
      kind: "internal",
      title: "Meeting to be cancelled",
      date: new Date(NOW + 2 * 86400e3).toISOString().slice(0, 10),
      startAt: new Date(NOW + 2 * 86400e3),
      endAt: new Date(NOW + 2 * 86400e3 + 3600e3),
      msEventId: "evt-doomed",
      msEventUid: "uid-doomed",
      status: "scheduled",
      createdByUserId: userId, // organizer mailbox — cancellation allowed
      internalAttendees: [],
    } as any);

    deltaQueue = [
      {
        value: [
          { id: "evt-doomed", "@removed": { reason: "deleted" } },
          {
            id: "evt-keep",
            iCalUId: "uid-keep",
            start: { dateTime: iso(2 * 3600e3), timeZone: "UTC" },
            end: { dateTime: iso(3 * 3600e3), timeZone: "UTC" },
          },
          {
            id: "friday-1",
            iCalUId: "uid-friday-series",
            seriesMasterId: "friday-master",
            subject: "Friday leadership sync — revised",
            start: { dateTime: iso(4 * 86400e3 + 2 * 3600e3), timeZone: "UTC" },
            end: { dateTime: iso(4 * 86400e3 + 3 * 3600e3), timeZone: "UTC" },
          },
        ],
      },
    ];
    const changedBefore = state1!.changedAt.getTime();
    const notif = await fetch(`${ROOT}/api/ms/calendar/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: [
          {
            subscriptionId: "graph-sub-1",
            clientState: sub.clientState,
            changeType: "deleted",
          },
        ],
      }),
    });
    check("webhook notification acknowledged 202", notif.status === 202, notif.status);

    const converged = await waitFor(async () => {
      const [m] = await db
        .select({ status: atelierMeetings.status })
        .from(atelierMeetings)
        .where(eq(atelierMeetings.id, meetingId));
      return m?.status === "cancelled";
    });
    check("Atelier meeting soft-cancelled after webhook", converged);
    const [mrow] = await db
      .select()
      .from(atelierMeetings)
      .where(eq(atelierMeetings.id, meetingId));
    check("cancelled meeting has deletedAt", Boolean(mrow?.deletedAt), mrow);

    const [gone] = await db
      .select()
      .from(atelierMsCalEvents)
      .where(
        and(eq(atelierMsCalEvents.userId, userId), eq(atelierMsCalEvents.msEventId, "evt-doomed")),
      );
    check("tombstoned event removed from cache", !gone);
    const [kept] = await db
      .select()
      .from(atelierMsCalEvents)
      .where(
        and(eq(atelierMsCalEvents.userId, userId), eq(atelierMsCalEvents.msEventId, "evt-keep")),
      );
    check(
      "partial update preserves subject and other existing details",
      Boolean(kept) &&
        (kept.payload as any)?.subject === "Client sync" &&
        (kept.payload as any)?.organizer?.emailAddress?.address === "me@cognirise.ai" &&
        kept.startAt.getTime() === NOW + 2 * 3600e3,
      kept?.payload,
    );
    const fridayRows = await db
      .select()
      .from(atelierMsCalEvents)
      .where(eq(atelierMsCalEvents.userId, userId));
    const friday1 = fridayRows.find((r) => r.msEventId === "friday-1");
    const friday2 = fridayRows.find((r) => r.msEventId === "friday-2");
    check(
      "single occurrence update does not alter its sibling",
      (friday1?.payload as any)?.subject === "Friday leadership sync — revised" &&
        friday1?.startAt.getTime() === NOW + 4 * 86400e3 + 2 * 3600e3 &&
        (friday2?.payload as any)?.subject === "Friday leadership sync" &&
        friday2?.startAt.getTime() === NOW + 11 * 86400e3,
      { friday1: friday1?.payload, friday2: friday2?.payload },
    );
    const calAfter = await api("GET", "/me/calendar");
    const wireKeep = calAfter.body?.meetings?.find((m: any) => m.id === "evt-keep");
    const wireFriday1 = calAfter.body?.meetings?.find((m: any) => m.id === "friday-1");
    check(
      "shared calendar response exposes preserved and revised subjects",
      wireKeep?.subject === "Client sync" &&
        wireFriday1?.subject === "Friday leadership sync — revised" &&
        new Date(wireFriday1.start).getTime() === NOW + 4 * 86400e3 + 2 * 3600e3,
      { wireKeep, wireFriday1 },
    );
    const [state2] = await db
      .select()
      .from(atelierMsCalSyncState)
      .where(eq(atelierMsCalSyncState.userId, userId));
    check(
      "changedAt bumped by the webhook round",
      Boolean(state2) && state2.changedAt.getTime() > changedBefore,
      { before: changedBefore, after: state2?.changedAt },
    );
    check("incremental round used delta token (no extra full sync)", fullSyncCalls === 1 && incrementalCalls >= 1, {
      fullSyncCalls,
      incrementalCalls,
    });

    // ---- 7. cancelling one occurrence leaves its sibling intact ----
    deltaQueue = [{ value: [{ id: "friday-1", "@removed": { reason: "deleted" } }] }];
    const cancelOne = await sync.runCalendarDeltaSync(userId, "probe-cancel-occurrence");
    const afterCancel = await db
      .select()
      .from(atelierMsCalEvents)
      .where(eq(atelierMsCalEvents.userId, userId));
    check(
      "single occurrence cancellation removes only that occurrence",
      (cancelOne as any).ok === true &&
        !afterCancel.some((r) => r.msEventId === "friday-1") &&
        afterCancel.some(
          (r) =>
            r.msEventId === "friday-2" &&
            (r.payload as any)?.subject === "Friday leadership sync",
        ),
      afterCancel.map((r) => ({ id: r.msEventId, subject: (r.payload as any)?.subject })),
    );

    // ---- 8. wrong clientState → dropped ----
    const incBefore = incrementalCalls;
    const forged = await fetch(`${ROOT}/api/ms/calendar/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: [
          { subscriptionId: "graph-sub-1", clientState: "wrong-secret", changeType: "updated" },
        ],
      }),
    });
    await sleep(1200);
    check(
      "forged clientState dropped (202 but no sync round)",
      forged.status === 202 && incrementalCalls === incBefore,
      { status: forged.status, incBefore, incrementalCalls },
    );

    // ---- 9. cleanup path ----
    await sync.removeCalendarSubscription(userId);
    const [subGone] = await db
      .select()
      .from(atelierMsCalSubscriptions)
      .where(eq(atelierMsCalSubscriptions.userId, userId));
    const evLeft = await db
      .select()
      .from(atelierMsCalEvents)
      .where(eq(atelierMsCalEvents.userId, userId));
    const [stateGone] = await db
      .select()
      .from(atelierMsCalSyncState)
      .where(eq(atelierMsCalSyncState.userId, userId));
    check("remove deletes sub + cache + sync state", !subGone && evLeft.length === 0 && !stateGone, {
      subGone,
      evLeft: evLeft.length,
      stateGone,
    });
  } finally {
    await db.delete(atelierMeetings).where(eq(atelierMeetings.id, meetingId)).catch(() => {});
    await db.delete(atelierMsCalEvents).where(eq(atelierMsCalEvents.userId, userId)).catch(() => {});
    await db.delete(atelierMsCalSyncState).where(eq(atelierMsCalSyncState.userId, userId)).catch(() => {});
    await db.delete(atelierMsCalSubscriptions).where(eq(atelierMsCalSubscriptions.userId, userId)).catch(() => {});
    await db.delete(atelierMsConnections).where(eq(atelierMsConnections.userId, userId)).catch(() => {});
    await db.delete(atelierUsers).where(eq(atelierUsers.id, userId)).catch(() => {});
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`✗ ms-webhook-probe: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("✓ ms-webhook-probe: all checks passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
