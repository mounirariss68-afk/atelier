import assert from "node:assert/strict";
import { mergeAssistantReplayEvents } from "../../src/lib/assistant/legacy-event-reader.js";

const conversationId = "conversation-c19";
const events = mergeAssistantReplayEvents({
  conversationId,
  after: null,
  durable: [{
    id: "event-durable",
    protocolVersion: 1,
    conversationId,
    turnId: "turn-a",
    sequence: 0,
    conversationSequence: 7,
    occurredAt: new Date("2026-01-01T00:00:01.000Z"),
    correlationId: "turn-a",
    type: "turn.started",
    data: { durable: true },
  }],
  legacy: [
    {
      id: "turn-b",
      status: "success",
      prompt: "older",
      frames: [{ type: "text", data: { text: "older reply" } }],
      pendingWrite: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "turn-a",
      status: "success",
      prompt: "mixed",
      frames: [
        { type: "text", data: { text: "duplicate legacy frame" } },
        { type: "final", data: { status: "success" } },
      ],
      pendingWrite: null,
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    },
    {
      id: "turn-c",
      status: "success",
      prompt: "unknown",
      frames: [{ type: "future_secret_frame", data: { secret: "must-not-leak" } }],
      pendingWrite: null,
      createdAt: new Date("2026-01-01T00:00:02.000Z"),
    },
  ],
});

assert.equal(events.length, 5);
assert.equal(events.filter((event) => event.turnId === "turn-a" && event.sequence === 0).length, 2);
assert.equal(events.find((event) => event.eventId === "event-durable")?.type, "turn.started");
assert.equal(events.find((event) => event.turnId === "turn-c")?.type, "compatibility.quarantined");
assert.ok(!JSON.stringify(events).includes("must-not-leak"));

const after = mergeAssistantReplayEvents({
  conversationId,
  after: "2026-01-01T00:00:00.001Z|legacy|turn-after|000001",
  durable: [],
  legacy: [{
    id: "turn-after",
    status: "success",
    prompt: "after",
    frames: [
      { type: "text", data: { text: "a" } },
      { type: "text", data: { text: "b" } },
      { type: "final", data: { status: "success" } },
    ],
    pendingWrite: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }],
});
assert.equal(after.length, 1);
assert.ok(after[0].cursor.endsWith("|legacy|turn-after|000002"));

console.log("legacy event reader probe passed");