/**
 * Task #567 — meeting-chat scheduling hardening probes (pure/unit level,
 * no LLM, no HTTP). Covers:
 *   1. foldRosterName: accent/Turkish-character folding ("gokhan" must
 *      match "Gökhan Güney"; ı/İ, ş, ü, ö, ç, ğ).
 *   2. normalizeLocationAnswer: synonym tolerance ("in person",
 *      "In-person", "teams", "face to face"), conflicts → null.
 *   3. normalizeTimeInput: "8am", "8.00", "0800", "19:30" → "HH:MM";
 *      garbage/out-of-range → null.
 *   4. LOCATION_SUGGESTIONS shape (tappable-chip contract: id + label).
 *   5. looksLikeClarificationAnswer hijack guard: fresh scheduling
 *      commands ("setup a meeting…", "book…", "reschedule…") are NOT
 *      treated as answers to a pending clarification, while plausible
 *      short answers still are.
 */
import assert from "node:assert/strict";
import {
  foldRosterName,
  normalizeLocationAnswer,
  normalizeTimeInput,
  LOCATION_SUGGESTIONS,
} from "../../src/lib/atelier-cli/chat-normalizers.js";
import {
  looksLikeClarificationAnswer,
  reRouteClarificationAnswer,
  CLARIFICATION_REROUTE_TOOLS,
} from "../../src/lib/atelier-cli/index.js";
import { dateFromMeetingQuery, timeFromMeetingQuery } from "../../src/lib/atelier-cli/internal-meeting-capabilities.js";
import {
  isPastSlot,
  pickReplayMatch,
  buildDuplicateWarning,
  type SameSlotMeeting,
} from "../../src/lib/atelier-cli/meeting-reliability.js";
import {
  looksLikeEmailAddress,
  isSelfReference,
} from "../../src/lib/atelier-cli/meeting-attendee-resolver.js";
import { listCapabilities } from "../../src/lib/atelier-cli/capability-catalog.js";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";

let passed = 0;
function ok(cond: boolean, label: string): void {
  assert.ok(cond, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log("1. foldRosterName");
ok(foldRosterName("Gökhan Güney").includes(foldRosterName("gokhan")), "gokhan matches Gökhan Güney");
ok(foldRosterName("Gökhan Güney").includes(foldRosterName("guney")), "guney matches Güney");
ok(foldRosterName("Işıl Şahin") === foldRosterName("isil sahin"), "ı/İ + ş fold (Işıl Şahin)");
ok(foldRosterName("İstanbul") === "istanbul", "dotted capital İ folds to i");
ok(foldRosterName("Çağla Öztürk") === foldRosterName("cagla ozturk"), "ç/ğ/ö/ü fold");
ok(foldRosterName("MOUNIR") === "mounir", "plain lowercase passthrough");

console.log("2. normalizeLocationAnswer");
for (const [raw, want] of [
  ["online", "online"],
  ["Teams", "online"],
  ["a teams call please", "online"],
  ["virtual", "online"],
  ["in person", "in_person"],
  ["In-person", "in_person"],
  ["IN PERSON", "in_person"],
  ["face to face", "in_person"],
  ["in the office", "in_person"],
  ["in_person", "in_person"],
] as const) {
  ok(normalizeLocationAnswer(raw) === want, `"${raw}" → ${want}`);
}
ok(normalizeLocationAnswer("banana") === null, "unrecognized answer → null (re-ask)");
ok(normalizeLocationAnswer("") === null, "empty → null");
ok(
  normalizeLocationAnswer("online or in person, you pick") === null,
  "conflicting keywords → null (re-ask, no silent guess)",
);

console.log("3. normalizeTimeInput");
for (const [raw, want] of [
  ["8am", "08:00"],
  ["8:00am", "08:00"],
  ["8.00", "08:00"],
  ["0800", "08:00"],
  ["8", "08:00"],
  ["8pm", "20:00"],
  ["12am", "00:00"],
  ["12pm", "12:00"],
  ["19:30", "19:30"],
  ["1930", "19:30"],
] as const) {
  ok(normalizeTimeInput(raw) === want, `"${raw}" → ${want}`);
}
ok(normalizeTimeInput("25:00") === null, "hour>23 rejected");
ok(normalizeTimeInput("8:75") === null, "minute>59 rejected");
ok(normalizeTimeInput("eightish") === null, "garbage rejected");

console.log("4. LOCATION_SUGGESTIONS chip contract");
ok(Array.isArray(LOCATION_SUGGESTIONS) && LOCATION_SUGGESTIONS.length === 2, "two options");
const ids = LOCATION_SUGGESTIONS.map((s) => s.id).sort();
ok(ids.join(",") === "in_person,online", "ids are online + in_person");
ok(
  LOCATION_SUGGESTIONS.every((s) => typeof s.label === "string" && s.label.length > 0),
  "every option has a label",
);

console.log("5. hijack guard (looksLikeClarificationAnswer)");
for (const cmd of [
  "setup a meeting with gokhan tomorrow at 8",
  "book a room for friday",
  "reschedule the standup to 9am",
  "cancel my 3pm",
  "schedule a call with mounir",
  "show my open raid items",
]) {
  ok(!looksLikeClarificationAnswer(cmd), `command not hijacked: "${cmd}"`);
}
for (const answer of ["in person", "online", "8am", "Gökhan", "tomorrow at 8", "yes"]) {
  ok(looksLikeClarificationAnswer(answer), `plausible answer accepted: "${answer}"`);
}

console.log("6. timeFromMeetingQuery (find meetings by time, not title)");
for (const [raw, want] of [
  ["7:00am", "07:00"],
  ["tomorrow's 7:00am meeting", "07:00"],
  ["the 8:30", "08:30"],
  ["7 p.m.", "19:00"],
  ["meeting at 0800", "08:00"],
  ["9am one", "09:00"],
  ["7", "07:00"],
] as const) {
  ok(timeFromMeetingQuery(raw) === want, `"${raw}" → ${want}`);
}
ok(timeFromMeetingQuery("catch up") === null, "topic words stay a title query");
ok(timeFromMeetingQuery("pipeline review") === null, "no digits → null");
// Date-like numbers must never be read as times (mis-targeting guard).
ok(timeFromMeetingQuery("2026-07-22 review") === null, "ISO date not a time");
ok(timeFromMeetingQuery("meeting on 2026/07/22") === null, "slash date not a time");
ok(timeFromMeetingQuery("review 12/09") === null, "MM/DD not a time");
ok(timeFromMeetingQuery("phase 2 planning") === null, "bare number without time context");
ok(timeFromMeetingQuery("on 2026-07-22 at 7pm") === "19:00", "date + time → time wins");
ok(dateFromMeetingQuery("on 2026-07-22 at 7pm") === "2026-07-22", "explicit date extracted");
ok(dateFromMeetingQuery("tomorrow's 7:00am meeting") === null, "no explicit date → null");

console.log("6b. reliability helpers (Task #570)");
{
  const now = new Date("2026-07-22T12:00:00Z");
  ok(isPastSlot(new Date("2026-07-22T11:00:00Z"), now), "1h ago is past");
  ok(!isPastSlot(new Date("2026-07-22T11:59:00Z"), now), "within 2-min grace not past");
  ok(!isPastSlot(new Date("2026-07-22T15:00:00Z"), now), "future not past");

  const row = (over: Partial<SameSlotMeeting>): SameSlotMeeting => ({
    id: "m1",
    title: "Weekly Sync",
    parentType: "internal",
    createdByUserId: "u1",
    internalAttendees: [{ userId: "u1" }, { userId: "u2" }],
    joinUrl: null,
    startAt: null,
    endAt: null,
    locationType: "online",
    ...over,
  });
  ok(
    pickReplayMatch([row({})], { createdByUserId: "u1", title: "weekly sync", parentType: "internal" })?.id === "m1",
    "replay match: same organizer + folded title + parent",
  );
  ok(
    pickReplayMatch([row({})], { createdByUserId: "u2", title: "Weekly Sync", parentType: "internal" }) === null,
    "replay: different organizer no match",
  );
  ok(
    pickReplayMatch([row({})], { createdByUserId: "u1", title: "Weekly Sync", parentType: "opportunity" }) === null,
    "replay: different parent type no match",
  );
  ok(
    buildDuplicateWarning([row({ createdByUserId: "u9" })], { title: "WEEKLY SYNC", attendeeUserIds: [] }).includes("already booked"),
    "duplicate warning fires on folded-title clash",
  );
  ok(
    buildDuplicateWarning([row({ title: "Other" })], { title: "Weekly Sync", attendeeUserIds: ["u2", "u1"] }).includes("already booked"),
    "duplicate warning fires on identical attendee set",
  );
  ok(
    buildDuplicateWarning([row({ title: "Other" })], { title: "Weekly Sync", attendeeUserIds: ["u3"] }) === "",
    "no warning when title and roster differ",
  );
}

console.log("7. attendee refusal helpers");
ok(looksLikeEmailAddress("jane@example.com"), "email detected");
ok(!looksLikeEmailAddress("Gökhan Güney"), "name is not an email");
ok(isSelfReference("me", "Mounir Guen"), "'me' is self");
ok(isSelfReference("mounir", "Mounir Guen"), "own first name is self");
ok(!isSelfReference("gokhan", "Mounir Guen"), "other name is not self");

console.log("8. mid-flow clarification corrections (reRouteClarificationAnswer)");
ok(CLARIFICATION_REROUTE_TOOLS.has("schedule_internal_meeting"), "internal scheduler reroutes");
ok(CLARIFICATION_REROUTE_TOOLS.has("schedule_client_meeting"), "client scheduler reroutes");
{
  const r1 = reRouteClarificationAnswer("locationType", "actually make it 3pm");
  ok(r1?.field === "time" && r1.value === "15:00", "location question answered with a time → rerouted to time");
  const r2 = reRouteClarificationAnswer("time", "actually in person");
  ok(r2?.field === "locationType" && r2.value === "in_person", "time question answered with location → rerouted");
  const r3 = reRouteClarificationAnswer("time", "no, 2026-08-01 works better");
  ok(r3?.field === "date" && r3.value === "2026-08-01", "cued explicit date → rerouted to date");
  ok(reRouteClarificationAnswer("time", "8am") === null, "plain answer to the asked field is NOT rerouted");
  ok(reRouteClarificationAnswer("locationType", "online") === null, "plain location answer stays put");
}

console.log("9. meeting intent matrix (catalog coverage)");
{
  const byTool = new Map(listCapabilities().map((c) => [c.toolName, c]));
  const expectations: Array<{ tool: string; isWrite: boolean }> = [
    { tool: "schedule_internal_meeting", isWrite: true },
    { tool: "reschedule_internal_meeting", isWrite: true },
    { tool: "cancel_internal_meeting", isWrite: true },
    { tool: "update_internal_meeting", isWrite: true },
    { tool: "schedule_client_meeting", isWrite: true },
    { tool: "check_availability", isWrite: false },
    { tool: "find_free_slot", isWrite: false },
    { tool: "meeting_list", isWrite: false },
  ];
  for (const e of expectations) {
    const cap = byTool.get(e.tool);
    ok(!!cap, `intent covered: ${e.tool} is registered`);
    ok(cap!.isWrite === e.isWrite, `${e.tool} isWrite=${e.isWrite}`);
    if (e.isWrite) ok(cap!.twoPhaseConfirm === true, `${e.tool} requires two-phase confirm`);
  }
  const listSchema = byTool.get("meeting_list")!.inputSchema as { properties?: Record<string, unknown> };
  ok(!!listSchema.properties?.dateFrom && !!listSchema.properties?.dateTo, "meeting_list supports date range");
  const schedSchema = byTool.get("schedule_internal_meeting")!.inputSchema as { properties?: Record<string, unknown> };
  ok(!!schedSchema.properties?.agenda, "internal schedule accepts an agenda");
  const clientSchema = byTool.get("schedule_client_meeting")!.inputSchema as { properties?: Record<string, unknown> };
  ok(!!clientSchema.properties?.agenda, "client schedule accepts an agenda");
}

console.log("10. availability tools reject explicit past date/times");
{
  const byTool = new Map(listCapabilities().map((c) => [c.toolName, c]));
  const ctx = { persona: { id: "u-probe", orgId: "org-probe", name: "Probe User" } } as never;
  const check = byTool.get("check_availability")!;
  const free = byTool.get("find_free_slot")!;

  const pastAt = (await check.run({ date: "2020-01-06", time: "3pm" }, ctx)) as {
    ok: boolean;
    errorCode?: string;
  };
  ok(!pastAt.ok && pastAt.errorCode === "past_time", "check_availability: past date+time → past_time");

  const pastDay = (await check.run({ date: "2020-01-06" }, ctx)) as { ok: boolean; errorCode?: string };
  ok(!pastDay.ok && pastDay.errorCode === "past_time", "check_availability: whole past day → past_time");

  const pastSearch = (await free.run({ people: ["Gökhan"], date: "2020-01-06" }, ctx)) as {
    ok: boolean;
    errorCode?: string;
  };
  ok(!pastSearch.ok && pastSearch.errorCode === "past_time", "find_free_slot: past date → past_time");

  const badDate = (await check.run({ date: "next tuesday" }, ctx)) as { ok: boolean; errorCode?: string };
  ok(!badDate.ok && badDate.errorCode === "invalid_input", "relative date string rejected (must be resolved to YYYY-MM-DD)");
}

console.log("11. intent utterance matrix (accented × unaccented × refusals)");
{
  // Accent variants: every roster-name utterance must fold to the same
  // needle regardless of how the user typed it.
  for (const [typed, roster] of [
    ["gokhan", "Gökhan Güney"],
    ["Gökhan", "Gökhan Güney"],
    ["GOKHAN GUNEY", "Gökhan Güney"],
    ["isil", "Işıl Şahin"],
    ["Şahin", "isil sahin"],
    ["cagla", "Çağla Öztürk"],
  ] as const) {
    ok(foldRosterName(roster).includes(foldRosterName(typed)), `accent variant resolves: "${typed}" → "${roster}"`);
  }

  // Graceful-refusal surface: raw emails and recurring/room asks are
  // refused with guidance, not silently mis-handled. Raw-email detection
  // is the shared helper; recurring/rooms are contract-level (the tool
  // descriptions must keep saying they're unsupported so the model
  // refuses instead of hallucinating a booking).
  ok(looksLikeEmailAddress("someone@outside.com"), "raw external email detected for refusal path");
  const byTool = new Map(listCapabilities().map((c) => [c.toolName, c]));
  const schedDesc = byTool.get("schedule_internal_meeting")!.description.toLowerCase();
  ok(schedDesc.includes("recurring"), "internal scheduler description declares recurring unsupported");
  ok(schedDesc.includes("room"), "internal scheduler description declares room booking unsupported");

  // Screenshot utterance from the task: "setup a meeting with gokhan
  // tomorrow at 8" — must be treated as a fresh command (not a
  // clarification answer) and its time token must normalize.
  ok(!looksLikeClarificationAnswer("setup a meeting with gokhan tomorrow at 8"), "screenshot utterance routes as a fresh command");
  ok(normalizeTimeInput("8") === "08:00", "screenshot utterance time token normalizes");
  ok(foldRosterName("Gökhan Güney").includes(foldRosterName("gokhan")), "screenshot utterance attendee folds to roster row");
}

console.log(`\nAll ${passed} probes passed.`);
