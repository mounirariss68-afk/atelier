/**
 * Task #742 — client parity fixtures for the shared chat reducer.
 *
 * Web and mobile chat are thin shims over @workspace/chat-core; both
 * clients call the SAME pure `applyFrame` reducer, so parity is by
 * construction — provided the reducer honors the protocol contracts the
 * server relies on. This probe feeds recorded protocol fixtures (the
 * frame sequences the conversation harness exercises server-side)
 * through `applyFrame` and pins the client-visible state transitions:
 *
 *   1. serverTurnId is captured from ANY frame carrying one (so a
 *      clarification answer can carry continuesTurnId even after an
 *      in-turn error).
 *   2. needs_clarification preserves the typed multi-field payload
 *      (field/label/inputType/options) AND the partial, so answers can
 *      be rendered as typed inputs and merged.
 *   3. The "already answered" narration surfaces as text (mobile) and a
 *      trace entry (web) — never swallowed.
 *   4. A clarification turn later resumed: resetForRestream clears the
 *      pending question without losing the turn.
 *   5. Error envelopes are {code,message}; a final frame backfills
 *      empty text.
 *   6. Duplicate tool_result frames don't duplicate result state.
 *
 * Pure/offline. Run: pnpm --filter @workspace/api-server run test:chat-parity
 */
import assert from "node:assert/strict";
import {
  applyFrame,
  resetForRestream,
} from "../../../../lib/chat-core/src/reducer.js";
import type { ChatFrame, ChatTurnCore } from "../../../../lib/chat-core/src/types.js";

let passed = 0;
const ok = (label: string) => {
  passed += 1;
  console.log(`✓ ${label}`);
};

const freshTurn = (): ChatTurnCore => ({
  status: "streaming",
  text: "",
  trace: [],
  toolResults: [],
});

const frame = (type: string, data: Record<string, unknown>): ChatFrame =>
  ({ type, data, receivedAt: 1 }) as unknown as ChatFrame;

const run = (frames: ChatFrame[], start = freshTurn()) =>
  frames.reduce((t, f) => applyFrame(t, f), start);

// 1. serverTurnId captured from ANY frame — including needs_clarification
//    and an in-flight error — identically for web and mobile.
{
  const t = run([
    frame("progress", { turnId: "clit_1" }),
    frame("needs_clarification", {
      turnId: "clit_1",
      tool: "travel_search_stays",
      field: "checkIn",
      question: "What are your check-in and check-out dates?",
      partial: { location: "Istanbul" },
      fields: [
        { field: "checkIn", label: "Check-in date", inputType: "date" },
        { field: "checkOut", label: "Check-out date", inputType: "date" },
      ],
    }),
  ]);
  assert.equal(t.serverTurnId, "clit_1");
  assert.equal(t.status, "needs_clarification");
  ok("serverTurnId captured from needs_clarification frame");

  const errored = run([
    frame("needs_clarification", { turnId: "clit_2", tool: "x", field: "f", question: "q?" }),
    frame("error", { turnId: "clit_2", code: "internal", message: "boom" }),
  ]);
  assert.equal(errored.serverTurnId, "clit_2");
  assert.deepEqual(errored.error, { code: "internal", message: "boom" });
  ok("serverTurnId survives an in-turn error (answer stays continuable)");
}

// 2. Typed multi-field clarification payload preserved verbatim.
{
  const fields = [
    { field: "checkIn", label: "Check-in date", inputType: "date" },
    {
      field: "cabin",
      label: "Cabin",
      inputType: "select",
      options: [
        { value: "economy", label: "Economy" },
        { value: "business", label: "Business" },
      ],
    },
  ];
  const t = run([
    frame("needs_clarification", {
      turnId: "clit_3",
      tool: "travel_search_stays",
      field: "checkIn",
      question: "Dates?",
      partial: { location: "Istanbul" },
      fields,
    }),
  ]);
  assert.deepEqual(t.clarification?.fields, fields);
  assert.deepEqual(t.clarification?.partial, { location: "Istanbul" });
  assert.equal(t.clarification?.tool, "travel_search_stays");
  ok("multi-field clarification payload (inputType/options/partial) preserved");
}

// 3. "Already answered" narration is never swallowed.
{
  const t = run([
    frame("narration", {
      text: "That question was already answered — I'm continuing from the latest state.",
      step: 0,
    }),
    frame("final", { turnId: "clit_4", status: "success" }),
  ]);
  assert.ok(t.text.includes("already answered"), "mobile text body");
  assert.ok(
    t.trace.some((e) => e.kind === "narration" && String((e as any).text).includes("already answered")),
    "web trace entry",
  );
  ok("'already answered' narration reaches both clients");
}

// 4. Restream reset clears the pending question without losing the turn.
{
  const asked = run([
    frame("needs_clarification", { turnId: "clit_5", tool: "t", field: "f", question: "q?" }),
  ]);
  const reset = resetForRestream(asked);
  assert.equal(reset.serverTurnId, "clit_5", "turn identity kept");
  assert.equal(reset.clarification, undefined);
  assert.equal(reset.status, "streaming");
  ok("resetForRestream clears the question but keeps turn identity");
}

// 5. Final frame backfills empty text; error envelope is {code,message}.
{
  const t = run([
    frame("tool_result", { tool: "travel_search_stays", ok: true, step: 1, data: { count: 1 } }),
    frame("final", {
      turnId: "clit_6",
      status: "success",
      result: { title: "Hotels in Istanbul", summary: "Found 1 hotel." },
    }),
  ]);
  assert.equal(t.status, "complete");
  assert.ok(t.text.length > 0, "final backfills empty narration text");
  ok("final frame backfills empty text");
}

// 6. Identical duplicate tool_result frames (server dedupes, but a
//    reconnect replay can still deliver twice) don't double results.
{
  const tr = frame("tool_result", { tool: "travel_search_stays", ok: true, step: 1, data: { n: 1 } });
  const t = run([tr, tr]);
  assert.equal(
    t.toolResults.filter((r) => r.tool === "travel_search_stays").length,
    1,
    `expected 1 tool result, got ${t.toolResults.length}`,
  );
  ok("duplicate tool_result frames don't duplicate client state");
}

console.log(`\n[reducer-parity-probe] ${passed} checks passed`);
