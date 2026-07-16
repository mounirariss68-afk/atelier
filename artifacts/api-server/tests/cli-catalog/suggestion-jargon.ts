/**
 * Task #21 — suggestion-chip jargon guard.
 *
 * Suggestion chips (chat-bar empty state + Home strips) are opt-in via
 * `promoteAsSuggestion` on catalog entries, and the FIRST English
 * example phrase of a promoted capability is what renders verbatim as
 * the chip label. This suite is the automated guard that keeps jargon
 * out of those chips as new agent abilities are added:
 *
 *   1. Every promoted capability must have a plain-language first EN
 *      example phrase — no slash syntax, no opaque record-id prefixes
 *      (eng_/inv_/person_/clatt_/att_/…), no chunk-store vocabulary.
 *   2. Known niche utilities (raw chunk fetch, document purge/delete,
 *      undo) must never be promoted.
 *
 * Deterministic + LLM-free: catalog registration is pure — we just
 * side-effect-import bootstrap-capabilities and inspect the registry.
 * (Kept standalone from run.ts, which currently references a removed
 * `pinnedPromptDrift` export and no longer loads.)
 */
import assert from "node:assert/strict";
import { listCapabilities } from "../../src/lib/atelier-cli/capability-catalog.js";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      fail++;
      console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.stack : String(err)}`);
    });
}

/**
 * Jargon families a chip label must never contain. A chip is a cold
 * entry point for a fresh user — anything that presumes knowledge of
 * internal identifiers or slash syntax belongs in /help, not a chip.
 */
const JARGON_PATTERNS: Array<{ label: string; re: RegExp }> = [
  // Slash-command syntax as the phrase opener ("/raid-list …").
  { label: "slash-command syntax", re: /^\s*\// },
  // Opaque record-id prefixes anywhere in the phrase (eng_x7f2…).
  {
    label: "opaque record id (eng_/inv_/person_/clatt_/att_/acct_/opp_/chunk_)",
    re: /\b(?:eng|inv|person|clatt|att|acct|opp|chunk)_[A-Za-z0-9]/,
  },
  // Chunk-store vocabulary ("fetch chunk 3 of …").
  { label: "chunk-store vocabulary", re: /\bchunks?\b/i },
];

async function main() {
  console.log("Task #21 — suggestion-chip jargon guard\n");

  await test("catalog has promoted capabilities to check", () => {
    const promoted = listCapabilities().filter((c) => c.promoteAsSuggestion === true);
    assert.ok(
      promoted.length > 0,
      "expected at least one capability with promoteAsSuggestion: true",
    );
  });

  await test("every promoted capability has a jargon-free first EN example phrase", () => {
    const promoted = listCapabilities().filter((c) => c.promoteAsSuggestion === true);
    const violations: string[] = [];
    for (const c of promoted) {
      const phrase = c.examplePhrases?.en?.[0];
      if (!phrase || phrase.trim().length === 0) {
        violations.push(`${c.id}: promoted but has no first EN example phrase`);
        continue;
      }
      for (const { label, re } of JARGON_PATTERNS) {
        if (re.test(phrase)) {
          violations.push(
            `${c.id}: first EN phrase ${JSON.stringify(phrase)} contains ${label}`,
          );
        }
      }
    }
    assert.equal(
      violations.length,
      0,
      `promoted capabilities with jargon chip phrases:\n  ${violations.join("\n  ")}\n` +
        `Fix: reword the FIRST examplePhrases.en entry to plain language, or drop promoteAsSuggestion.`,
    );
  });

  await test("known niche utilities are never promoted as suggestion chips", () => {
    // Power-user / internal verbs that would only confuse a fresh
    // chat-bar: raw chunk fetch, document purge, undo.
    const NEVER_PROMOTE = [
      "attachment.fetch_chunk",
      "attachment.delete_document",
      "meta.undo_last",
    ];
    const byId = new Map(listCapabilities().map((c) => [c.id, c] as const));
    for (const id of NEVER_PROMOTE) {
      const c = byId.get(id);
      assert.ok(c, `expected niche capability ${id} to exist in the catalog`);
      assert.notEqual(
        c?.promoteAsSuggestion,
        true,
        `${id} must never be promoted as a suggestion chip (niche utility)`,
      );
    }
  });

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
