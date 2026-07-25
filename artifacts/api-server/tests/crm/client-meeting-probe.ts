/**
 * Task #568 — chat capability probe for schedule_client_meeting.
 *
 * Deterministic (no LLM; Microsoft Graph is a local HTTP stub via
 * MS_LOGIN_BASE_URL / MS_GRAPH_BASE_URL):
 *
 *   1. opportunityName resolution → clarifications (topic, location) →
 *      two-phase preview (internal-only availability note) → confirm
 *      books a real (stubbed) Outlook invite with client + colleague
 *      attendees, inserts the atelier_meetings row on the opportunity,
 *      and audits.
 *   2. accountName with several live opps/engs → parent disambiguation
 *      with parentRef options.
 *   3. account with no live opp/eng → honest no_parent error.
 *   4. contact without email → missing_email.
 *   5. unknown contact at the account → not_found.
 *   6. requester without MS connection → ms_not-connected (invite is
 *      never faked).
 *
 * Run: pnpm --filter @workspace/api-server test:client-meeting
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
  // ---- MS env BEFORE msGraph/msScheduling load ----
  process.env.MS_TOKEN_ENC_SECRET = "probe-enc-secret";
  process.env.MS_CLIENT_ID = "stub-client";
  process.env.MS_TENANT_ID = "stub-tenant";
  process.env.MS_CLIENT_SECRET = "stub-secret";

  // ---- Microsoft stub: token endpoint + event create ----
  const createdEvents: any[] = [];
  const stub = http.createServer((req, res) => {
    const url = req.url ?? "";
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && url.includes("/oauth2/v2.0/token")) {
        res.end(
          JSON.stringify({
            access_token: "stub-access",
            refresh_token: "stub-refresh-2",
            expires_in: 3600,
            scope: "Calendars.ReadWrite User.Read",
          }),
        );
        return;
      }
      if (req.method === "GET" && url.includes("calendarView")) {
        res.end(JSON.stringify({ value: [] })); // everyone free
        return;
      }
      if (req.method === "POST" && url.startsWith("/me/events")) {
        const payload = JSON.parse(body || "{}");
        createdEvents.push(payload);
        res.statusCode = 201;
        res.end(
          JSON.stringify({
            id: `evt-${createdEvents.length}`,
            iCalUId: `uid-${createdEvents.length}`,
            subject: payload.subject,
            webLink: "https://outlook.test/evt",
            onlineMeeting: payload.isOnlineMeeting
              ? { joinUrl: "https://teams.test/join/probe" }
              : null,
          }),
        );
        return;
      }
      if (url.includes("getSchedule")) {
        res.end(JSON.stringify({ value: [] }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.MS_LOGIN_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.MS_GRAPH_BASE_URL = `http://127.0.0.1:${stubPort}`;

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierContacts,
    atelierOpportunities,
    atelierEngagements,
    atelierMeetings,
    atelierAuditEvents,
    atelierMsConnections,
  } = D as any;
  const { eq, inArray, like } = await import("drizzle-orm");
  const gm = await import("../../src/lib/msGraph.js");
  await import("../../src/lib/atelier-cli/client-meeting-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");

  const tool = findByToolName("schedule_client_meeting");
  if (!tool) throw new Error("schedule_client_meeting capability not registered");

  const runTag = `probe568cl_${Date.now()}`;
  const orgId = "aico";
  const userId = `u_${runTag}`;
  const colleagueId = `u_${runTag}_col`;
  const accId = `acc_${runTag}`;
  const acc2Id = `acc_${runTag}_2`;
  const oppId = `opp_${runTag}`;
  const opp2Id = `opp_${runTag}_2`;
  const engId = `eng_${runTag}`;
  const contactId = `ct_${runTag}`;
  const noMailContactId = `ct_${runTag}_nomail`;
  const persona = { id: userId, name: "Probe Scheduler", role: "founding_partner", orgId };
  const run = async (input: Record<string, unknown>) =>
    tool.run(input, { persona, turnId: `turn_${runTag}` } as any);

  const dateStr = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10);

  try {
    await db.insert(atelierUsers).values([
      { id: userId, orgId, name: persona.name, initials: "PS", email: `${runTag}@cognirise.ai`, role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
      { id: colleagueId, orgId, name: "Vexley Probemate", initials: "VP", email: `${runTag}_col@cognirise.ai`, role: "consultant", roleLabel: "Consultant", title: "Consultant" },
    ]);
    await db.insert(atelierAccounts).values([
      { id: accId, orgId, name: `Tasama Probe ${runTag}`, country: "AE", sector: "Logistics", tier: "C", status: "active" },
      { id: acc2Id, orgId, name: `Emptyco Probe ${runTag}`, country: "AE", sector: "Retail", tier: "C", status: "active" },
    ]);
    await db.insert(atelierContacts).values([
      { id: contactId, orgId, accountId: accId, fullName: "Rania Probeclient", email: "rania@tasama.test" },
      { id: noMailContactId, orgId, accountId: accId, fullName: "Mailless Probeclient", email: null },
    ]);
    await db.insert(atelierOpportunities).values([
      { id: oppId, orgId, accountId: accId, name: `BPO Transformation ${runTag}`, slug: `bpo-${runTag}`, salesStage: "qualify", partnerOwnerId: userId, engagementLeadId: userId, dealSizeHypothesis: 100000, probabilityPct: 50, nextMilestone: "probe", sourceLead: "manual", createdByUserId: userId },
      { id: opp2Id, orgId, accountId: accId, name: `ERP Selection ${runTag}`, slug: `erp-${runTag}`, salesStage: "qualify", partnerOwnerId: userId, engagementLeadId: userId, dealSizeHypothesis: 100000, probabilityPct: 50, nextMilestone: "probe", sourceLead: "manual", createdByUserId: userId },
    ]);
    await db.insert(atelierEngagements).values({
      id: engId, orgId, slug: engId, accountId: accId, name: `Ops Excellence ${runTag}`,
      opportunityId: oppId, plmStage: "deliver", partnerOwnerId: userId, engagementLeadId: userId,
      startDate: "2026-01-01", plannedEndDate: "2026-12-31",
    });

    // 6 (first, before connecting MS). requester has no MS connection → honest error at commit
    const noConn = await run({
      contacts: ["Rania"], opportunityName: `BPO Transformation ${runTag}`,
      date: dateStr, time: "10:00", topic: "Kickoff chat", locationType: "online", confirm: true,
    });
    check("no MS connection → ms_not-connected", noConn?.ok === false && noConn?.errorCode === "ms_not-connected", noConn);

    // connect the requester (encrypted refresh token; stub token endpoint refreshes it)
    await db.insert(atelierMsConnections).values({
      id: `msc_${runTag}`, orgId, userId, msEmail: `${runTag}@cognirise.ai`, msOid: "oid-probe",
      encRefreshToken: gm.encryptToken("stub-refresh-1"), scopes: ["Calendars.ReadWrite", "User.Read"],
    });

    // 1a. clarifications: topic first, then location
    const askTopic = await run({ contacts: ["Rania"], opportunityName: `BPO Transformation ${runTag}`, date: dateStr, time: "10:00" });
    check("missing topic → clarification", askTopic?.ok === true && askTopic?.clarification?.field === "topic", askTopic);
    const askLoc = await run({ contacts: ["Rania"], opportunityName: `BPO Transformation ${runTag}`, date: dateStr, time: "10:00", topic: "Discovery call" });
    check("missing location → clarification", askLoc?.ok === true && askLoc?.clarification?.field === "locationType", askLoc);

    // 1b. preview
    const prev = await run({
      contacts: ["Rania"], colleagues: ["Vexley"], opportunityName: `BPO Transformation ${runTag}`,
      date: dateStr, time: "10:00", topic: "Discovery call", locationType: "online",
    });
    check("preview ok + confirmation", prev?.ok === true && Boolean(prev?.confirmation), prev);
    check(
      "preview notes internal-only availability",
      String(prev?.confirmation?.summary ?? "").includes("client's calendar isn't visible"),
      prev?.confirmation?.summary,
    );
    check(
      "pending input pins parentRef + confirm",
      prev?.confirmation?.pending?.input?.parentRef === `opportunity:${oppId}` &&
        prev?.confirmation?.pending?.input?.confirm === true,
      prev?.confirmation?.pending,
    );

    // 1c. confirm → invite sent + row + audit
    const done = await run(prev.confirmation.pending.input);
    check("commit ok", done?.ok === true, done);
    check("stub invite created", createdEvents.length === 1, createdEvents.length);
    const evt = createdEvents[0];
    const emails = (evt?.attendees ?? []).map((a: any) => a?.emailAddress?.address);
    check(
      "invite includes client + colleague",
      emails.includes("rania@tasama.test") && emails.includes(`${runTag}_col@cognirise.ai`),
      emails,
    );
    check("invite is online (Teams)", evt?.isOnlineMeeting === true, evt);

    const rows = await db.select().from(atelierMeetings).where(eq(atelierMeetings.parentId, oppId));
    check("meeting row on the opportunity", rows.length === 1 && rows[0].parentType === "opportunity", rows);
    check(
      "meeting row carries event + join link",
      rows[0]?.msEventId === "evt-1" && rows[0]?.joinUrl === "https://teams.test/join/probe",
      rows[0],
    );
    if (rows[0]) {
      const audits = await db.select().from(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, rows[0].id));
      check("scheduled.cli audit", audits.some((a: any) => a.action === "meeting.scheduled.cli"), audits.map((a: any) => a.action));
    }

    // 2. accountName with several live parents → disambiguation
    const dis = await run({
      contacts: ["Rania"], accountName: `Tasama Probe ${runTag}`, date: dateStr, time: "11:00",
      topic: "Follow-up", locationType: "online",
    });
    const opts = dis?.disambiguation?.options ?? [];
    check(
      "account-only → parent disambiguation with parentRef ids",
      dis?.ok === true &&
        dis?.disambiguation?.field === "parentRef" &&
        opts.some((o: any) => o.id === `opportunity:${oppId}`) &&
        opts.some((o: any) => o.id === `engagement:${engId}`),
      dis,
    );

    // 3. account with no live opp/eng → honest error
    const noParent = await run({
      contacts: ["Rania"], accountName: `Emptyco Probe ${runTag}`, date: dateStr, time: "11:00",
      topic: "Follow-up", locationType: "online",
    });
    check("no live parent → no_parent", noParent?.ok === false && noParent?.errorCode === "no_parent", noParent);

    // 4. contact without email
    const noMail = await run({
      contacts: ["Mailless"], parentRef: `opportunity:${oppId}`, date: dateStr, time: "11:00",
      topic: "Follow-up", locationType: "online",
    });
    check("contact without email → missing_email", noMail?.ok === false && noMail?.errorCode === "missing_email", noMail);

    // 5. unknown contact at the account
    const unknown = await run({
      contacts: ["Zebulon Nonexistent"], parentRef: `opportunity:${oppId}`, date: dateStr, time: "11:00",
      topic: "Follow-up", locationType: "online",
    });
    check("unknown contact → not_found", unknown?.ok === false && unknown?.errorCode === "not_found", unknown);
  } finally {
    try {
      const mrows = await db.select({ id: atelierMeetings.id }).from(atelierMeetings).where(inArray(atelierMeetings.parentId, [oppId, opp2Id, engId]));
      const mids = mrows.map((r: any) => r.id);
      if (mids.length > 0) {
        await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, mids));
        await db.delete(atelierMeetings).where(inArray(atelierMeetings.id, mids));
      }
      await db.delete(atelierMsConnections).where(eq(atelierMsConnections.userId, userId));
      await db.delete(atelierContacts).where(inArray(atelierContacts.id, [contactId, noMailContactId]));
      const { hardDeleteOpportunities } = await import("../../src/lib/atelier-opportunity-delete.js");
      await hardDeleteOpportunities([oppId, opp2Id]);
      await db.delete(atelierEngagements).where(eq(atelierEngagements.id, engId));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [accId, acc2Id]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [userId, colleagueId]));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `u_${runTag}%`));
    } catch (err) {
      console.error("cleanup failed", err);
    }
    stub.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`✗ client-meeting-probe: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("✓ client-meeting-probe: all checks passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
