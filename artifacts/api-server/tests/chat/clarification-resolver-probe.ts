/**
 * Task #740 — offline probe for the shared clarification resolver.
 *
 * Pure, DB-free, LLM-free (deterministic layer only). Covers the exact
 * screenshot scenario that motivated the task:
 *   hotels ask → "5 nights" → "same dates I specified" → "confirmed"
 *   = ONE clarification round, then the real search runs.
 * Plus the locale matrix (EN/TR/AR incl. Arabic-Indic digits), ordinal
 * choices, control intents, and answer-vs-fresh-request classification.
 *
 * Run: pnpm run test:chat-clarify   (from artifacts/api-server)
 */

import {
  addDaysIso,
  clarificationResolverMode,
  matchOption,
  normalizeDigits,
  parseNightsDuration,
  parseOrdinalChoice,
  parseRelativeDate,
  resolveClarificationReply,
  resolveSameDates,
  type FactRow,
  type PendingClarificationSpec,
} from "../../src/lib/atelier-cli/clarification-resolver.js";

process.env.ATELIER_CLI_RESOLVER_LLM = "off"; // stay offline

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
};

const TZ = "Asia/Dubai";
// Fixed "now": Wed 2026-07-29 08:00 Dubai time.
const NOW = new Date("2026-07-29T04:00:00Z");

// ---------------------------------------------------------------------
console.log("[group] digit + duration parsing");
check("arabic-indic digits normalize", normalizeDigits("٥ ليال") === "5 ليال");
check("'5 nights'", parseNightsDuration("5 nights") === 5);
check("'for 5 nights'", parseNightsDuration("for 5 nights") === 5);
check("'five nights'", parseNightsDuration("five nights") === 5);
check("'5 gece' (TR)", parseNightsDuration("5 gece") === 5);
check("'٥ ليال' (AR)", parseNightsDuration("٥ ليال") === 5);
check("non-duration rejected", parseNightsDuration("nightly rates") === null);

// ---------------------------------------------------------------------
console.log("[group] relative dates (tz-resolved)");
check("ISO passthrough", parseRelativeDate("2027-03-02", TZ, NOW) === "2027-03-02");
check("today", parseRelativeDate("today", TZ, NOW) === "2026-07-29");
check("tomorrow", parseRelativeDate("tomorrow", TZ, NOW) === "2026-07-30");
check("yarın (TR)", parseRelativeDate("yarın", TZ, NOW) === "2026-07-30");
check("غدا (AR)", parseRelativeDate("غدا", TZ, NOW) === "2026-07-30");
check("بعد غد (AR)", parseRelativeDate("بعد غد", TZ, NOW) === "2026-07-31");
check("in 3 days", parseRelativeDate("in 3 days", TZ, NOW) === "2026-08-01");
check("3 gün sonra (TR)", parseRelativeDate("3 gün sonra", TZ, NOW) === "2026-08-01");
check("in 2 weeks", parseRelativeDate("in 2 weeks", TZ, NOW) === "2026-08-12");
// 2026-07-29 is a Wednesday.
check("friday → next Fri", parseRelativeDate("friday", TZ, NOW) === "2026-07-31");
check("next tuesday", parseRelativeDate("next tuesday", TZ, NOW) === "2026-08-04");
check("wednesday said on Wed → +7", parseRelativeDate("wednesday", TZ, NOW) === "2026-08-05");
check("cuma (TR)", parseRelativeDate("cuma", TZ, NOW) === "2026-07-31");
check("الخميس (AR)", parseRelativeDate("الخميس", TZ, NOW) === "2026-07-30");
check("3 March (past → next year)", parseRelativeDate("3 March", TZ, NOW) === "2027-03-03");
check("Sep 12", parseRelativeDate("Sep 12", TZ, NOW) === "2026-09-12");
check("not a date", parseRelativeDate("book me a hotel", TZ, NOW) === null);

// ---------------------------------------------------------------------
console.log("[group] ordinal + option matching");
check("'the second one'", parseOrdinalChoice("the second one", 3) === 1);
check("'option 2'", parseOrdinalChoice("option 2", 3) === 1);
check("'2nd'", parseOrdinalChoice("2nd", 3) === 1);
check("'last'", parseOrdinalChoice("last", 4) === 3);
check("'ikinci' (TR)", parseOrdinalChoice("ikinci", 3) === 1);
check("'الثاني' (AR)", parseOrdinalChoice("الثاني", 3) === 1);
check("out of range", parseOrdinalChoice("9", 3) === null);
const OPTS = ["Emirates EK 322", "Turkish Airlines TK 761", "flydubai FZ 401"];
check("option exact", matchOption("turkish airlines tk 761", OPTS) === OPTS[1]);
check("option ordinal", matchOption("the second one", OPTS) === OPTS[1]);
check("option contains", matchOption("flydubai", OPTS) === OPTS[2]);
check("ambiguous → null", matchOption("deluxe", ["Deluxe Room", "Deluxe Suite", "Standard Room"]) === null);

// ---------------------------------------------------------------------
console.log("[group] resolver outcomes");
const FACTS: FactRow[] = [
  { kind: "date", key: "departure_date", value: "2027-03-02", display: "departure 2 Mar 2027" },
  { kind: "date", key: "return_date", value: "2027-03-07", display: "return 7 Mar 2027" },
  { kind: "quantity", key: "nights", value: 5, display: "5 nights" },
  { kind: "place", key: "destination", value: "Istanbul", display: "Istanbul" },
];
const staysPending: PendingClarificationSpec = {
  tool: "travel_search_stays",
  field: "checkIn",
  question: "What are your check-in and check-out dates?",
  partial: { city: "Istanbul" },
  fields: [
    { field: "checkIn", label: "Check-in", inputType: "date" },
    { field: "checkOut", label: "Check-out", inputType: "date" },
  ],
};
const r = (reply: string, pending = staysPending, facts = FACTS) =>
  resolveClarificationReply({ reply, pending, facts, timezone: TZ, now: NOW });

// Screenshot scenario, step by step.
{
  // Turn 1: "5 nights" — anchor comes from the departure-date fact.
  const o1 = r("5 nights");
  check("'5 nights' → typed values", o1.kind === "values", o1);
  if (o1.kind === "values") {
    check("checkIn from fact anchor", o1.values.checkIn === "2027-03-02", o1.values);
    check("checkOut = anchor+5", o1.values.checkOut === "2027-03-07", o1.values);
  }
  // Turn 2: "same dates I specified" — referential resolution.
  const o2 = r("same dates I specified");
  check("'same dates' → typed values", o2.kind === "values", o2);
  if (o2.kind === "values") {
    check("referential checkIn", o2.values.checkIn === "2027-03-02", o2.values);
    check("referential checkOut", o2.values.checkOut === "2027-03-07", o2.values);
  }
  // Turn 3: "confirmed" — executes with fact-derived fills, no re-ask.
  const o3 = r("confirmed");
  check("'confirmed' → confirm outcome", o3.kind === "confirm", o3);
  if (o3.kind === "confirm") {
    check("confirm fills dates from facts", o3.values.checkIn === "2027-03-02" && o3.values.checkOut === "2027-03-07", o3.values);
  }
  // End-to-end: exactly ONE clarification round — after any of the
  // three replies the asked fields are complete, so the tool runs.
  const merged = { ...staysPending.partial, ...(o1.kind === "values" ? o1.values : {}) };
  check(
    "screenshot scenario: one round then search",
    typeof merged.checkIn === "string" && typeof merged.checkOut === "string",
    merged,
  );
}

// Nights with anchor in PARTIAL (no facts needed).
{
  const pending: PendingClarificationSpec = {
    ...staysPending,
    field: "checkOut",
    partial: { city: "Istanbul", checkIn: "2027-04-10" },
    fields: [{ field: "checkOut", label: "Check-out", inputType: "date" }],
  };
  const o = resolveClarificationReply({ reply: "3 nights", pending, facts: [], timezone: TZ, now: NOW });
  check("nights anchored on partial.checkIn", o.kind === "values" && o.values.checkOut === "2027-04-13", o);
}
// Nights with NO anchor anywhere → honest unparsed (tool re-asks).
{
  const o = resolveClarificationReply({ reply: "5 nights", pending: staysPending, facts: [], timezone: TZ, now: NOW });
  check("nights without anchor → unparsed", o.kind === "unparsed", o);
}
// Relative date answer for a date field.
{
  const o = r("next tuesday");
  check("relative date → ISO value", o.kind === "values" && o.values.checkIn === "2026-08-04", o);
}
// Control intents.
check("'cancel' → cancel", r("never mind").kind === "cancel");
check("'no' (no yes/no options) → cancel", r("no").kind === "cancel");
{
  const ynPending: PendingClarificationSpec = {
    tool: "schedule_internal_meeting",
    field: "sendInvites",
    question: "Send calendar invites?",
    partial: {},
    fields: [{ field: "sendInvites", options: ["yes", "no"] }],
  };
  const oy = resolveClarificationReply({ reply: "yes", pending: ynPending, facts: [], timezone: TZ, now: NOW });
  const on = resolveClarificationReply({ reply: "no", pending: ynPending, facts: [], timezone: TZ, now: NOW });
  check("'yes' with yes/no options → literal option", oy.kind === "values" && oy.values.sendInvites === "yes", oy);
  check("'no' with yes/no options → literal option", on.kind === "values" && on.values.sendInvites === "no", on);
}
// Confirm without derivable fills still confirms (tool re-validates).
{
  const o = resolveClarificationReply({ reply: "confirmed", pending: staysPending, facts: [], timezone: TZ, now: NOW });
  check("bare confirm w/o facts → confirm with no fills", o.kind === "confirm" && Object.keys(o.values).length === 0, o);
}
// Fresh requests keep their shape.
check("multi-line → fresh_request", r("show me my expenses\nfrom last month").kind === "fresh_request");
check("command opener → fresh_request", r("show my meetings for today").kind === "fresh_request");
check("'cancel <thing>' → fresh_request", r("cancel my flight to Istanbul").kind === "fresh_request");
// Decline mapping across non-first yes/no fields + localized options.
{
  const pending: PendingClarificationSpec = {
    tool: "schedule_internal_meeting",
    field: "topic",
    question: "Topic, and should I send invites?",
    partial: { topic: "Weekly sync" },
    fields: [
      { field: "topic" },
      { field: "sendInvites", options: ["Yes", "No"] },
    ],
  };
  const o = resolveClarificationReply({ reply: "no", pending, facts: [], timezone: TZ, now: NOW });
  check("'no' maps to non-first yes/no field", o.kind === "values" && o.values.sendInvites === "No", o);
}
check("long prose → fresh_request", r("x".repeat(140)).kind === "fresh_request");
// Short non-answer → unparsed (legacy merge / LLM assist path).
check("gibberish short → unparsed", r("hmm not sure").kind === "unparsed");
// Number field.
{
  const pending: PendingClarificationSpec = {
    tool: "travel_search_stays",
    field: "adults",
    question: "How many adults?",
    partial: {},
    fields: [{ field: "adults" }],
  };
  const o = resolveClarificationReply({ reply: "٢", pending, facts: [], timezone: TZ, now: NOW });
  check("arabic-indic number answer", o.kind === "values" && o.values.adults === "2", o);
}
// resolveSameDates direct.
{
  const same = resolveSameDates(
    [{ field: "checkIn", inputType: "date" }, { field: "checkOut", inputType: "date" }],
    FACTS,
  );
  check("resolveSameDates maps begin/end", same?.checkIn === "2027-03-02" && same?.checkOut === "2027-03-07", same);
}
// resolveSameDates — positional keys + tool-family scoping in a MIXED
// fact set: unrelated date facts (contract deadlines, meetings) must
// never become trip anchors when travel facts exist.
{
  const mixed = [
    { kind: "date", key: "contract_status.dueDate", value: "2027-01-15" },
    { kind: "date", key: "travel_search_flights.segments.0.date", value: "2027-03-02" },
    { kind: "date", key: "travel_search_flights.segments.1.date", value: "2027-03-07" },
    { kind: "date", key: "meeting_list.when", value: "2027-12-31" },
  ] as any[];
  const same = resolveSameDates(
    [{ field: "checkIn", inputType: "date" }, { field: "checkOut", inputType: "date" }],
    mixed,
    "travel_search_stays",
  );
  check(
    "resolveSameDates scopes chronological fallback to the tool family",
    same?.checkIn === "2027-03-02" && same?.checkOut === "2027-03-07",
    same,
  );
  // Without a family match the whole session is still usable.
  const global = resolveSameDates(
    [{ field: "checkIn", inputType: "date" }, { field: "checkOut", inputType: "date" }],
    mixed.filter((f) => !f.key.startsWith("travel_")),
    "travel_search_stays",
  );
  check(
    "resolveSameDates falls back to session-wide dates when no family match",
    global?.checkIn === "2027-01-15" && global?.checkOut === "2027-12-31",
    global,
  );
}
check("addDaysIso month rollover", addDaysIso("2027-02-27", 5) === "2027-03-04");
check("flag default on", clarificationResolverMode() === "on");
process.env.ATELIER_CLI_CLARIFICATION_RESOLVER = "off";
check("flag kill switch", clarificationResolverMode() === "off");

// ---------------------------------------------------------------------
console.log(`\n[clarification-resolver-probe] pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
