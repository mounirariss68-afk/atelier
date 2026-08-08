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
  looksLikeWritePromise,
  stripUnfulfilledWritePromises,
  stripDeadEndDocumentAdvice,
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

// ---------------------------------------------------------------------
// Task #798 — write-promise guard edge cases (Task #792 helpers).
// ---------------------------------------------------------------------

test("looksLikeWritePromise: straight and curly apostrophes", () => {
  assert.equal(looksLikeWritePromise("I'll save the back side now."), true);
  assert.equal(looksLikeWritePromise("I’ll attach it to your ID."), true);
  assert.equal(looksLikeWritePromise("Ill save it"), true, "bare 'Ill' contraction");
});

test("looksLikeWritePromise: longer commitment forms", () => {
  assert.equal(looksLikeWritePromise("I am going to update your profile."), true);
  assert.equal(looksLikeWritePromise("I'm going to record that expense."), true);
  assert.equal(looksLikeWritePromise("Let me now attach the file."), true);
  assert.equal(looksLikeWritePromise("I will now submit the claim."), true);
});

test("looksLikeWritePromise: plain statements are NOT promises", () => {
  assert.equal(looksLikeWritePromise("Your passport is already saved."), false);
  assert.equal(looksLikeWritePromise("The upload completed earlier today."), false);
  assert.equal(looksLikeWritePromise(""), false);
  assert.equal(looksLikeWritePromise(null), false);
  assert.equal(looksLikeWritePromise(undefined), false);
});

test("stripUnfulfilledWritePromises: multi-sentence keeps the factual rest", () => {
  const text =
    "Your Emirates ID has a front side on file. I'll attach the back side now. Let me know if you need anything else.";
  assert.equal(
    stripUnfulfilledWritePromises(text),
    "Your Emirates ID has a front side on file. Let me know if you need anything else.",
  );
});

test("stripUnfulfilledWritePromises: all-promise prose collapses to empty", () => {
  assert.equal(stripUnfulfilledWritePromises("I'll save it as the back side now."), "");
  assert.equal(
    stripUnfulfilledWritePromises("I’ll upload the scan.\nI'm going to file it under your documents."),
    "",
  );
});

test("stripUnfulfilledWritePromises: newline-delimited sentences handled", () => {
  const text = "Here is what I found.\nI'll log the expense now.";
  assert.equal(stripUnfulfilledWritePromises(text), "Here is what I found.");
});

test("stripUnfulfilledWritePromises: non-promise prose passes through untouched", () => {
  const text = "The document was saved yesterday. Nothing else is pending.";
  assert.equal(stripUnfulfilledWritePromises(text), text);
});

test("French prose passes through both scrubbers unchanged", () => {
  const fr =
    "Je vais enregistrer le verso de votre pièce d'identité maintenant. Dites-moi si vous avez besoin d'autre chose.";
  assert.equal(looksLikeWritePromise(fr), false);
  assert.equal(stripUnfulfilledWritePromises(fr), fr);
  assert.equal(stripDeadEndDocumentAdvice(fr), fr);
});

test("Arabic prose passes through both scrubbers unchanged", () => {
  const ar = "سأحفظ الجانب الخلفي من بطاقتك الآن. أخبرني إذا احتجت أي شيء آخر.";
  assert.equal(looksLikeWritePromise(ar), false);
  assert.equal(stripUnfulfilledWritePromises(ar), ar);
  assert.equal(stripDeadEndDocumentAdvice(ar), ar);
});

test("stripDeadEndDocumentAdvice: removes interface-unavailable claims, keeps the rest", () => {
  const text =
    "Your ID is on file. Unfortunately that isn't available in this interface. Anything else?";
  assert.equal(stripDeadEndDocumentAdvice(text), "Your ID is on file. Anything else?");
});

test("stripDeadEndDocumentAdvice: removes profile-page upload deflection", () => {
  const text = "Please upload the back side from the profile page instead.";
  assert.equal(stripDeadEndDocumentAdvice(text), "");
  const text2 = "Go to your profile page to upload the document.";
  assert.equal(stripDeadEndDocumentAdvice(text2), "");
});

test("stripDeadEndDocumentAdvice: benign profile mentions survive", () => {
  const text = "Your profile page shows your saved documents.";
  assert.equal(stripDeadEndDocumentAdvice(text), text);
});

test("combined guard order: dead-end scrub then promise scrub empties the 792 reply", () => {
  const text =
    "I'll save the back side of your ID now. Unfortunately, that isn't available in this interface — please upload it from the profile page instead.";
  const afterDeadEnd = stripDeadEndDocumentAdvice(text);
  const final = looksLikeWritePromise(afterDeadEnd)
    ? stripUnfulfilledWritePromises(afterDeadEnd)
    : afterDeadEnd;
  assert.equal(final, "");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
