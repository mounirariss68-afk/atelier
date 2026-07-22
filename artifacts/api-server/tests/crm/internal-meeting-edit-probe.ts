/**
 * Task #568 — chat capability probe for update_internal_meeting.
 *
 * Deterministic (no LLM, no Graph — the fixture meeting has no
 * msEventId, so the update path is local-only, which is exactly the
 * lifecycle contract for meetings without a linked Outlook event):
 *
 *   1. topic rename: preview (two-phase) → confirm commits + audits.
 *   2. add attendee by roster name → attendee list grows.
 *   3. remove attendee by name → attendee list shrinks.
 *   4. removing everyone is refused (cancel instead).
 *   5. a non-organizer (non founding partner) cannot see/edit the
 *      meeting — not_found envelope, never a silent success.
 *   6. no-change input → invalid_input.
 *
 * Run: pnpm --filter @workspace/api-server test:meeting-edit
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";

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
  const { db, pool, atelierUsers, atelierMeetings, atelierAuditEvents } = D as any;
  const { eq, inArray } = await import("drizzle-orm");
  await import("../../src/lib/atelier-cli/internal-meeting-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");

  const tool = findByToolName("update_internal_meeting");
  if (!tool) throw new Error("update_internal_meeting capability not registered");

  const runTag = `probe568edit_${Date.now()}`;
  const orgId = "aico";
  const organizerId = `u_${runTag}_org`;
  const colleagueAId = `u_${runTag}_a`;
  const colleagueBId = `u_${runTag}_b`;
  const outsiderId = `u_${runTag}_out`;
  const meetingId = `mtg_${runTag}`;
  const organizer = { id: organizerId, name: "Orga Probe", role: "partner", orgId };
  const outsider = { id: outsiderId, name: "Out Sider", role: "consultant", orgId };

  const run = async (input: Record<string, unknown>, persona = organizer) =>
    tool.run(input, { persona, turnId: `turn_${runTag}` } as any);

  try {
    await db.insert(atelierUsers).values([
      { id: organizerId, orgId, name: organizer.name, initials: "OP", email: `${runTag}_org@example.test`, role: "partner", roleLabel: "Partner", title: "Partner" },
      { id: colleagueAId, orgId, name: "Zubin Probeworth", initials: "ZP", email: `${runTag}_a@example.test`, role: "consultant", roleLabel: "Consultant", title: "Consultant" },
      { id: colleagueBId, orgId, name: "Quilla Probestein", initials: "QP", email: `${runTag}_b@example.test`, role: "consultant", roleLabel: "Consultant", title: "Consultant" },
      { id: outsiderId, orgId, name: outsider.name, initials: "OS", email: `${runTag}_out@example.test`, role: "consultant", roleLabel: "Consultant", title: "Consultant" },
    ] as any);

    const start = new Date(Date.now() + 48 * 3600 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    await db.insert(atelierMeetings).values({
      id: meetingId,
      orgId,
      parentType: "internal",
      parentId: "internal",
      mode: "scheduled",
      kind: "internal",
      title: `Probe sync ${runTag}`,
      date: start.toISOString().slice(0, 10),
      startAt: start,
      endAt: end,
      locationType: "online",
      msEventId: null,
      internalAttendees: [
        { userId: colleagueAId, name: "Zubin Probeworth", email: `${runTag}_a@example.test` },
      ],
      status: "scheduled",
      createdByUserId: organizerId,
    } as any);

    // 1. topic rename: preview then confirm
    const prev = await run({ meetingId, topic: "Q3 planning" });
    check("rename preview ok", prev?.ok === true && Boolean(prev?.confirmation), prev);
    check(
      "rename preview pending carries id+topic",
      prev?.confirmation?.pending?.input?.meetingId === meetingId &&
        prev?.confirmation?.pending?.input?.topic === "Q3 planning" &&
        prev?.confirmation?.pending?.input?.confirm === true,
      prev?.confirmation?.pending,
    );
    const committed = await run(prev.confirmation.pending.input);
    check("rename commit ok", committed?.ok === true, committed);
    let [row] = await db.select().from(atelierMeetings).where(eq(atelierMeetings.id, meetingId));
    check("rename persisted", row?.title === "Q3 planning", row?.title);

    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(eq(atelierAuditEvents.entityId, meetingId));
    check(
      "rename audited",
      audits.some((a: any) => a.action === "meeting.updated" && a.payload?.title === "Q3 planning"),
      audits.map((a: any) => a.action),
    );

    // 2. add attendee (unique name fragment)
    const addPrev = await run({ meetingId, addAttendees: ["Quilla"] });
    check("add preview ok", addPrev?.ok === true && Boolean(addPrev?.confirmation), addPrev);
    const addDone = await run(addPrev.confirmation.pending.input);
    check("add commit ok", addDone?.ok === true, addDone);
    [row] = await db.select().from(atelierMeetings).where(eq(atelierMeetings.id, meetingId));
    check(
      "attendee added",
      (row?.internalAttendees ?? []).some((a: any) => a.userId === colleagueBId),
      row?.internalAttendees,
    );

    // 3. remove attendee
    const rmPrev = await run({ meetingId, removeAttendees: ["Zubin"] });
    check("remove preview ok", rmPrev?.ok === true && Boolean(rmPrev?.confirmation), rmPrev);
    const rmDone = await run(rmPrev.confirmation.pending.input);
    check("remove commit ok", rmDone?.ok === true, rmDone);
    [row] = await db.select().from(atelierMeetings).where(eq(atelierMeetings.id, meetingId));
    check(
      "attendee removed",
      !(row?.internalAttendees ?? []).some((a: any) => a.userId === colleagueAId) &&
        (row?.internalAttendees ?? []).some((a: any) => a.userId === colleagueBId),
      row?.internalAttendees,
    );

    // 4. removing the last attendee is refused
    const empty = await run({ meetingId, removeAttendees: ["Quilla"] });
    check("emptying attendees refused", empty?.ok === false && empty?.errorCode === "invalid_input", empty);

    // 5. non-organizer, non founding partner: cannot manage
    const denied = await run({ meetingId, topic: "Hijacked" }, outsider);
    check("non-organizer denied (not_found)", denied?.ok === false && denied?.errorCode === "not_found", denied);
    [row] = await db.select().from(atelierMeetings).where(eq(atelierMeetings.id, meetingId));
    check("title untouched after denial", row?.title === "Q3 planning", row?.title);

    // 6. nothing to change
    const noop = await run({ meetingId });
    check("no-change input rejected", noop?.ok === false && noop?.errorCode === "invalid_input", noop);
  } finally {
    try {
      await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, meetingId));
      await db.delete(atelierMeetings).where(eq(atelierMeetings.id, meetingId));
      await db
        .delete(atelierUsers)
        .where(inArray(atelierUsers.id, [organizerId, colleagueAId, colleagueBId, outsiderId]));
    } catch (err) {
      console.error("cleanup failed", err);
    }
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll internal-meeting-edit probe checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
