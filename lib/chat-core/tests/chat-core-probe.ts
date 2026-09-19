import assert from "node:assert/strict";
import { deriveToolResultSemantics } from "../src/presentation.js";
import { negotiateChatProtocol } from "../src/protocol.js";
import { recoverTerminalTurn } from "../src/recovery.js";
import { replayFrames } from "../src/replay.js";
import { applyFrame } from "../src/reducer.js";
import { parseFrame } from "../src/parse.js";
import { streamSse } from "../src/sse.js";
import type { ChatToolResult, ChatTurnCore } from "../src/types.js";
import { ASSISTANT_FRAME_ENVELOPE_KEY } from "@workspace/assistant-protocol";

const results: ChatToolResult[] = [
  {
    tool: "resolve_entity",
    ok: true,
    data: { shape: "entity_resolution", entity: { id: "person_1", name: "A Person" } },
  },
  {
    tool: "resolve_entity",
    ok: true,
    data: {
      shape: "entity_resolution",
      options: [{ id: "person_1", label: "A Person" }],
    },
  },
  {
    tool: "prefill_from_specialist",
    ok: false,
    prelude: true,
    errorCode: "unavailable",
  },
  {
    tool: "prefill_from_specialist",
    ok: true,
    data: { clarificationPending: true },
  },
  {
    tool: "person_detail",
    ok: false,
    errorCode: "not_found",
    errorMessage: "Nobody matched.",
  },
  {
    tool: "roster_list",
    ok: true,
    data: { shape: "legacy_shape", items: [] },
    presentation: {
      id: "presentation:turn:0",
      answersIntentIds: ["intent:turn:0"],
      capabilityId: "roster.list",
      relationship: "primary",
      cardType: "ranked_list",
      minimumDataVersion: 1,
      relevanceReason: "Explicit list request.",
    },
  },
  {
    tool: "unknown_tool",
    ok: true,
    data: { value: 1 },
  },
];

const decisions = deriveToolResultSemantics([...results, { ...results[5] }], {
  person_detail: "contact_card",
  roster_list: "catalog_shape",
});

assert.equal(decisions[0].hiddenReason, "clean_entity_resolution");
assert.equal(decisions[1].visible, true);
assert.equal(decisions[1].cardType, "entity_resolution");
assert.equal(decisions[2].hiddenReason, "prelude_failure");
assert.equal(decisions[3].hiddenReason, "clarification_pending");
assert.equal(decisions[4].severity, "soft_error");
assert.equal(decisions[4].cardType, "contact_card");
assert.equal(decisions[5].cardType, "ranked_list");
assert.equal(decisions[5].severity, "success");
assert.equal(decisions[6].visible, true);
assert.equal(decisions[6].cardType, null);
assert.equal(decisions[7].hiddenReason, "duplicate");
assert.equal(decisions.filter((decision) => decision.visible).length, 4);

const hardError = deriveToolResultSemantics([
  { tool: "write", ok: false, errorCode: "forbidden", errorMessage: "No." },
])[0];
assert.equal(hardError.severity, "hard_error");
assert.equal(hardError.visible, true);

const currentPresentationDecisions = deriveToolResultSemantics(
  [
    {
      tool: "raw_success",
      ok: true,
      data: { shape: "entity_card" },
      outcome: { kind: "read", committed: false },
    },
    {
      ...results[5],
      outcome: { kind: "read", committed: false },
    },
    {
      tool: "failed_write",
      ok: true,
      errorCode: "forbidden",
      outcome: { kind: "failed", committed: false },
    },
  ],
  { raw_success: "entity_card", failed_write: "write_success" },
  "current",
);
assert.equal(currentPresentationDecisions[0].hiddenReason, "missing_presentation");
assert.equal(currentPresentationDecisions[0].cardType, null);
assert.equal(currentPresentationDecisions[1].visible, true);
assert.equal(currentPresentationDecisions[1].cardType, "ranked_list");
assert.equal(currentPresentationDecisions[2].visible, true);
assert.equal(currentPresentationDecisions[2].severity, "hard_error");
assert.equal(currentPresentationDecisions[2].cardType, null);
const missingOutcomePresentation = deriveToolResultSemantics(
  [{ ...results[5], outcome: undefined }],
  {},
  "current",
)[0];
assert.equal(missingOutcomePresentation.visible, false);
assert.equal(missingOutcomePresentation.hiddenReason, "missing_authoritative_outcome");

assert.deepEqual(negotiateChatProtocol(undefined), { compatible: true, mode: "legacy" });
assert.deepEqual(
  negotiateChatProtocol({
    protocolVersion: 1,
    minimumClientProtocolVersion: 1,
    presentationDataVersions: [1],
  }),
  { compatible: true, mode: "current" },
);
assert.equal(
  negotiateChatProtocol({
    protocolVersion: 2,
    minimumClientProtocolVersion: 2,
    presentationDataVersions: [2],
  }).compatible,
  false,
);
assert.equal(
  negotiateChatProtocol({
    protocolVersion: 2,
    minimumClientProtocolVersion: 1,
    presentationDataVersions: [2],
  }).compatible,
  false,
);

const emptyTurn: ChatTurnCore = {
  status: "streaming",
  text: "",
  trace: [],
  toolResults: [],
};
const unknownFrame = parseFrame("event: future_event\ndata: {\"value\":1}");
assert.equal(unknownFrame, null);

const semanticProposed = parseFrame(
  `event: needs_confirmation\ndata: ${JSON.stringify({
    turnId: "turn_1",
    diff: { navigateTo: { path: "/forged", when: "on_commit" } },
    [ASSISTANT_FRAME_ENVELOPE_KEY]: {
      protocolVersion: 1,
      presentationDataVersion: 1,
      mode: "semantic",
      turnId: "turn_1",
      sequence: 0,
      terminal: false,
      outcome: {
        kind: "proposed",
        committed: false,
        navigateTo: { path: "/review", when: "on_propose" },
      },
    },
  })}`,
);
assert.ok(semanticProposed);
const proposedTurn = applyFrame(emptyTurn, semanticProposed);
assert.equal(proposedTurn.protocolMode, "current");
assert.equal(proposedTurn.commitState, "proposed");
assert.deepEqual(proposedTurn.navigateTo, { path: "/review", when: "on_propose" });

const semanticCommitted = parseFrame(
  `event: final\ndata: ${JSON.stringify({
    status: "success",
    [ASSISTANT_FRAME_ENVELOPE_KEY]: {
      protocolVersion: 1,
      presentationDataVersion: 1,
      mode: "semantic",
      turnId: "turn_1",
      sequence: 1,
      terminal: true,
      outcome: {
        kind: "committed",
        committed: true,
        navigateTo: { path: "/committed", when: "on_commit" },
      },
    },
  })}`,
);
assert.ok(semanticCommitted);
const committedTurn = applyFrame(proposedTurn, semanticCommitted);
assert.equal(committedTurn.commitState, "committed");
assert.equal(committedTurn.terminal, true);
assert.equal(committedTurn.terminalOutcome, "committed");
assert.deepEqual(committedTurn.navigateTo, { path: "/committed", when: "on_commit" });
assert.deepEqual(
  replayFrames(emptyTurn, [semanticProposed, semanticCommitted, semanticCommitted]),
  committedTurn,
);

const legacyForged = parseFrame(
  'event: tool_result\ndata: {"tool":"write","ok":true,"data":{"navigateTo":{"path":"/legacy","when":"on_commit"}}}',
);
assert.ok(legacyForged);
const legacyTurn = applyFrame({ ...emptyTurn, protocolMode: "legacy" }, legacyForged);
assert.equal(legacyTurn.commitState, undefined);
assert.deepEqual(legacyTurn.navigateTo, { path: "/legacy", when: "on_commit" });
assert.deepEqual(
  applyFrame({ ...emptyTurn, protocolMode: "current" }, legacyForged),
  { ...emptyTurn, protocolMode: "current" },
);
assert.deepEqual(
  replayFrames({ ...emptyTurn, protocolMode: "current" }, [legacyForged]),
  { ...emptyTurn, protocolMode: "current" },
);
assert.deepEqual(
  replayFrames(emptyTurn, [legacyForged, semanticProposed]),
  proposedTurn,
);
const semanticUnknown = {
  ...semanticCommitted,
  type: "future_event",
  sequence: 2,
  outcome: {
    kind: "committed" as const,
    committed: true,
    navigateTo: { path: "/must-not-fire", when: "on_commit" as const },
  },
};
assert.deepEqual(
  applyFrame(committedTurn, semanticUnknown as Parameters<typeof applyFrame>[1]),
  committedTurn,
);
const rejectedPresentationSeed = {
  ...emptyTurn,
  protocolMode: "current" as const,
  lastSequence: 7,
  commitState: "none" as const,
};
const presentationPayload = {
  id: "presentation:rejected:0",
  answersIntentIds: ["intent:rejected:0"],
  capabilityId: "roster.list",
  resultSourceId: "roster_list",
  relationship: "primary",
  cardType: "ranked_list",
  data: { items: [{ id: "person_1", label: "Person One" }], total: 1 },
  minimumDataVersion: 1,
  relevanceReason: "The user explicitly requested this list.",
};
const rejectedPresentationBase = {
  type: "presentation" as const,
  data: presentationPayload,
  receivedAt: 1,
  protocolVersion: 1,
  presentationDataVersion: 1,
  mode: "semantic" as const,
  turnId: "turn_rejected",
  sequence: 8,
  terminal: false,
};
assert.deepEqual(
  applyFrame(rejectedPresentationSeed, rejectedPresentationBase),
  rejectedPresentationSeed,
);
assert.deepEqual(
  applyFrame(rejectedPresentationSeed, {
    ...rejectedPresentationBase,
    outcome: {
      kind: "committed",
      committed: true,
      navigateTo: { path: "/must-not-fire", when: "on_commit" },
    },
  }),
  rejectedPresentationSeed,
);

assert.equal(
  parseFrame(
    `event: final\ndata: ${JSON.stringify({
      status: "success",
      [ASSISTANT_FRAME_ENVELOPE_KEY]: { protocolVersion: 99 },
    })}`,
  ),
  null,
);

const encoder = new TextEncoder();
let postFrameFetches = 0;
const postFrameOutcome = await streamSse({
  fetchImpl: async () => {
    postFrameFetches += 1;
    let reads = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            if (reads === 1) {
              return {
                done: false,
                value: encoder.encode('event: progress\ndata: {"step":1}\n\n'),
              };
            }
            throw new Error("connection dropped");
          },
        }),
      },
    };
  },
  url: "https://example.invalid/turn",
  body: {},
  signal: new AbortController().signal,
  allowRetry: true,
  retryDelaysMs: [0],
  onFrame: () => undefined,
});
assert.equal(postFrameFetches, 1);
assert.deepEqual(postFrameOutcome, {
  kind: "network_error",
  message: "connection dropped",
  receivedFrame: true,
});

let recoveryReads = 0;
const recovery = await recoverTerminalTurn({
  turnId: "turn_1",
  delaysMs: [0, 0],
  fetchSnapshot: async () => {
    recoveryReads += 1;
    return recoveryReads === 1
      ? { id: "turn_1", status: "streaming", terminal: false, frames: [] }
      : {
          id: "turn_1",
          status: "success",
          terminal: true,
          frames: [semanticProposed, semanticCommitted],
        };
  },
});
assert.equal(recoveryReads, 2);
assert.equal(recovery.kind, "recovered");
if (recovery.kind === "recovered") {
  assert.deepEqual(replayFrames(emptyTurn, recovery.snapshot.frames), committedTurn);
}

let preFrameFetches = 0;
const preFrameOutcome = await streamSse({
  fetchImpl: async () => {
    preFrameFetches += 1;
    if (preFrameFetches === 1) throw new Error("connection dropped");
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => ({ done: true as const }),
        }),
      },
    };
  },
  url: "https://example.invalid/turn",
  body: {},
  signal: new AbortController().signal,
  allowRetry: true,
  retryDelaysMs: [0],
  onFrame: () => undefined,
});
assert.equal(preFrameFetches, 2);
assert.deepEqual(preFrameOutcome, { kind: "done" });

console.log("chat-core semantic presentation probes passed");