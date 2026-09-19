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
import * as webSemanticAdapter from "../../../atelier/src/components/cli/semanticAdapter.ts";
import * as mobileSemanticAdapter from "../../../atelier-mobile/lib/semanticAdapter.ts";

let passed = 0;
const webSemanticSnapshot = webSemanticAdapter.webSemanticSnapshot;
const mobileSemanticSnapshot =
  mobileSemanticAdapter.mobileSemanticSnapshot ??
  (
    mobileSemanticAdapter.default as
      | { mobileSemanticSnapshot?: typeof webSemanticSnapshot }
      | undefined
  )?.mobileSemanticSnapshot;
assert.equal(
  typeof mobileSemanticSnapshot,
  "function",
  "mobile semantic adapter must export its snapshot boundary",
);
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

// Explicit presentations are validated, dual-emitted legacy results dedupe,
// and malformed/unknown presentations never create a card.
{
  const presentation = {
    id: "presentation:turn:0",
    answersIntentIds: ["intent:turn:0"],
    capabilityId: "roster.list",
    resultSourceId: "roster_list",
    relationship: "primary",
    cardType: "ranked_list",
    data: { items: [], total: 0 },
    minimumDataVersion: 1,
    relevanceReason: "The user explicitly requested this list.",
  };
  const t = run([
    frame("presentation", presentation),
    frame("tool_result", {
      tool: "roster_list",
      ok: true,
      data: presentation.data,
    }),
    frame("presentation", { ...presentation, id: "", cardType: "unknown_card" }),
    frame("presentation", {
      ...presentation,
      id: "presentation:malformed",
      data: { items: [{}] },
    }),
    frame("presentation", {
      ...presentation,
      id: "presentation:extra",
      unexpected: true,
    }),
    frame("presentation", {
      ...presentation,
      id: "presentation:forged-pair",
      capabilityId: "roster.person_detail",
    }),
    frame("presentation", {
      ...presentation,
      id: "presentation:nested-empty",
      data: { items: [{ meta: {} }] },
    }),
    frame("presentation", {
      ...presentation,
      id: "presentation:future-data-version",
      minimumDataVersion: 2,
    }),
  ]);
  assert.equal(t.toolResults.length, 1);
  assert.equal(t.toolResults[0].presentation?.cardType, "ranked_list");
  ok("validated presentation dual-emission dedupes and unknown cards are omitted");
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

// C14 cross-client golden corpus. These are intentionally separate web and
// mobile adapter imports: mode propagation and render-dispatch decisions must
// stay equivalent across live, confirm, history, and recovery paths.
{
  const semantic = (
    type: ChatFrame["type"],
    data: Record<string, unknown>,
    sequence: number,
    outcome?: ChatFrame["outcome"],
  ): ChatFrame => ({
    type,
    data,
    receivedAt: sequence,
    protocolVersion: 1,
    presentationDataVersion: 1,
    mode: "semantic",
    turnId: "turn_golden",
    sequence,
    terminal: type === "final" || type === "error",
    ...(outcome ? { outcome } : {}),
  });
  const presentation = {
    id: "presentation:golden:0",
    answersIntentIds: ["intent:golden:0"],
    capabilityId: "roster.list",
    resultSourceId: "roster_list",
    relationship: "primary",
    cardType: "ranked_list",
    data: { items: [{ id: "person_1", label: "Person One" }], total: 1 },
    minimumDataVersion: 1,
    relevanceReason: "The user explicitly requested this list.",
  };
  const legacyResult = frame("tool_result", {
    tool: "roster_list",
    ok: true,
    data: { shape: "ranked_list", items: [{ id: "person_1" }] },
  });
  const currentPresentation = semantic(
    "presentation",
    presentation,
    0,
    { kind: "read", committed: false },
  );
  const currentFinal = semantic(
    "final",
    { status: "success", result: { title: "Done", summary: "Done." } },
    1,
    { kind: "read", committed: false },
  );
  const proposed = semantic(
    "needs_confirmation",
    { turnId: "turn_golden", diff: {} },
    0,
    {
      kind: "proposed",
      committed: false,
      navigateTo: { path: "/review", when: "on_propose" },
    },
  );
  const committed = semantic(
    "final",
    { status: "success", result: { title: "Saved", summary: "Saved." } },
    1,
    {
      kind: "committed",
      committed: true,
      navigateTo: { path: "/saved", when: "on_commit" },
    },
  );
  const corpus: Array<{ name: string; frames: ChatFrame[] }> = [
    { name: "legacy-live", frames: [legacyResult, frame("final", { status: "success" })] },
    { name: "current-live", frames: [currentPresentation, currentFinal] },
    { name: "confirm", frames: [proposed, committed] },
    {
      name: "mixed-history-preflight",
      frames: [legacyResult, currentPresentation, currentFinal],
    },
    {
      name: "recovery-dedupes-sequence",
      frames: [proposed, committed, committed],
    },
    {
      name: "presentation-missing-outcome",
      frames: [semantic("presentation", presentation, 0), currentFinal],
    },
    {
      name: "presentation-committed-outcome",
      frames: [
        semantic("presentation", presentation, 0, {
          kind: "committed",
          committed: true,
          navigateTo: { path: "/must-not-fire", when: "on_commit" },
        }),
        currentFinal,
      ],
    },
  ];
  for (const fixture of corpus) {
    const web = webSemanticSnapshot(freshTurn(), fixture.frames, {
      roster_list: "ranked_list",
    });
    const mobile = mobileSemanticSnapshot(freshTurn(), fixture.frames, {
      roster_list: "ranked_list",
    });
    assert.deepEqual(mobile, web, `${fixture.name}: web/mobile snapshots diverged`);
    if (fixture.name === "mixed-history-preflight") {
      assert.equal(web.protocolMode, "current");
      assert.equal(web.cards.length, 1, "leading legacy frame must be rejected");
    }
    if (
      fixture.name === "presentation-missing-outcome" ||
      fixture.name === "presentation-committed-outcome"
    ) {
      assert.equal(web.cards.length, 0, "missing outcome must not create a current card");
      assert.equal(web.commitState, "none", "rejected presentation must not change authority");
      assert.equal(web.navigateTo, null, "rejected presentation must not navigate");
    }
  }
  ok("web/mobile golden adapters agree across live, confirm, history, and recovery");
}

console.log(`\n[reducer-parity-probe] ${passed} checks passed`);
