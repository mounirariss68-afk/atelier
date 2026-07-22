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
import { looksLikeClarificationAnswer } from "../../src/lib/atelier-cli/index.js";
import { dateFromMeetingQuery, timeFromMeetingQuery } from "../../src/lib/atelier-cli/internal-meeting-capabilities.js";

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

console.log(`\nAll ${passed} probes passed.`);
