/**
 * Task #739 — offline probe for the verbatim replay window composer.
 * Pure over turn rows: no DB, no LLM, no network.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/chat/replay-probe.ts
 */
import assert from "node:assert/strict";
import {
  composeAssistantReplay,
  composeReplayFromTurns,
  digestToolResultData,
  DEFAULT_REPLAY_BUDGET,
  type ReplayBudget,
  type ReplayTurnRow,
} from "../../src/lib/atelier-cli/replay.js";

let passed = 0;
const ok = (label: string) => {
  passed += 1;
  console.log(`✓ ${label}`);
};

const B: ReplayBudget = { ...DEFAULT_REPLAY_BUDGET };

// Helper to build a turn row (rows are newest-first, like ORDER BY DESC).
const turn = (prompt: string, frames: unknown[] = [], status = "success"): ReplayTurnRow => ({
  prompt,
  status,
  frames,
});

// 1. Facts from 2-3 turns earlier appear verbatim in the composed history.
{
  const rows = [
    turn("search for hotel"),
    turn("I'm staying there 5 nights", [
      { type: "text", data: { text: "Got it — 5 nights, check-in 2026-07-30, check-out 2026-08-04." } },
    ]),
    turn("find me hotels in istanbul", [
      { type: "needs_clarification", data: { question: "What are your check-in and check-out dates?" } },
    ]),
  ];
  const { history, telemetry } = composeReplayFromTurns(rows, B);
  const flat = history.map((m) => `${m.role}: ${m.content}`).join("\n");
  assert.ok(flat.includes("find me hotels in istanbul"), "oldest user prompt present");
  assert.ok(flat.includes("I'm staying there 5 nights"), "user-stated duration present verbatim");
  assert.ok(flat.includes("2026-08-04"), "assistant-computed dates preserved");
  assert.ok(flat.includes("(asked) What are your check-in and check-out dates?"));
  // Chronological order: istanbul question turn must come BEFORE the 5-nights turn.
  assert.ok(flat.indexOf("istanbul") < flat.indexOf("5 nights"), "chronological order");
  // Alternating roles, user first.
  assert.equal(history[0].role, "user");
  for (let i = 0; i < history.length; i++) assert.equal(history[i].role, i % 2 === 0 ? "user" : "assistant");
  assert.equal(telemetry.turnsIncluded, 3);
  assert.equal(telemetry.truncated, false);
  ok("facts from 2-3 turns earlier replay verbatim, chronological, alternating");
}

// 2. Tool-result digest: compact, preserves dates/names/totals/ids, caps size.
{
  const digest = digestToolResultData(
    {
      total: 12,
      itinerary: { totalDisplay: "AED 3,498", legCount: 2 },
      items: [
        { label: "Pegasus PC 123 — DXB→IST 2027-03-02", href: "https://x" },
        { label: "Turkish TK 1 — IST→DXB" },
      ],
    },
    B.toolDigestChars,
  );
  assert.ok(digest.includes("total=12"));
  assert.ok(digest.includes("AED 3,498"));
  assert.ok(digest.includes("2 items"));
  assert.ok(digest.includes("Pegasus PC 123"));
  assert.ok(digest.length <= B.toolDigestChars);
  // Huge payloads stay capped.
  const huge = digestToolResultData(
    { rows: Array.from({ length: 500 }, (_, i) => ({ name: `row ${i}`, blob: "x".repeat(500) })) },
    B.toolDigestChars,
  );
  assert.ok(huge.length <= B.toolDigestChars, "huge payload capped");
  assert.ok(huge.includes("500 items"), "array summarized, not dumped");
  ok("tool digests compact + capped, preserve referable fields");
}

// 3. Assistant composition: prose + tool digests + special frames; prelude skipped.
{
  const { text } = composeAssistantReplay(
    [
      { type: "tool_result", data: { prelude: true, tool: "resolve_entity", ok: true, data: { entity: { id: "x" } } } },
      { type: "tool_result", data: { tool: "travel_search_stays", ok: true, data: { total: 8, city: "Istanbul" } } },
      { type: "tool_result", data: { tool: "broken_tool", ok: false, errorMessage: "provider down" } },
      { type: "narration", data: { text: "Here are 8 hotels in Istanbul." } },
      { type: "refusal", data: { message: "cannot share salaries" } },
    ],
    B,
  );
  assert.ok(!text.includes("resolve_entity"), "prelude echo skipped");
  assert.ok(text.includes("[travel_search_stays → ok]") && text.includes("city=Istanbul"));
  assert.ok(text.includes("[broken_tool → error] provider down"), "failures replay honestly");
  assert.ok(text.includes("Here are 8 hotels"));
  assert.ok(text.includes("(declined) cannot share salaries"));
  ok("assistant replay composes prose, digests, honest errors; skips prelude");
}

// 4. Budget: oldest turns fall off first; truncation flagged; total respected.
{
  const tight: ReplayBudget = { ...B, totalChars: 110, promptChars: 100, assistantChars: 100 };
  const rows = [
    turn("newest message about budget caps"),
    turn("middle message"),
    turn("oldest message that should fall off"),
  ];
  const { history, telemetry } = composeReplayFromTurns(rows, tight);
  const flat = history.map((m) => m.content).join("\n");
  assert.ok(flat.includes("newest message"), "newest kept");
  assert.ok(!flat.includes("oldest message"), "oldest dropped first");
  assert.equal(telemetry.truncated, true);
  assert.ok(telemetry.chars <= tight.totalChars);
  // maxTurns cap also flags truncation.
  const many = Array.from({ length: B.maxTurns + 3 }, (_, i) => turn(`turn ${i}`));
  const r2 = composeReplayFromTurns(many, B);
  assert.equal(r2.telemetry.turnsIncluded, B.maxTurns);
  assert.equal(r2.telemetry.truncated, true);
  ok("budget drops oldest first, flags truncation, respects totals");
}

// 5. Per-turn section caps: one pathological turn can't evict the window.
{
  const rows = [
    turn("short question"),
    turn("x".repeat(50_000), [{ type: "text", data: { text: "y".repeat(50_000) } }]),
    turn("earlier context that must survive"),
  ];
  const { history, telemetry } = composeReplayFromTurns(rows, B);
  const flat = history.map((m) => m.content).join("\n");
  assert.ok(flat.includes("short question"));
  assert.ok(flat.includes("earlier context that must survive"), "pathological turn didn't evict others");
  assert.equal(telemetry.turnsIncluded, 3);
  assert.equal(telemetry.truncated, true);
  for (const m of history) assert.ok(String(m.content).length <= B.assistantChars + 1);
  ok("per-turn caps contain pathological turns");
}

// 6. Streaming (unfinished/concurrent) turns and junk rows are skipped safely.
{
  const rows: ReplayTurnRow[] = [
    turn("real turn"),
    turn("half-done turn", [], "streaming"),
    { prompt: 123 as unknown as string, status: "success", frames: "junk" as unknown as unknown[] },
    turn("", [{ type: "text", data: { text: "reply to empty" } }]),
  ];
  const { history, telemetry } = composeReplayFromTurns(rows, B);
  const flat = history.map((m) => m.content).join("\n");
  assert.ok(flat.includes("real turn"));
  assert.ok(!flat.includes("half-done"));
  assert.ok(flat.includes("(empty message)"), "empty prompt placeholder");
  assert.equal(telemetry.turnsIncluded, 2);
  ok("streaming + malformed rows skipped without crashing");
}

// 7. Tool-digest count cap per turn.
{
  const frames = Array.from({ length: 10 }, (_, i) => ({
    type: "tool_result",
    data: { tool: `tool_${i}`, ok: true, data: { n: i } },
  }));
  const { text, truncated } = composeAssistantReplay(frames, B);
  const count = (text.match(/\[tool_/g) ?? []).length;
  assert.equal(count, B.maxToolDigests);
  assert.equal(truncated, true);
  ok("per-turn tool digest count capped");
}

// 8. Empty input → empty history, zero telemetry, no crash.
{
  const { history, telemetry } = composeReplayFromTurns([], B);
  assert.equal(history.length, 0);
  assert.equal(telemetry.turnsIncluded, 0);
  assert.equal(telemetry.truncated, false);
  ok("empty session → empty replay");
}

// 9. Tool-name dedup — Riser Stage 2: same tool called multiple times in one
//    turn should produce only ONE digest entry; later success beats earlier
//    error for the same tool key.
{
  const frames = [
    { type: "tool_result", data: { tool: "account_detail", ok: false, errorMessage: "temporary failure" } },
    { type: "tool_result", data: { tool: "account_detail", ok: true, data: { name: "Acme Corp", id: "acc_1" } } },
    { type: "tool_result", data: { tool: "account_detail", ok: true, data: { name: "Acme Corp v2", id: "acc_1" } } },
  ];
  const { text } = composeAssistantReplay(frames, B);
  const occurrences = (text.match(/\[account_detail/g) ?? []).length;
  assert.equal(occurrences, 1, `expected 1 [account_detail digest, got ${occurrences}`);
  // Last success wins: v2 version appears, earlier entries do not.
  assert.ok(text.includes("name=Acme Corp v2"), "last successful result wins in dedup");
  assert.ok(!text.includes("temporary failure"), "earlier error suppressed by later success");
  ok("tool-name dedup: same tool repeated → last-success-wins, single digest entry");
}

// 10. Tool-name dedup — lone error kept; error-then-success collapses to success.
{
  const frames = [
    { type: "tool_result", data: { tool: "tool_a", ok: false, errorMessage: "first error" } },
    { type: "tool_result", data: { tool: "tool_b", ok: false, errorMessage: "only error for b" } },
    { type: "tool_result", data: { tool: "tool_a", ok: true, data: { resolved: true } } },
  ];
  const { text } = composeAssistantReplay(frames, B);
  // tool_a: error+success → success wins, error suppressed.
  assert.ok(text.includes("[tool_a → ok]"), "error-then-success: success kept");
  assert.ok(!text.includes("[tool_a → error]"), "error for tool_a not kept when success follows");
  // tool_b: lone error → kept honestly.
  assert.ok(text.includes("[tool_b → error]"), "lone error kept with no follow-up success");
  // Each tool appears exactly once.
  assert.equal((text.match(/\[tool_a/g) ?? []).length, 1, "tool_a appears once");
  assert.equal((text.match(/\[tool_b/g) ?? []).length, 1, "tool_b appears once");
  ok("tool-name dedup: lone error kept; error+success collapses to success");
}

console.log(`\nreplay-probe: ${passed}/10 groups passed`);
