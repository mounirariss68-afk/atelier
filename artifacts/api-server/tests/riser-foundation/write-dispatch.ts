import assert from "node:assert/strict";
import {
  assertDispatchCatalogCompatible,
  assertDispatchSemanticsCompatible,
  dispatchTarget,
  translateDispatchPayload,
} from "../../src/lib/atelier-cli/write-dispatch.js";

assert.doesNotThrow(() => assertDispatchSemanticsCompatible());
assert.throws(
  () => assertDispatchCatalogCompatible([]),
  /dispatch-target-unregistered/,
);
assert.equal(dispatchTarget("create", "meeting"), "meeting_create");
assert.equal(dispatchTarget("update", "meeting"), "meeting_update");
assert.equal(dispatchTarget("update", "raid_item"), "raid_update");
assert.equal(dispatchTarget("transition", "raid_item"), "raid_close");
assert.equal(dispatchTarget("delete", "meeting"), undefined);

assert.deepEqual(
  translateDispatchPayload("update", "meeting", { title: "Updated" }, "mtg_1"),
  { title: "Updated", meetingId: "mtg_1" },
);
assert.deepEqual(
  translateDispatchPayload("update", "raid_item", { severity: "red" }, "raid_1"),
  { severity: "red", raidId: "raid_1" },
);
assert.deepEqual(
  translateDispatchPayload("transition", "raid_item", {}, "raid_1"),
  { raidId: "raid_1" },
);

console.log("write dispatch semantic checks passed");

process.env.RISER_MANIFEST_GENERATING = "1";
await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");
const {
  meetingUpdatePatch,
  raidUpdatePatch,
} = await import("../../src/lib/atelier-cli/coverage-capabilities.js");
const meetingPatch = meetingUpdatePatch({
  title: "Updated meeting",
  parentType: "engagement",
  parentId: "eng_1",
  attendees: ["person_1", "person_2"],
});
assert.equal(meetingPatch.title, "Updated meeting");
assert.equal(meetingPatch.parentType, "engagement");
assert.equal(meetingPatch.parentId, "eng_1");
assert.deepEqual(meetingPatch.attendees, ["person_1", "person_2"]);
assert.equal("id" in meetingPatch, false);

const raidPatch = raidUpdatePatch({
  description: "Updated risk",
  severity: "red",
  mitigation: "Escalate weekly",
  status: "closed",
});
assert.equal(raidPatch.description, "Updated risk");
assert.equal(raidPatch.severity, "red");
assert.equal(raidPatch.mitigation, "Escalate weekly");
assert.equal("status" in raidPatch, false);

const proposeWrite = findByToolName("propose_write");
assert.ok(proposeWrite);
const unsupported = await proposeWrite.run(
  { verb: "delete", kind: "meeting", targetId: "mtg_1", payload: {} },
  {
    persona: {
      id: "user_dispatch_contract",
      name: "Dispatch Contract",
      role: "founding_partner",
      orgId: "org_dispatch_contract",
    },
    sessionId: "session_dispatch_contract",
    turnId: "turn_dispatch_contract",
  } as never,
);
assert.equal(unsupported.ok, false);
assert.equal(unsupported.errorCode, "unsupported_dispatch");
assert.equal(unsupported.confirmation, undefined);

console.log("unsupported dispatch fails before confirmation");

const restrictedDispatch = await proposeWrite.run(
  {
    verb: "update",
    kind: "raid_item",
    targetId: "raid_1",
    payload: { severity: "red" },
    confirm: true,
  },
  {
    persona: {
      id: "pfr_dispatch_contract",
      name: "Restricted Dispatch Contract",
      role: "partner_firm_resource",
      orgId: "org_dispatch_contract",
    },
    sessionId: "session_dispatch_contract",
    turnId: "turn_dispatch_contract_restricted",
  } as never,
);
assert.equal(restrictedDispatch.ok, false);
assert.equal(restrictedDispatch.errorCode, "dispatch_forbidden");

console.log("restricted persona cannot use catalog fallback dispatch");

const {
  db,
  atelierEngagements,
  atelierMeetings,
  atelierRaidItems,
} = await import("@workspace/db");
const { and, eq, inArray } = await import("drizzle-orm");
const tag = `dispatch_${Date.now().toString(36)}`;
const engagementId = `eng_${tag}`;
const meetingA = `mtg_${tag}_a`;
const meetingB = `mtg_${tag}_b`;
const raidA = `raid_${tag}_a`;
const raidB = `raid_${tag}_b`;
const founderContext = {
  persona: {
    id: "p_mounir_ariss",
    name: "Mounir Ariss",
    role: "founding_partner",
    orgId: "aico",
  },
  sessionId: `session_${tag}`,
  turnId: `turn_${tag}`,
} as never;
const ungrantedContext = {
  persona: {
    id: `consultant_${tag}`,
    name: "Ungraded Consultant",
    role: "consultant",
    orgId: "aico",
  },
  sessionId: `session_${tag}`,
  turnId: `turn_${tag}_denied`,
} as never;
try {
  await db.insert(atelierEngagements).values({
    id: engagementId,
    orgId: "aico",
    slug: tag,
    name: "Dispatch contract engagement",
    accountId: `acct_${tag}`,
    plmStage: "deliver",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_mounir_ariss",
    startDate: "2026-09-01",
    plannedEndDate: "2026-12-31",
  });
  await db.insert(atelierMeetings).values([
    {
      id: meetingA,
      orgId: "aico",
      parentType: "engagement",
      parentId: engagementId,
      title: "Meeting A",
      date: "2026-09-20",
      attendees: ["before"],
      createdByUserId: "p_mounir_ariss",
    },
    {
      id: meetingB,
      orgId: "aico",
      parentType: "engagement",
      parentId: engagementId,
      title: "Meeting B",
      date: "2026-09-21",
      attendees: [],
      createdByUserId: "p_mounir_ariss",
    },
  ]);
  await db.insert(atelierRaidItems).values([
    {
      id: raidA,
      orgId: "aico",
      engagementId,
      kind: "risk",
      description: "Risk A",
      severity: "amber",
      status: "open",
      createdByUserId: "p_mounir_ariss",
    },
    {
      id: raidB,
      orgId: "aico",
      engagementId,
      kind: "risk",
      description: "Risk B",
      severity: "green",
      status: "open",
      createdByUserId: "p_mounir_ariss",
    },
  ]);

  const meetingUpdate = findByToolName("meeting_update");
  const raidUpdate = findByToolName("raid_update");
  assert.ok(meetingUpdate);
  assert.ok(raidUpdate);

  const meetingResult = await meetingUpdate.run(
    {
      meetingId: meetingA,
      title: "Meeting A updated",
      attendees: ["after"],
      confirm: true,
    },
    founderContext,
  );
  assert.equal(meetingResult.ok, true);
  const meetings = await db
    .select()
    .from(atelierMeetings)
    .where(inArray(atelierMeetings.id, [meetingA, meetingB]));
  assert.equal(meetings.length, 2);
  assert.equal(meetings.find((row) => row.id === meetingA)?.title, "Meeting A updated");
  assert.deepEqual(meetings.find((row) => row.id === meetingA)?.attendees, ["after"]);
  assert.equal(meetings.find((row) => row.id === meetingB)?.title, "Meeting B");

  const raidResult = await raidUpdate.run(
    {
      raidId: raidA,
      severity: "red",
      mitigation: "Escalate weekly",
      status: "closed",
      confirm: true,
    },
    founderContext,
  );
  assert.equal(raidResult.ok, true);
  const raids = await db
    .select()
    .from(atelierRaidItems)
    .where(inArray(atelierRaidItems.id, [raidA, raidB]));
  assert.equal(raids.length, 2);
  assert.equal(raids.find((row) => row.id === raidA)?.severity, "red");
  assert.equal(raids.find((row) => row.id === raidA)?.status, "open");
  assert.equal(raids.find((row) => row.id === raidB)?.severity, "green");

  const deniedMeeting = await meetingUpdate.run(
    { meetingId: meetingA, title: "Unauthorized", confirm: true },
    ungrantedContext,
  );
  const deniedRaid = await raidUpdate.run(
    { raidId: raidA, severity: "green", confirm: true },
    ungrantedContext,
  );
  assert.equal(deniedMeeting.ok, false);
  assert.equal(deniedMeeting.errorCode, "forbidden");
  assert.equal(deniedRaid.ok, false);
  assert.equal(deniedRaid.errorCode, "forbidden");
} finally {
  await db.delete(atelierMeetings).where(inArray(atelierMeetings.id, [meetingA, meetingB]));
  await db.delete(atelierRaidItems).where(inArray(atelierRaidItems.id, [raidA, raidB]));
  await db
    .delete(atelierEngagements)
    .where(and(eq(atelierEngagements.id, engagementId), eq(atelierEngagements.orgId, "aico")));
}

console.log("database-backed dispatch mutation and ACL checks passed");