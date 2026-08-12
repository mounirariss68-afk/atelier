/**
 * Task #781 / #978 — offline probe for proactive-recap relevance and the
 * outcome-oriented recap composer. Pure — no DB, no LLM.
 *
 * Run: tsx ./tests/chat/recap-probe.ts (part of test:chat-suite)
 */
import {
  shouldEmitProactiveRecap,
  composeRecapCard,
  buildRecapPayload,
  describeTurnOutcome,
  outcomeOf,
  isTrivialRecapLine,
  RECAP_OUTCOME_SEP,
  PROACTIVE_RECAP_DORMANT_MS,
} from "../../src/lib/atelier-cli/recap-relevance.js";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
};

const NOW = Date.parse("2026-08-07T12:00:00Z");
const humanize = (t: string) => t.replace(/_/g, " ");

// Outcome-bearing summary (Task #978 line shape).
const outcomeSummary =
  `[09:00:01] file my hotel receipt → success (2 tools)${RECAP_OUTCOME_SEP}Done: expense create — Marriott\n` +
  `[09:05:12] book time with sarah → success (1 tool)${RECAP_OUTCOME_SEP}Done: meeting create — Sarah, Thursday`;
// Legacy prompt-echo summary — meaningful prompts, but no outcome segments.
const legacyEchoSummary =
  "[09:00:01] draft the renewal email for Acme → success (2 tools)\n" +
  "[09:05:12] show my open expense drafts → success (1 tool)";
const trivialSummary = "[17:57:13] who are you? → success";

console.log("[1] trigger — no recap at minutes-level dormancy (the reported bug)");
{
  check(
    "0h dormancy suppressed even with outcome-rich summary",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: NOW - 30_000,
      nowMs: NOW,
      rollingSummary: outcomeSummary,
    }),
  );
  check(
    "just-under-threshold dormancy suppressed",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: NOW - (PROACTIVE_RECAP_DORMANT_MS - 60_000),
      nowMs: NOW,
      rollingSummary: outcomeSummary,
    }),
  );
  check(
    "unknown lastTurnAt (0) never claims dormancy",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: 0,
      nowMs: NOW,
      rollingSummary: outcomeSummary,
    }),
  );
  check(
    "minutes-level dormancy suppressed even with open threads",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: NOW - 120_000,
      nowMs: NOW,
      rollingSummary: outcomeSummary,
      openThreads: ["You were in the middle of confirming expense create."],
    }),
  );
}

console.log("[2] trigger — recap fires after genuine dormancy WITH substance");
{
  const dormant = NOW - (PROACTIVE_RECAP_DORMANT_MS + 60_000);
  check(
    ">6h dormancy with outcome-rich summary fires",
    shouldEmitProactiveRecap({
      lastTurnAtMs: dormant,
      nowMs: NOW,
      rollingSummary: outcomeSummary,
    }),
  );
  check(
    ">6h dormancy but empty summary stays quiet",
    !shouldEmitProactiveRecap({ lastTurnAtMs: dormant, nowMs: NOW, rollingSummary: "" }),
  );
  check(
    ">6h dormancy but only trivial turns stays quiet",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: dormant,
      nowMs: NOW,
      rollingSummary: trivialSummary,
    }),
  );
  check(
    ">6h dormancy with THIN content (legacy prompt echoes only) stays quiet",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: dormant,
      nowMs: NOW,
      rollingSummary: legacyEchoSummary,
    }),
  );
  check(
    ">6h dormancy with no summary but an open thread still fires",
    shouldEmitProactiveRecap({
      lastTurnAtMs: dormant,
      nowMs: NOW,
      rollingSummary: legacyEchoSummary,
      openThreads: ["You were in the middle of confirming expense create — it was never committed."],
    }),
  );
}

console.log("[3] content — trivial lines never headline a recap");
{
  check("'who are you?' is trivial", isTrivialRecapLine("[17:57:13] who are you? → success"));
  check("'hi' is trivial", isTrivialRecapLine("[10:00:00] hi → success"));
  check("'thanks!' is trivial", isTrivialRecapLine("[10:00:00] thanks! → success"));
  check(
    "real work line is not trivial",
    !isTrivialRecapLine("[09:00:01] draft the renewal email for Acme → success (2 tools)"),
  );
  check(
    "prompt containing a trivial word mid-sentence is not trivial",
    !isTrivialRecapLine("[09:00:01] help me reconcile the Acme invoices → success (3 tools)"),
  );
  check("line without timestamp/arrow still classified by prompt", isTrivialRecapLine("hello"));
}

console.log("[4] content — composeRecapCard is outcome-oriented");
{
  const card = composeRecapCard(outcomeSummary);
  check("outcome lines become accomplishments", card !== null && card.accomplishments.length === 2);
  check(
    "accomplishment is the outcome phrase, not the prompt echo",
    card !== null &&
      card.accomplishments[0] === "Done: expense create — Marriott" &&
      !card.accomplishments[0]!.includes("file my hotel receipt"),
  );
  check("legacy echo-only summary composes to null (thin)", composeRecapCard(legacyEchoSummary) === null);
  check("all-trivial summary composes to null", composeRecapCard(trivialSummary) === null);
  check(
    "empty/null summary composes to null",
    composeRecapCard("") === null && composeRecapCard(null) === null,
  );
  const many = Array.from(
    { length: 9 },
    (_, i) => `[0${i}:00:00] task number ${i} → success (1 tool)${RECAP_OUTCOME_SEP}Done: thing ${i}`,
  ).join("\n");
  const capped = composeRecapCard(many);
  check(
    "caps at last 5 outcomes",
    capped !== null &&
      capped.accomplishments.length === 5 &&
      capped.accomplishments.includes("Done: thing 8") &&
      !capped.accomplishments.includes("Done: thing 3"),
  );
  const dupes =
    `[09:00:00] a → success (1 tool)${RECAP_OUTCOME_SEP}Looked up person search\n` +
    `[09:01:00] b → success (1 tool)${RECAP_OUTCOME_SEP}Looked up person search`;
  check(
    "consecutive duplicate outcomes collapse",
    composeRecapCard(dupes)?.accomplishments.length === 1,
  );
  const trivialWithOutcome = `[10:00:00] hi → success${RECAP_OUTCOME_SEP}Done: something`;
  check(
    "trivial prompt line contributes no outcome",
    composeRecapCard(trivialWithOutcome) === null,
  );
}

console.log("[5] outcome — describeTurnOutcome phrases");
{
  check(
    "successful write → Done: … with entity labels",
    describeTurnOutcome({
      status: "success",
      toolCalls: [{ tool: "expense_create", ok: true, isWrite: true }],
      entities: [{ kind: "expense", label: "Marriott" }],
      humanizeTool: humanize,
    }) === "Done: expense create — Marriott",
  );
  check(
    "awaiting_confirmation → drafted-awaiting phrase",
    describeTurnOutcome({
      status: "awaiting_confirmation",
      toolCalls: [],
      pendingTool: "expense_create",
      humanizeTool: humanize,
    })?.includes("awaiting your confirmation") === true,
  );
  check(
    "awaiting_clarification → unanswered-question phrase",
    describeTurnOutcome({
      status: "awaiting_clarification",
      toolCalls: [],
      humanizeTool: humanize,
    }) === "Asked you a follow-up question that wasn't answered",
  );
  check(
    "successful read → Looked up …",
    describeTurnOutcome({
      status: "read_only_no_op",
      toolCalls: [{ tool: "person_search", ok: true, isWrite: false }],
      humanizeTool: humanize,
    })?.startsWith("Looked up") === true,
  );
  check(
    "failed-only tools → null (nothing accomplished)",
    describeTurnOutcome({
      status: "error",
      toolCalls: [{ tool: "expense_create", ok: false, isWrite: true }],
      humanizeTool: humanize,
    }) === null,
  );
  check(
    "no tools, plain chat → null",
    describeTurnOutcome({ status: "success", toolCalls: [], humanizeTool: humanize }) === null,
  );
  const long = describeTurnOutcome({
    status: "success",
    toolCalls: [{ tool: "a_create", ok: true, isWrite: true }],
    entities: [{ kind: "x", label: "L".repeat(300) }],
    humanizeTool: humanize,
  });
  check("outcome phrase is length-capped", long !== null && long.length <= 141);
}

console.log("[6] parsing — outcomeOf round-trip");
{
  check(
    "outcomeOf extracts the segment",
    outcomeOf(`[09:00:01] file receipt → success${RECAP_OUTCOME_SEP}Done: expense create`) ===
      "Done: expense create",
  );
  check("no segment → null", outcomeOf("[09:00:01] file receipt → success") === null);
}

console.log("[7] /recap payload — outcome-first with legacy-only fallback (Task #992)");
{
  const withOutcomes = buildRecapPayload({ rollingSummary: outcomeSummary, openThreads: [] });
  check(
    "outcome-bearing summary → accomplishments, NO raw trace lines",
    withOutcomes.accomplishments.length === 2 && withOutcomes.recap.length === 0,
  );
  check(
    "accomplishment is the outcome phrase",
    withOutcomes.accomplishments[0] === "Done: expense create — Marriott",
  );
  const legacyOnly = buildRecapPayload({ rollingSummary: legacyEchoSummary, openThreads: [] });
  check(
    "legacy-only summary → falls back to raw trace lines",
    legacyOnly.accomplishments.length === 0 && legacyOnly.recap.length === 2,
  );
  const threads = ["You were in the middle of confirming expense create — it was never committed."];
  const withThreads = buildRecapPayload({ rollingSummary: outcomeSummary, openThreads: threads });
  check(
    "open threads pass through alongside accomplishments",
    withThreads.openThreads.length === 1 && withThreads.accomplishments.length === 2,
  );
  const empty = buildRecapPayload({ rollingSummary: "", openThreads: [] });
  check(
    "empty summary → all-empty payload (no invented content)",
    empty.accomplishments.length === 0 && empty.recap.length === 0 && empty.openThreads.length === 0,
  );
  const manyLegacy = Array.from(
    { length: 14 },
    (_, i) => `[0${i % 10}:00:00] legacy prompt number ${i} → success (1 tool)`,
  ).join("\n");
  check(
    "legacy fallback caps at last 10 lines",
    buildRecapPayload({ rollingSummary: manyLegacy, openThreads: [] }).recap.length === 10,
  );
}

console.log(`\nrecap-probe: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
