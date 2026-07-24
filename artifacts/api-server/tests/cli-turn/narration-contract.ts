/**
 * Task #645 — unit tests for the deterministic narration/card output
 * contract backstops. Pure functions only (no DB, no server, no LLM).
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/cli-turn/narration-contract.ts
 */
import assert from "node:assert/strict";
import {
  cardPayloadTokens,
  narrationRestatesCard,
  firstSentence,
  trimNarrationForCard,
  toolResultFrameKey,
} from "../../src/lib/atelier-cli/narration-contract.js";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const card = {
  shape: "meeting_card",
  id: "mtg_abc123",
  title: "Falcon steering committee",
  startsAt: "2026-07-25T07:00:00+04:00",
  location: "Boardroom 2",
  attendees: ["Mounir Ariss", "Gökhan Polat"],
};

test("cardPayloadTokens collects distinctive strings + numbers", () => {
  const toks = cardPayloadTokens({ a: "Falcon steering committee", b: 42, c: "ok" });
  assert.ok(toks.has("falcon steering committee"));
  assert.ok(toks.has("42"));
  assert.ok(!toks.has("ok"), "short strings are not distinctive");
});

test("narration restating several card fields is detected", () => {
  const text =
    "I've rescheduled the Falcon steering committee to 2026-07-25T07:00:00+04:00 in Boardroom 2 with Mounir Ariss attending.";
  assert.equal(narrationRestatesCard(text, card), true);
});

test("a short framing sentence is NOT flagged as restating", () => {
  const text = "Here are the meeting details.";
  assert.equal(narrationRestatesCard(text, card), false);
});

test("empty/absent payload never flags", () => {
  assert.equal(narrationRestatesCard("anything at all", null), false);
  assert.equal(narrationRestatesCard("anything at all", {}), false);
});

test("trimNarrationForCard clamps restating prose to one sentence", () => {
  const text =
    "Done. The Falcon steering committee now starts at 2026-07-25T07:00:00+04:00 in Boardroom 2, and Mounir Ariss plus Gökhan Polat are attending.";
  const trimmed = trimNarrationForCard(text, card);
  assert.equal(trimmed, "Done.");
});

test("trimNarrationForCard leaves non-restating prose untouched", () => {
  const text = "All set — let me know if you'd like anything adjusted.";
  assert.equal(trimNarrationForCard(text, card), text);
});

test("firstSentence handles no terminal punctuation", () => {
  assert.equal(firstSentence("just a fragment\nsecond line"), "just a fragment");
});

test("toolResultFrameKey is identical for identical frames, distinct otherwise", () => {
  const a = { step: 2, tool: "meeting_reschedule", ok: true, data: { id: "mtg_1" } };
  const b = { step: 2, tool: "meeting_reschedule", ok: true, data: { id: "mtg_1" } };
  const c = { step: 2, tool: "meeting_reschedule", ok: true, data: { id: "mtg_2" } };
  assert.equal(toolResultFrameKey(a), toolResultFrameKey(b));
  assert.notEqual(toolResultFrameKey(a), toolResultFrameKey(c));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
