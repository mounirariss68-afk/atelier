/**
 * Task #327 — Microsoft 365 connection + calendar probe (no real Microsoft).
 *
 * Covers:
 *   - crypto: encryptToken/decryptToken round-trip; tampered ciphertext throws
 *   - state: signState/verifyState round-trip; tampered MAC rejected; expiry
 *   - GET /me/msconnection: configured:false without env; connected:false
 *   - GET /me/msauth/start: 302 to stub login, state cookie set
 *   - GET /me/msauth/callback: state mismatch → ms_error; happy path via
 *     stubbed token + Graph /me → connection row with encrypted refresh token
 *   - GET /me/calendar: stubbed calendarView; contact matching (visible
 *     account matched, unmatched attendee ignored); accountId filter;
 *     invalid window → 400
 *   - DELETE /me/msconnection: row deleted, second call disconnected:false
 *
 * Deterministic — Microsoft is a local HTTP stub via MS_LOGIN_BASE_URL /
 * MS_GRAPH_BASE_URL. Run: NODE_ENV=test pnpm exec tsx tests/crm/ms-calendar-probe.ts
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
  const { db, pool, atelierUsers, atelierAccounts, atelierContacts, atelierMsConnections } = D;
  const { eq } = await import("drizzle-orm");

  // ---- configure MS env BEFORE routes evaluate msConfigured() at request time ----
  process.env.MS_TOKEN_ENC_SECRET = "probe-enc-secret";

  const gm = await import("../../src/lib/msGraph.js");

  // ---- pure crypto/state checks ----
  const rt = gm.encryptToken("secret-refresh-token");
  check("token round-trip", gm.decryptToken(rt) === "secret-refresh-token");
  let threw = false;
  try {
    const parts = rt.split(".");
    gm.decryptToken(`${parts[0]}.${parts[1]}.${Buffer.from("tampered!").toString("base64")}`);
  } catch {
    threw = true;
  }
  check("tampered ciphertext throws", threw);

  const st = gm.signState({ userId: "u1", nonce: "n", codeVerifier: "v", issuedAt: Date.now() });
  check("state round-trip", gm.verifyState(st)?.userId === "u1");
  check("tampered state rejected", gm.verifyState(`${st.split(".")[0]}.AAAA`) === null);
  const old = gm.signState({ userId: "u1", nonce: "n", codeVerifier: "v", issuedAt: Date.now() - 11 * 60 * 1000 });
  check("expired state rejected", gm.verifyState(old) === null);

  // ---- Microsoft stub server ----
  const NOW = Date.now();
  const startIso = new Date(NOW + 3600e3).toISOString().replace(/Z$/, "");
  const endIso = new Date(NOW + 7200e3).toISOString().replace(/Z$/, "");
  const stub = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url.includes("/oauth2/v2.0/token")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const p = new URLSearchParams(body);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            access_token: "stub-access",
            refresh_token:
              p.get("grant_type") === "refresh_token" ? "stub-refresh-2" : "stub-refresh-1",
            expires_in: 3600,
            scope: "Calendars.Read User.Read",
          }),
        );
      });
      return;
    }
    if (url.startsWith("/me/calendarView")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          value: [
            {
              id: "evt1",
              subject: "Discovery with Tasama",
              isAllDay: false,
              start: { dateTime: startIso, timeZone: "UTC" },
              end: { dateTime: endIso, timeZone: "UTC" },
              attendees: [
                { emailAddress: { address: "probe.contact@tasama.test", name: "Probe Contact" } },
                { emailAddress: { address: "random@nowhere.test", name: "Random" } },
              ],
              organizer: { emailAddress: { address: "me@cognirise.ai" } },
              onlineMeeting: { joinUrl: "https://teams.test/join/1" },
              webLink: "https://outlook.test/evt1",
            },
            {
              id: "evt2",
              subject: "Internal sync",
              isAllDay: false,
              start: { dateTime: startIso, timeZone: "UTC" },
              end: { dateTime: endIso, timeZone: "UTC" },
              attendees: [{ emailAddress: { address: "colleague@cognirise.ai" } }],
              organizer: { emailAddress: { address: "me@cognirise.ai" } },
            },
            {
              id: "evt3",
              subject: "Cancelled one",
              isCancelled: true,
              start: { dateTime: startIso, timeZone: "UTC" },
              end: { dateTime: endIso, timeZone: "UTC" },
              attendees: [],
            },
            {
              id: "evt-friday",
              iCalUId: "uid-friday",
              seriesMasterId: "series-friday",
              type: "occurrence",
              start: { dateTime: startIso, timeZone: "UTC" },
              end: { dateTime: endIso, timeZone: "UTC" },
              attendees: [],
            },
          ],
        }),
      );
      return;
    }
    if (url.startsWith("/me/events/evt-friday")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: "evt-friday",
        seriesMasterId: "series-friday",
        type: "occurrence",
        start: { dateTime: startIso, timeZone: "UTC" },
        end: { dateTime: endIso, timeZone: "UTC" },
      }));
      return;
    }
    if (url.startsWith("/me/events/series-friday")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: "series-friday",
        type: "seriesMaster",
        subject: "Friday leadership sync",
      }));
      return;
    }
    if (url.startsWith("/me")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "ms-oid-1",
          displayName: "Probe User",
          mail: "Me@Cognirise.ai",
          userPrincipalName: "me@cognirise.ai",
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

  // ---- app ----
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const runTag = `probe327_${Date.now()}`;
  const userId = `u_${runTag}`;
  const accId = `acc_${runTag}`;
  const contactId = `ct_${runTag}`;
  const cookie = `atelier_persona=${userId}`;

  const api = async (
    method: string,
    path: string,
    opts: { extraCookie?: string; redirect?: "manual" } = {},
  ) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: opts.redirect ?? "manual",
      headers: {
        cookie: opts.extraCookie ? `${cookie}; ${opts.extraCookie}` : cookie,
      },
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Probe MsUser",
      initials: "PM",
      email: `${runTag}@cognirise.ai`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: accId,
      orgId: "aico",
      name: `Tasama Probe ${runTag}`,
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
      email: "probe.contact@tasama.test",
    } as any);

    // ---- not configured yet ----
    delete process.env.MS_CLIENT_ID;
    delete process.env.MS_TENANT_ID;
    delete process.env.MS_CLIENT_SECRET;
    const unconf = await api("GET", "/me/msconnection");
    check("unconfigured status", unconf.status === 200 && unconf.body?.configured === false, unconf);
    const unconfCal = await api("GET", "/me/calendar");
    check(
      "unconfigured calendar → empty, configured:false",
      unconfCal.status === 200 && unconfCal.body?.configured === false && unconfCal.body?.meetings?.length === 0,
      unconfCal,
    );

    // ---- configure ----
    process.env.MS_CLIENT_ID = "stub-client";
    process.env.MS_TENANT_ID = "stub-tenant";
    process.env.MS_CLIENT_SECRET = "stub-secret";

    // ---- start: 302 + state cookie ----
    const start = await api("GET", "/me/msauth/start");
    const loc = start.headers.get("location") ?? "";
    check("start 302 to stub login", start.status === 302 && loc.startsWith(`http://127.0.0.1:${stubPort}/`), loc);
    const setCookie = start.headers.get("set-cookie") ?? "";
    const stateCookieVal = /atelier_ms_oauth=([^;]+)/.exec(setCookie)?.[1] ?? null;
    check("state cookie set", Boolean(stateCookieVal), setCookie);
    const stateParam = new URL(loc).searchParams.get("state");
    check("state in authorize url matches cookie", Boolean(stateParam) && decodeURIComponent(stateCookieVal!) === stateParam, { stateParam });

    // ---- callback with mismatched state → error redirect ----
    const bad = await api("GET", `/me/msauth/callback?code=abc&state=forged.state`, {
      extraCookie: `atelier_ms_oauth=${stateCookieVal}`,
    });
    check(
      "forged state → ms_error=state-mismatch",
      bad.status === 302 && (bad.headers.get("location") ?? "").includes("ms_error=state-mismatch"),
      bad.headers.get("location"),
    );

    // ---- happy-path callback (fresh start, since cookie was cleared) ----
    const start2 = await api("GET", "/me/msauth/start");
    const sc2 = /atelier_ms_oauth=([^;]+)/.exec(start2.headers.get("set-cookie") ?? "")?.[1]!;
    const state2 = new URL(start2.headers.get("location")!).searchParams.get("state")!;
    const cb = await api(
      "GET",
      `/me/msauth/callback?code=goodcode&state=${encodeURIComponent(state2)}`,
      { extraCookie: `atelier_ms_oauth=${sc2}` },
    );
    check(
      "happy callback → ms=connected",
      cb.status === 302 && (cb.headers.get("location") ?? "").includes("ms=connected"),
      cb.headers.get("location"),
    );
    const [row] = await db
      .select()
      .from(atelierMsConnections)
      .where(eq(atelierMsConnections.userId, userId));
    check("connection row stored", Boolean(row) && row.msEmail === "me@cognirise.ai", row);
    check(
      "refresh token encrypted at rest + decryptable",
      Boolean(row) && row.encRefreshToken !== "stub-refresh-1" && gm.decryptToken(row.encRefreshToken) === "stub-refresh-1",
    );

    // ---- status shows connected, no token fields ----
    const st2 = await api("GET", "/me/msconnection");
    check(
      "status connected, tokenless",
      st2.body?.connected === true &&
        st2.body?.msEmail === "me@cognirise.ai" &&
        !JSON.stringify(st2.body).includes("stub-refresh"),
      st2.body,
    );

    // ---- calendar: matching + cancelled filtered ----
    const cal = await api("GET", "/me/calendar");
    check("calendar 200 connected", cal.status === 200 && cal.body?.connected === true, cal);
    const ids = (cal.body?.meetings ?? []).map((m: any) => m.id);
    check("cancelled event filtered", !ids.includes("evt3"), ids);
    const evt1 = (cal.body?.meetings ?? []).find((m: any) => m.id === "evt1");
    check(
      "contact matched to visible account",
      evt1?.matches?.length === 1 &&
        evt1.matches[0].contactId === contactId &&
        evt1.matches[0].accountId === accId,
      evt1?.matches,
    );
    const evt2 = (cal.body?.meetings ?? []).find((m: any) => m.id === "evt2");
    check("internal meeting has no matches", evt2 && evt2.matches.length === 0, evt2?.matches);
    const friday = (cal.body?.meetings ?? []).find((m: any) => m.id === "evt-friday");
    check(
      "live recurring occurrence inherits the series subject",
      friday?.subject === "Friday leadership sync",
      friday,
    );

    // ---- refresh-token rotation persisted ----
    const [row2] = await db
      .select()
      .from(atelierMsConnections)
      .where(eq(atelierMsConnections.userId, userId));
    check("rotated refresh token persisted", gm.decryptToken(row2.encRefreshToken) === "stub-refresh-2");

    // ---- accountId filter ----
    const filtered = await api("GET", `/me/calendar?accountId=${accId}`);
    const fids = (filtered.body?.meetings ?? []).map((m: any) => m.id);
    check("accountId filter keeps only matched", fids.length === 1 && fids[0] === "evt1", fids);
    const filteredNone = await api("GET", `/me/calendar?accountId=acc_nonexistent`);
    check("accountId filter no matches → empty", (filteredNone.body?.meetings ?? []).length === 0, filteredNone.body);

    // ---- invalid window ----
    const badWin = await api(
      "GET",
      `/me/calendar?start=${encodeURIComponent(new Date(NOW).toISOString())}&end=${encodeURIComponent(new Date(NOW + 90 * 86400e3).toISOString())}`,
    );
    check("window > 60d → 400", badWin.status === 400 && badWin.body?.error === "invalid-window", badWin);

    // ---- disconnect ----
    const del = await api("DELETE", "/me/msconnection");
    check("disconnect true", del.body?.ok === true && del.body?.disconnected === true, del.body);
    const del2 = await api("DELETE", "/me/msconnection");
    check("second disconnect idempotent", del2.body?.ok === true && del2.body?.disconnected === false, del2.body);
    const [gone] = await db
      .select()
      .from(atelierMsConnections)
      .where(eq(atelierMsConnections.userId, userId));
    check("row deleted", !gone);
  } finally {
    // cleanup scratch rows (scratch DB is disposable, but be tidy)
    await db.delete(atelierMsConnections).where(eq(atelierMsConnections.userId, userId)).catch(() => {});
    await db.delete(atelierContacts).where(eq(atelierContacts.id, contactId)).catch(() => {});
    await db.delete(atelierAccounts).where(eq(atelierAccounts.id, accId)).catch(() => {});
    await db.delete(atelierUsers).where(eq(atelierUsers.id, userId)).catch(() => {});
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`✗ ms-calendar-probe: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("✓ ms-calendar-probe: all checks passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
