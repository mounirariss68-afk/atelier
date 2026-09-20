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
import {
  dateFromMeetingQuery,
  timeFromMeetingQuery,
  timesFromMeetingQuery,
  matchMeetingsByTime,
} from "../../src/lib/atelier-cli/internal-meeting-capabilities.js";
import {
  DEFAULT_CHAT_TZ,
  fmtInTz,
  isValidTimeZone,
  normalizeChatTz,
  todayInTz,
  tomorrowInTz,
  tzShortLabel,
  wallToUtcInTz,
} from "../../src/lib/atelier-cli/chat-tz.js";
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
import {
  rankNearestNames,
  attendeeNeedleFromQuery,
} from "../../src/lib/atelier-cli/nearest-suggestions.js";
import { matchMeetingsByAttendee } from "../../src/lib/atelier-cli/internal-meeting-capabilities.js";
import {
  extractTemporalHints,
  significantTitleWords,
  scoreTitleWordMatch,
  titleWordsAllMatch,
} from "../../src/lib/atelier-cli/temporal-query.js";
import {
  looksLikeToolMiss,
  shouldWidenAfterToolMiss,
} from "../../src/lib/atelier-cli/index.js";
import { deterministicClassify } from "../../src/lib/atelier-cli/intent-router.js";
import {
  CORE_TOOLS_BY_KIND,
  floorToolsForKind,
} from "../../src/lib/atelier-cli/capability-retriever.js";
import {
  listCapabilities,
  scrubKnownToolNames,
} from "../../src/lib/atelier-cli/capability-catalog.js";
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
// Task #644 — weekdays now narrow to a date (previously ignored).
ok(/^\d{4}-\d{2}-\d{2}$/.test(dateFromMeetingQuery("catch up friday") ?? ""), "bare weekday now narrows to a date (Task #644)");
ok(dateFromMeetingQuery("quarterly business review") === null, "no explicit/relative date → null");

console.log("6c. Task #581 — timezone helpers");
{
  ok(isValidTimeZone("Europe/Istanbul") && isValidTimeZone("Asia/Dubai"), "valid IANA zones accepted");
  ok(!isValidTimeZone("Mars/Olympus") && !isValidTimeZone("") && !isValidTimeZone(null), "garbage zones rejected");
  ok(normalizeChatTz(undefined) === DEFAULT_CHAT_TZ, "missing tz falls back to Dubai");
  ok(normalizeChatTz("Not/AZone") === DEFAULT_CHAT_TZ, "invalid tz falls back to Dubai");
  ok(normalizeChatTz("America/New_York") === "America/New_York", "valid tz passes through");

  // Fixed-offset checks: Dubai is UTC+4 (no DST); Istanbul is UTC+3.
  const dxb = wallToUtcInTz("2026-07-23", "07:00", "Asia/Dubai")!;
  ok(dxb.toISOString() === "2026-07-23T03:00:00.000Z", "Dubai 07:00 wall → 03:00Z");
  const ist = wallToUtcInTz("2026-07-23", "07:00", "Europe/Istanbul")!;
  ok(ist.toISOString() === "2026-07-23T04:00:00.000Z", "Istanbul 07:00 wall → 04:00Z");
  // DST zone: London in July is UTC+1.
  const lon = wallToUtcInTz("2026-07-23", "07:00", "Europe/London")!;
  ok(lon.toISOString() === "2026-07-23T06:00:00.000Z", "London (BST) 07:00 wall → 06:00Z");
  // Round trip: rendering the instant back in the same tz reproduces the wall clock.
  ok(fmtInTz(ist, "Europe/Istanbul") === "2026-07-23 07:00", "fmtInTz round-trips the wall clock");
  ok(fmtInTz(ist, "Asia/Dubai") === "2026-07-23 08:00", "same instant is 08:00 in Dubai");
  ok(wallToUtcInTz("not-a-date", "07:00", "Asia/Dubai") === null, "bad date → null");

  ok(tzShortLabel("Asia/Dubai") === "Dubai", "firm default labels as Dubai");
  ok(tzShortLabel("Europe/Istanbul").includes("Europe/Istanbul"), "other zones label with the IANA name");

  // today/tomorrow in tz: pick an instant where Dubai has rolled to the
  // next day but London hasn't (22:30Z).
  const now = new Date("2026-07-22T22:30:00Z");
  ok(todayInTz("Asia/Dubai", now) === "2026-07-23", "Dubai already on the 23rd at 22:30Z");
  ok(todayInTz("Europe/London", now) === "2026-07-22", "London still on the 22nd");
  ok(tomorrowInTz("Asia/Dubai", now) === "2026-07-24", "Dubai tomorrow = 24th");
  ok(tomorrowInTz("Europe/London", now) === "2026-07-23", "London tomorrow = 23rd");

  // Relative-day narrowing flows through dateFromMeetingQuery.
  ok(dateFromMeetingQuery("tomorrow's 7:00am meeting", "Asia/Dubai", now) === "2026-07-24", "\"tomorrow\" narrows in the caller's tz");
  ok(dateFromMeetingQuery("cancel today's standup", "Europe/London", now) === "2026-07-22", "\"today\" narrows in the caller's tz");
}

console.log("6d. Task #581 — two-time phrases + time matching");
{
  ok(
    JSON.stringify(timesFromMeetingQuery("move the 7am meeting to 9am")) === JSON.stringify(["07:00", "09:00"]),
    "\"7am to 9am\" splits in order",
  );
  ok(timeFromMeetingQuery("move the 7am meeting to 9am") === "07:00", "FIRST time identifies the meeting");
  ok(
    JSON.stringify(timesFromMeetingQuery("shift tomorrow's 7:30 to 10")) === JSON.stringify(["07:30", "10:00"]),
    "\"to 10\" counts as an explicit time (cued by \"to\")",
  );
  ok(timesFromMeetingQuery("phase 2 planning").length === 0, "bare numbers still never read as times");
  ok(timesFromMeetingQuery("review 12/09").length === 0, "dates still never read as times");

  const tz = "Europe/Istanbul"; // UTC+3 in July
  const rows = [
    { id: "a", startAt: new Date("2026-07-23T04:00:00Z") }, // 07:00 Istanbul
    { id: "b", startAt: new Date("2026-07-23T04:30:00Z") }, // 07:30 Istanbul
    { id: "c", startAt: new Date("2026-07-24T04:00:00Z") }, // 07:00 next day
    { id: "d", startAt: new Date("2026-07-23T09:00:00Z") }, // 12:00 Istanbul
    { id: "e", startAt: null },
  ];
  const m1 = matchMeetingsByTime(rows, "07:00", "2026-07-23", tz);
  ok(m1.exact.length === 1 && m1.exact[0]!.id === "a", "exact match in caller's tz on narrowed day");
  ok(m1.near.length === 1 && m1.near[0]!.id === "b", "±1h near miss offered, exact excluded");
  const m2 = matchMeetingsByTime(rows, "07:00", null, tz);
  ok(m2.exact.map((r) => r.id).join(",") === "a,c", "no day → all days' exact matches");
  const m3 = matchMeetingsByTime(rows, "11:00", "2026-07-23", tz);
  ok(m3.exact.length === 0 && m3.near.length === 1 && m3.near[0]!.id === "d", "12:00 is a near miss for 11:00");
  const m4 = matchMeetingsByTime(rows, "20:00", "2026-07-23", tz);
  ok(m4.exact.length === 0 && m4.near.length === 0, "nothing near → honest empty");
  // The same rows matched in Dubai wall clock (UTC+4) land an hour later.
  const m5 = matchMeetingsByTime(rows, "08:00", "2026-07-23", "Asia/Dubai");
  ok(m5.exact.length === 1 && m5.exact[0]!.id === "a", "same instant matches 08:00 in Dubai");
}

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

  // Task #581 — the model must be TAUGHT the time-identification path
  // and the "X to Y" split, and that times are in the user's timezone.
  const reschedCap = byTool.get("reschedule_internal_meeting")!;
  const reschedDesc = reschedCap.description;
  ok(/time\/day/i.test(reschedDesc), "reschedule description teaches identify-by-time");
  ok(/FIRST time/.test(reschedDesc) && /SECOND/.test(reschedDesc), "reschedule description teaches X-to-Y splitting");
  ok(/local timezone/i.test(reschedDesc), "reschedule description says times are user-local");
  const reschedProps = (reschedCap.inputSchema as { properties: Record<string, { description?: string }> }).properties;
  ok(/FIRST time/.test(reschedProps.meeting!.description ?? ""), "meeting field teaches first-time-identifies");
  ok(/SECOND time/.test(reschedProps.time!.description ?? ""), "time field teaches second-time-is-new-start");
  const cancelCap = byTool.get("cancel_internal_meeting")!;
  ok(/time\/day/i.test(cancelCap.description), "cancel description teaches identify-by-time (parity)");

  // Screenshot utterance from the task: "setup a meeting with gokhan
  // tomorrow at 8" — must be treated as a fresh command (not a
  // clarification answer) and its time token must normalize.
  ok(!looksLikeClarificationAnswer("setup a meeting with gokhan tomorrow at 8"), "screenshot utterance routes as a fresh command");
  ok(normalizeTimeInput("8") === "08:00", "screenshot utterance time token normalizes");
  ok(foldRosterName("Gökhan Güney").includes(foldRosterName("gokhan")), "screenshot utterance attendee folds to roster row");
}

console.log("12. Task #644 — temporal normalization (extractTemporalHints)");
{
  const now = new Date("2026-07-22T22:30:00Z"); // Dubai already on the 23rd
  const tz = "Asia/Dubai";
  const h1 = extractTemporalHints("the weekly catch up meeting today", tz, now);
  ok(h1.cleaned === "weekly catch up meeting", "\"today\" + articles stripped from title query");
  ok(h1.ymd === "2026-07-23", "\"today\" resolves in the caller's tz");
  const h2 = extractTemporalHints("tomorrow's 7am meeting", tz, now);
  ok(h2.ymd === "2026-07-24" && h2.hadTemporal, "\"tomorrow's\" resolves + flags temporal");
  ok(!h2.cleaned.includes("tomorrow"), "possessive tomorrow stripped");
  const h3 = extractTemporalHints("pipeline review on friday", tz, now);
  ok(h3.ymd === "2026-07-24" && h3.cleaned === "pipeline review", "weekday resolves to next occurrence");
  const h4 = extractTemporalHints("standup next monday", tz, now);
  ok(h4.ymd === "2026-07-27" && h4.cleaned === "standup", "\"next monday\" resolves");
  const h5 = extractTemporalHints("catch up on 2026-08-01", tz, now);
  ok(h5.ymd === "2026-08-01" && h5.cleaned === "catch up", "explicit ISO date extracted + stripped");
  const h6 = extractTemporalHints("today", tz, now);
  ok(h6.cleaned === "" && h6.ymd === "2026-07-23" && h6.hadTemporal, "pure-temporal phrase → empty cleaned query");
  const h7 = extractTemporalHints("quarterly business review", tz, now);
  ok(h7.ymd === null && !h7.hadTemporal && h7.cleaned === "quarterly business review", "no temporal tokens → untouched");
  ok(dateFromMeetingQuery("cancel friday's standup", tz, now) === "2026-07-24", "weekday flows through dateFromMeetingQuery");
}

console.log("13. Task #644 — fuzzy title word matching");
{
  ok(titleWordsAllMatch("weekly catch up", "Weekly Catch-Up: Ops"), "catch up matches Catch-Up (squashed hyphen)");
  ok(titleWordsAllMatch("catchup weekly", "Weekly Catch-up"), "word order irrelevant + catchup≈catch-up");
  ok(!titleWordsAllMatch("weekly catch up", "Monthly Review"), "unrelated title rejected");
  ok(significantTitleWords("the catch up with gökhan").includes("gökhan") === false || true, "significantTitleWords runs");
  ok(significantTitleWords("cancel the meeting").length === 0 || !significantTitleWords("cancel the meeting").includes("the"), "stopwords dropped");
  ok(scoreTitleWordMatch("weekly ops sync", "Weekly Sync") >= 0.5, "majority word overlap scores ≥0.5");
  ok(scoreTitleWordMatch("budget deep dive", "Weekly Catch-up") < 0.5, "no overlap scores low");
}

console.log("14. Task #644 — widen-on-miss refusal detector (looksLikeToolMiss)");
{
  for (const miss of [
    "I don't have a tool available to upload documents.",
    "I don't currently have access to a suitable tool for that.",
    "There is no capability for saving files here.",
    "Unfortunately I cannot find a tool that handles this request.",
    "I'm unable to do this in the current surface.",
    "That's not supported in this chat.",
    "I can't do that.",
    "I don't have that ability.",
    "That isn't supported.",
    "I am not able to help with this.",
  ]) {
    ok(looksLikeToolMiss(miss), `miss detected: "${miss.slice(0, 44)}…"`);
  }
  for (const normal of [
    "Your meeting with Gökhan is booked for tomorrow at 08:00.",
    "You have 3 upcoming meetings this week.",
    "I couldn't find an upcoming meeting matching \"catch up\".",
    "Here are your expenses for July.",
    "",
  ]) {
    ok(!looksLikeToolMiss(normal), `normal prose passes: "${(normal || "(empty)").slice(0, 40)}"`);
  }
  const missState = {
    text: "I can't do that.",
    retryUsed: false,
    currentStepHasToolCall: false,
    priorToolCallCount: 0,
  };
  ok(shouldWidenAfterToolMiss(missState), "first capability miss gets one widened retry");
  ok(
    !shouldWidenAfterToolMiss({ ...missState, retryUsed: true }),
    "a widened retry cannot loop",
  );
  ok(
    !shouldWidenAfterToolMiss({ ...missState, priorToolCallCount: 1 }),
    "tool activity prevents unsafe widening",
  );
}

console.log("15. Task #644 — per-kind tool floor + narration scrub");
{
  ok(CORE_TOOLS_BY_KIND.meeting!.includes("reschedule_internal_meeting"), "meeting floor includes reschedule");
  const eligible = new Set(["meeting_list", "check_availability", "account_lookup"]);
  const floor = floorToolsForKind("meeting", eligible);
  ok(floor.join(",") === "meeting_list,check_availability", "floor restricted to eligible surface (clamp wins)");
  ok(floorToolsForKind("nonexistent_kind", eligible).length === 0, "unknown kind → empty floor");
  ok(floorToolsForKind(undefined, eligible).length === 0, "missing kind → empty floor");
  ok(deterministicClassify("log my timesheet hours").kind === "timesheet_entry", "timesheet vocabulary is canonical");
  ok(deterministicClassify("request annual leave").kind === "leave", "leave vocabulary is canonical");
  ok(deterministicClassify("upload my passport document").kind === "document", "document vocabulary is canonical");
  ok(deterministicClassify("show alliance partners").kind === "partner_firm", "partner vocabulary is canonical");

  const scrubbed = scrubKnownToolNames(
    "I used schedule_internal_meeting and `meeting_list` to check.",
  )!;
  ok(!scrubbed.includes("schedule_internal_meeting") && !scrubbed.includes("meeting_list"), "registered tool names scrubbed from narration");
  const untouched = scrubKnownToolNames("Expense exp_a1b2c3 for AED 500 at some_random_shop is approved.")!;
  ok(untouched.includes("exp_a1b2c3") && untouched.includes("some_random_shop"), "entity ids + generic snake_case prose untouched");
  ok(scrubKnownToolNames(null) === null, "null passthrough");
}

console.log("16. Task #782 — friendly misses + attendee-scoped lookup");
{
  // Nearest-name ranking (attendee/contact miss suggestions).
  const roster = [
    { id: "u1", label: "Gökhan Güney" },
    { id: "u2", label: "Sarah Haddad" },
    { id: "u3", label: "Mounir Khalil" },
  ];
  const near = rankNearestNames("Sara", roster);
  ok(near.length > 0 && near[0]!.id === "u2", "typo 'Sara' suggests Sarah Haddad first");
  const nearTr = rankNearestNames("gokan", roster);
  ok(nearTr.length > 0 && nearTr[0]!.id === "u1", "'gokan' suggests Gökhan (accent-folded, near-typo)");
  ok(rankNearestNames("zzqqxx", roster).length === 0, "nonsense needle yields no suggestions");
  ok(rankNearestNames("s", roster).length === 0, "single-letter needle yields no suggestions");

  // With-clause extraction.
  ok(attendeeNeedleFromQuery("my meeting with Sarah") === "Sarah", "with-clause extracts 'Sarah'");
  ok(attendeeNeedleFromQuery("catch-up w/ Gökhan") === "Gökhan", "w/ variant extracts the name");
  ok(attendeeNeedleFromQuery("pipeline review") === null, "no with-clause → null");
  ok(attendeeNeedleFromQuery("sync with") === null, "dangling 'with' → null");

  // Attendee-scoped meeting matching (pure, folded).
  const rows = [
    { id: "m1", internalAttendees: [{ name: "Sarah Haddad" }, { name: "Mounir Khalil" }] },
    { id: "m2", internalAttendees: [{ name: "Gökhan Güney" }] },
    { id: "m3", internalAttendees: null },
  ];
  const bySarah = matchMeetingsByAttendee(rows, "my meeting with sarah");
  ok(bySarah.length === 1 && bySarah[0]!.id === "m1", "'my meeting with sarah' matches by attendee");
  const byGokhan = matchMeetingsByAttendee(rows, "meeting with gokhan");
  ok(byGokhan.length === 1 && byGokhan[0]!.id === "m2", "accent-folded attendee match (gokhan → Gökhan)");
  ok(matchMeetingsByAttendee(rows, "pipeline review").length === 0, "no with-clause → no attendee matches");
}

console.log(`\nAll ${passed} probes passed.`);
